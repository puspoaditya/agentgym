import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { shell, makeTaskFromCommit, makeWorktree, removeWorktree, resetWorktreeTo } from './core.js';
import { detectHistoricalRuntime, commandForRuntime, runtimeSummary, runtimeForVerificationPlan } from './runtime.js';
import { historicalVerificationCommands, classifyVerificationFailure, verificationOutputSnippet, taskTestFiles } from './verification.js';
import { installForHistoricalRuntime, classifyDependencyFailure, historicalResolutionDate } from './dependencies.js';
import { FIX_PATTERN, taskUsefulness, prioritizeTasks, usefulnessSummary } from './task-quality.js';
export { classifyDependencyFailure } from './dependencies.js';

export const DEFAULT_QUALIFICATION_BUDGET_MS=75*60*1000;
export const DEFAULT_VERIFICATION_TIMEOUT_MS=60*1000;
export const DEFAULT_INSTALL_TIMEOUT_MS=120*1000;
const DEPENDENCY_FILES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb']);
function failedChecks(results=[]){return results.filter(x=>!x.ok).map(x=>`${x.name}:${x.status}`).sort();}
function failureSignature(results=[]){return failedChecks(results).join('|');}
function touchesDependencies(task){return (task.touchedFiles||[]).some(file=>DEPENDENCY_FILES.has(file.split('/').pop())||DEPENDENCY_FILES.has(file));}
function remainingMs(deadline){return Number.isFinite(deadline)?Math.max(0,deadline-Date.now()):Infinity;}
function boundedTimeout(requested,deadline){const remaining=remainingMs(deadline);return Number.isFinite(remaining)?Math.max(1,Math.min(requested,remaining)):requested;}
function runtimeShell(bin,args,cwd,runtime,{timeout=DEFAULT_VERIFICATION_TIMEOUT_MS}={}){const[runtimeBin,runtimeArgs]=commandForRuntime(bin,args,runtime),started=Date.now(),r=shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout}),ms=Date.now()-started,timedOut=r.status!==0&&ms>=Math.max(1,timeout-250);return{...r,ms,timedOut};}
function verifyForRuntime(cwd,runtime,plan=historicalVerificationCommands(cwd),{commandTimeoutMs=DEFAULT_VERIFICATION_TIMEOUT_MS,deadline=Infinity}={}){
  const results=[];
  for(const{name,command:[bin,args],commandText,source,family='other',targeted=false,costClass='unknown'}of plan.commands){
    const remaining=remainingMs(deadline);
    if(remaining<=0){results.push({name,ok:false,status:124,ms:0,stdout:'',stderr:'qualification time budget exhausted before verification command',commandText:commandText||[bin,...args].join(' '),source:source||plan.source,runtimeCommand:'',jobId:plan.jobId||null,toolchain:plan.toolchain||null,family,targeted,costClass,timedOut:true,budgetExhausted:true});break;}
    let actualBin=bin,actualArgs=args;
    if(source==='package-scripts'&&['npm','pnpm','yarn','bun'].includes(bin)&&runtime.packageManager!==bin){actualBin=runtime.packageManager;actualArgs=runtime.packageManager==='npm'?['run',name,'--if-present']:[name];}
    const timeout=boundedTimeout(commandTimeoutMs,deadline),remainingBefore=remainingMs(deadline),wrapped=commandForRuntime(actualBin,actualArgs,runtime),r=runtimeShell(actualBin,actualArgs,cwd,runtime,{timeout}),budgetExhausted=r.timedOut&&Number.isFinite(remainingBefore)&&remainingBefore<=commandTimeoutMs+250;
    results.push({name,ok:r.status===0,status:r.timedOut?124:r.status,ms:r.ms,stdout:r.stdout,stderr:r.timedOut?(r.stderr||`verification exceeded ${Math.ceil(timeout/1000)}s timeout`):r.stderr,commandText:commandText||[bin,...args].join(' '),source:source||plan.source,runtimeCommand:wrapped.flat().join(' '),jobId:plan.jobId||null,toolchain:plan.toolchain||null,family,targeted,costClass,timedOut:r.timedOut,budgetExhausted});
    if(r.timedOut)break;
  }
  return results;
}
function failureDetails(results=[]){return results.filter(x=>!x.ok).map(x=>({name:x.name,status:x.status,kind:x.timedOut?'timeout':classifyVerificationFailure(x),command:x.commandText,runtimeCommand:x.runtimeCommand,snippet:verificationOutputSnippet(x),jobId:x.jobId,toolchain:x.toolchain,family:x.family,targeted:!!x.targeted,timedOut:!!x.timedOut,budgetExhausted:!!x.budgetExhausted}));}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function currentRuntime(){const n=Number(process.versions.node.split('.')[0]);return{currentNodeMajor:n,selectedNodeMajor:n,source:'current-runtime',workflowNodeMajors:[],engineRange:null,usesHistoricalNode:false,packageManager:'npm',packageManagerVersion:null,packageManagerSource:'current-runtime',verificationJobId:null,verificationToolchain:null};}
function skippedPreparation(runtime,mode='skipped',date=null,locked=false){return{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,failureKind:null,resolutionMode:mode,resolutionDate:date,locked};}
function installWithBounds(cwd,runtime,{resolutionDate,deadline,installTimeoutMs}){
  const remaining=remainingMs(deadline);
  if(remaining<=0)return{ok:false,skipped:false,command:null,status:124,stdout:'',stderr:'qualification time budget exhausted before dependency installation',packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,failureKind:'timeout',resolutionMode:'budget-exhausted',resolutionDate,locked:false,failedStep:'install',timedOut:true,budgetExhausted:true};
  const timeout=boundedTimeout(installTimeoutMs,deadline),remainingBefore=remainingMs(deadline),started=Date.now(),result=installForHistoricalRuntime(cwd,runtime,{resolutionDate,timeout}),ms=Date.now()-started,timedOut=!result.ok&&ms>=Math.max(1,timeout-250),budgetExhausted=timedOut&&Number.isFinite(remainingBefore)&&remainingBefore<=installTimeoutMs+250;
  return{...result,ms,timedOut,budgetExhausted};
}
function stageHistoricalTestOracle(cwd,task,files=taskTestFiles(task)){
  const staged=[];
  for(const file of files){
    const exists=shell('git',['cat-file','-e',`${task.commit}:${file}`],{cwd,allowFailure:true});if(exists.status!==0)continue;
    const checkout=shell('git',['checkout',task.commit,'--',file],{cwd,allowFailure:true});if(checkout.status===0)staged.push(file);
  }
  return staged;
}
function substantiveTestFailure(result={}){
  if(result.ok||result.timedOut||result.family!=='test')return false;
  const text=`${result.stdout||''}\n${result.stderr||''}`.toLowerCase();
  return !/(cannot find module|module not found|command not found|unknown option|enoent|ebadengine|no test files found|no tests found)/.test(text);
}

export function qualificationReason(q){if(q.budgetExhausted)return'qualification-budget-exhausted';if(q.dependencyTimedOut)return'dependency-timeout';if(q.verificationTimedOut)return'verification-timeout';if(!q.preparation?.ok)return'dependency-failure';if(!q.before?.length)return'no-verification';if(!q.regressionDetected)return'no-regression';if(!q.testRegressionDetected)return'no-test-regression';if(!q.stableRegression)return'unstable-regression';if(q.patchApplied===false)return'patch-apply-failure';if(q.postPatchPreparation&&!q.postPatchPreparation.ok)return'post-patch-dependency-failure';if(!q.groundTruthPass)return'ground-truth-verification-failure';return'qualified';}
export function prioritizeCommits(commits){return[...commits].sort((a,b)=>Number(FIX_PATTERN.test(b.subject))-Number(FIX_PATTERN.test(a.subject))||a.index-b.index);}
export function qualificationFingerprint(task,q){
  const payload={task:{commit:task.commit,parent:task.parent},runtime:{node:q.runtime?.selectedNodeMajor,source:q.runtime?.source,packageManager:q.runtime?.packageManager,packageManagerVersion:q.runtime?.packageManagerVersion,packageManagerSource:q.runtime?.packageManagerSource},postRuntime:q.postRuntime?{node:q.postRuntime.selectedNodeMajor,source:q.postRuntime.source,packageManager:q.postRuntime.packageManager,packageManagerVersion:q.postRuntime.packageManagerVersion,packageManagerSource:q.postRuntime.packageManagerSource}:null,dependencies:{mode:q.dependencyResolutionMode,date:q.dependencyResolutionDate,refresh:q.dependencyRefreshNeeded},verification:{source:q.verificationSource,jobId:q.verificationJobId,toolchain:q.verificationToolchain,strategy:q.verificationStrategy,commands:q.verificationCommands,testFiles:q.verificationTestFiles,oracleFiles:q.testOracleFiles},before:{signature:q.failureSignature,testRegression:q.testRegressionDetected,kinds:(q.beforeFailureDetails||[]).map(x=>`${x.name}:${x.kind}:${x.command}`).sort()},groundTruth:(q.groundTruthRuns||[]).map(run=>failureSignature(run))};
  return hash(payload);
}
export function qualificationSetFingerprint(tasks=[]){const entries=tasks.map(task=>`${task.id}:${task.qualification?.fingerprint||''}`).sort();return entries.length?hash(entries):null;}

export function qualifyTaskDetailed(repo,task,{installDependencies=false,stabilityRuns=2,groundTruthRuns=2,historicalRuntime=true,commandTimeoutMs=DEFAULT_VERIFICATION_TIMEOUT_MS,installTimeoutMs=DEFAULT_INSTALL_TIMEOUT_MS,deadline=Infinity}={}){
  const wt=makeWorktree(repo,'qualify',task.parent),resolutionDate=historicalResolutionDate(repo,task.commit);
  try{
    resetWorktreeTo(wt,task.parent);
    const requestedTestFiles=taskTestFiles(task),testOracleFiles=stageHistoricalTestOracle(wt,task,requestedTestFiles),verificationPlan=historicalVerificationCommands(wt,{testFiles:testOracleFiles}),baseRuntime=historicalRuntime?detectHistoricalRuntime(wt):currentRuntime(),runtime=runtimeForVerificationPlan(wt,baseRuntime,verificationPlan);
    const preparation=installDependencies?installWithBounds(wt,runtime,{resolutionDate,deadline,installTimeoutMs}):skippedPreparation(runtime);
    const beforeRuns=[];
    if(preparation.ok&&verificationPlan.commands.length&&remainingMs(deadline)>0){
      const first=verifyForRuntime(wt,runtime,verificationPlan,{commandTimeoutMs,deadline});beforeRuns.push(first);
      const firstHasTestRegression=first.some(substantiveTestFailure),firstTimedOut=first.some(x=>x.timedOut);
      if(firstHasTestRegression&&!firstTimedOut)for(let i=1;i<Math.max(1,stabilityRuns);i++){const run=verifyForRuntime(wt,runtime,verificationPlan,{commandTimeoutMs,deadline});beforeRuns.push(run);if(run.some(x=>x.timedOut)||!run.some(substantiveTestFailure))break;}
    }
    const before=beforeRuns[0]||[],regressionDetected=before.some(x=>!x.ok&&!x.timedOut),testRegressionDetected=before.some(substantiveTestFailure),firstSignature=failureSignature(before),verificationTimedOut=beforeRuns.flat().some(x=>x.timedOut),stableRegression=regressionDetected&&testRegressionDetected&&!verificationTimedOut&&beforeRuns.length===Math.max(1,stabilityRuns)&&beforeRuns.every(run=>run.some(substantiveTestFailure)&&failureSignature(run)===firstSignature&&failureSignature(run)!=='');
    let patchApplied=null,postPatchPreparation=null,postRuntime=null,groundTruthRunsResults=[],groundTruthPass=false;
    if(preparation.ok&&stableRegression&&before.length&&remainingMs(deadline)>0){
      shell('git',['reset','--hard',task.parent],{cwd:wt});
      const patchPath=join(wt,'.kodematik-qualification.patch');writeFileSync(patchPath,task.expectedPatch||'');const patch=shell('git',['apply','--whitespace=nowarn',patchPath],{cwd:wt,allowFailure:true});rmSync(patchPath,{force:true});patchApplied=patch.status===0;
      if(patchApplied){
        const postBaseRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime;postRuntime=runtimeForVerificationPlan(wt,postBaseRuntime,verificationPlan);
        postPatchPreparation=installDependencies&&touchesDependencies(task)?installWithBounds(wt,postRuntime,{resolutionDate,deadline,installTimeoutMs}):skippedPreparation(postRuntime,preparation.resolutionMode,preparation.resolutionDate,preparation.locked);
        if(postPatchPreparation.ok){
          for(let i=0;i<Math.max(1,groundTruthRuns);i++){
            const run=verifyForRuntime(wt,postRuntime,verificationPlan,{commandTimeoutMs,deadline});groundTruthRunsResults.push(run);
            if(run.some(x=>x.timedOut)||!run.length||run.some(x=>!x.ok))break;
          }
          groundTruthPass=groundTruthRunsResults.length===Math.max(1,groundTruthRuns)&&groundTruthRunsResults.every(run=>run.length>0&&run.every(x=>x.ok));
        }
      }
    }
    const allVerification=[...beforeRuns.flat(),...groundTruthRunsResults.flat()],postDependencyTimedOut=!!postPatchPreparation?.timedOut,dependencyTimedOut=!!preparation.timedOut||postDependencyTimedOut,allVerificationTimedOut=verificationTimedOut||groundTruthRunsResults.flat().some(x=>x.timedOut),budgetExhausted=!!preparation.budgetExhausted||!!postPatchPreparation?.budgetExhausted||allVerification.some(x=>x.budgetExhausted)||remainingMs(deadline)<=0;
    const usable=!budgetExhausted&&!dependencyTimedOut&&!allVerificationTimedOut&&preparation.ok&&before.length>0&&stableRegression&&testRegressionDetected&&patchApplied===true&&(postPatchPreparation?.ok??true)&&groundTruthPass;
    return{taskId:task.id,preparation,before,beforeRuns,regressionDetected,testRegressionDetected,stableRegression,failureSignature:firstSignature,failedChecks:failedChecks(before),beforeFailureDetails:failureDetails(before),patchApplied,postPatchPreparation,dependencyRefreshNeeded:touchesDependencies(task),dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate,groundTruthRuns:groundTruthRunsResults,groundTruthPass,groundTruthFailedChecks:groundTruthRunsResults.flatMap(failedChecks),groundTruthFailureDetails:failureDetails(groundTruthRunsResults[0]||[]),verificationSource:verificationPlan.source,verificationJobId:verificationPlan.jobId||null,verificationJobName:verificationPlan.jobName||null,verificationToolchain:verificationPlan.toolchain||null,verificationStrategy:verificationPlan.strategy||null,verificationCommands:verificationPlan.commands.map(x=>x.commandText||x.command.flat().join(' ')),verificationTestFiles:verificationPlan.testFiles||[],testOracleFiles,verificationOmittedJobs:verificationPlan.omittedJobs||[],runtime,runtimeSummary:runtimeSummary(runtime),postRuntime,postRuntimeSummary:postRuntime?runtimeSummary(postRuntime):null,verificationTimedOut:allVerificationTimedOut,dependencyTimedOut,budgetExhausted,usable};
  }finally{removeWorktree(repo,wt);}
}

export function discoverQualifiedTasksSmart(repo,{limit=10,scanLimit=Math.max(limit*10,50),installDependencies=false,historicalRuntime=true,reproducibilityRuns=2,budgetMs=DEFAULT_QUALIFICATION_BUDGET_MS,commandTimeoutMs=DEFAULT_VERIFICATION_TIMEOUT_MS,installTimeoutMs=DEFAULT_INSTALL_TIMEOUT_MS,onProgress=null}={}){
  const startedAt=Date.now(),deadline=Number.isFinite(budgetMs)&&budgetMs>0?startedAt+budgetMs:Infinity,r=shell('git',['log',`--max-count=${scanLimit}`,'--format=%H%x09%s'],{cwd:repo,allowFailure:true}),counts={qualified:0,'low-usefulness-qualified':0,'non-reproducible-qualified':0,'dependency-timeout':0,'verification-timeout':0,'qualification-budget-exhausted':0,'dependency-failure':0,'no-verification':0,'no-regression':0,'no-test-regression':0,'unstable-regression':0,'patch-apply-failure':0,'post-patch-dependency-failure':0,'ground-truth-verification-failure':0};
  if(r.status!==0)return{tasks:[],scanned:0,rejected:0,counts,prioritized:0,diagnostics:[],runtimeCounts:{},dependencyFailureCounts:{},verificationFailureCounts:{},resolutionCounts:{},qualitySummary:{strong:0,useful:0,low:0,eligible:0},setFingerprint:null,elapsedMs:Date.now()-startedAt,budgetMs,budgetExhausted:false};
  const commits=r.stdout.split('\n').filter(Boolean).map((line,index)=>{const[hashValue,...parts]=line.split('\t');return{hash:hashValue,subject:parts.join('\t'),index};});
  const candidates=commits.map(commit=>{const task=makeTaskFromCommit(repo,commit.hash);return task?{...commit,task,usefulness:taskUsefulness(task)}:null;}).filter(Boolean),ordered=prioritizeTasks(candidates),qualitySummary=usefulnessSummary(candidates),tasks=[],diagnostics=[],runtimeCounts={},dependencyFailureCounts={},verificationFailureCounts={},resolutionCounts={};let scanned=0,prioritized=0,budgetExhausted=false;
  for(const entry of ordered){
    if(tasks.length>=limit)break;if(remainingMs(deadline)<=0){budgetExhausted=true;break;}
    const task=entry.task,usefulness=entry.usefulness;scanned++;if(usefulness.fixLike)prioritized++;
    const options={installDependencies,stabilityRuns:2,groundTruthRuns:2,historicalRuntime,commandTimeoutMs,installTimeoutMs,deadline},qualification=qualifyTaskDetailed(repo,task,options),initialReason=qualificationReason(qualification);
    const runtimeKey=`node-${qualification.runtime.selectedNodeMajor}:${qualification.runtime.source}:${qualification.runtime.packageManager}@${qualification.runtime.packageManagerVersion}`;runtimeCounts[runtimeKey]=(runtimeCounts[runtimeKey]||0)+1;
    const mode=qualification.dependencyResolutionMode||'unknown';resolutionCounts[mode]=(resolutionCounts[mode]||0)+1;
    let reason=initialReason,replayReason=null,replayFingerprint=null,fingerprint=null;
    if(initialReason==='qualified'&&!usefulness.benchmarkEligible){reason='low-usefulness-qualified';}
    else if(initialReason==='qualified'){
      fingerprint=qualificationFingerprint(task,qualification);let reproduced=true;
      for(let run=1;run<Math.max(1,reproducibilityRuns);run++){
        if(remainingMs(deadline)<=0){reproduced=false;replayReason='qualification-budget-exhausted';budgetExhausted=true;break;}
        const replay=qualifyTaskDetailed(repo,task,options);replayReason=qualificationReason(replay);replayFingerprint=qualificationFingerprint(task,replay);
        if(replayReason==='qualification-budget-exhausted')budgetExhausted=true;
        if(replayReason!=='qualified'||replayFingerprint!==fingerprint){reproduced=false;break;}
      }
      if(!reproduced)reason=replayReason==='qualification-budget-exhausted'?'qualification-budget-exhausted':'non-reproducible-qualified';else{qualification.reproducible=true;qualification.fingerprint=fingerprint;qualification.replayFingerprint=replayFingerprint||fingerprint;qualification.usefulness=usefulness;}
    }
    if(reason==='qualification-budget-exhausted')budgetExhausted=true;
    counts[reason]=(counts[reason]||0)+1;
    const depFailure=reason==='dependency-failure'?qualification.preparation?.failureKind:reason==='post-patch-dependency-failure'?qualification.postPatchPreparation?.failureKind:null;if(depFailure)dependencyFailureCounts[depFailure]=(dependencyFailureCounts[depFailure]||0)+1;
    if(['ground-truth-verification-failure','verification-timeout','no-test-regression'].includes(reason))for(const detail of qualification.groundTruthFailureDetails?.length?qualification.groundTruthFailureDetails:qualification.beforeFailureDetails||[])verificationFailureCounts[detail.kind]=(verificationFailureCounts[detail.kind]||0)+1;
    const diagnostic={taskId:task.id,title:task.title,reason,initialReason,replayReason,fingerprint,replayFingerprint,usefulness,failedChecks:qualification.failedChecks,beforeFailureDetails:qualification.beforeFailureDetails,groundTruthFailedChecks:qualification.groundTruthFailedChecks,groundTruthFailureDetails:qualification.groundTruthFailureDetails,verificationSource:qualification.verificationSource,verificationJobId:qualification.verificationJobId,verificationJobName:qualification.verificationJobName,verificationToolchain:qualification.verificationToolchain,verificationStrategy:qualification.verificationStrategy,verificationCommands:qualification.verificationCommands,verificationTestFiles:qualification.verificationTestFiles,testOracleFiles:qualification.testOracleFiles,verificationOmittedJobs:qualification.verificationOmittedJobs,dependencyRefreshNeeded:qualification.dependencyRefreshNeeded,dependencyResolutionMode:qualification.dependencyResolutionMode,dependencyResolutionDate:qualification.dependencyResolutionDate,runtime:qualification.runtimeSummary,postRuntime:qualification.postRuntimeSummary,packageManager:qualification.preparation?.packageManager,packageManagerVersion:qualification.preparation?.packageManagerVersion,installCommand:qualification.preparation?.command,runtimeInstallCommand:qualification.preparation?.runtimeCommand,dependencyFailure:depFailure,failedInstallStep:qualification.preparation?.failedStep||qualification.postPatchPreparation?.failedStep||null};
    if(reason==='qualified')tasks.push({...task,usefulness,qualification});else diagnostics.push(diagnostic);
    if(typeof onProgress==='function')onProgress({scanned,scanLimit,taskId:task.id,reason,qualified:tasks.length,elapsedMs:Date.now()-startedAt,remainingMs:remainingMs(deadline)});
    if(budgetExhausted)break;
  }
  return{tasks,scanned,rejected:scanned-tasks.length,counts,prioritized,diagnostics,runtimeCounts,dependencyFailureCounts,verificationFailureCounts,resolutionCounts,qualitySummary,setFingerprint:qualificationSetFingerprint(tasks),elapsedMs:Date.now()-startedAt,budgetMs,budgetExhausted};
}