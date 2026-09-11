import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { shell, makeTaskFromCommit, makeWorktree, removeWorktree, resetWorktreeTo } from './core.js';
import { detectHistoricalRuntime, commandForRuntime, runtimeSummary, runtimeForVerificationPlan } from './runtime.js';
import { historicalVerificationCommands, classifyVerificationFailure, verificationOutputSnippet } from './verification.js';
import { installForHistoricalRuntime, classifyDependencyFailure, historicalResolutionDate } from './dependencies.js';
import { FIX_PATTERN, taskUsefulness, prioritizeTasks, usefulnessSummary } from './task-quality.js';
export { classifyDependencyFailure } from './dependencies.js';

const DEPENDENCY_FILES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb']);
function failedChecks(results=[]){return results.filter(x=>!x.ok).map(x=>`${x.name}:${x.status}`).sort();}
function failureSignature(results=[]){return failedChecks(results).join('|');}
function touchesDependencies(task){return (task.touchedFiles||[]).some(file=>DEPENDENCY_FILES.has(file.split('/').pop())||DEPENDENCY_FILES.has(file));}
function runtimeShell(bin,args,cwd,runtime,{timeout=180000}={}){const[runtimeBin,runtimeArgs]=commandForRuntime(bin,args,runtime);return shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});}
function verifyForRuntime(cwd,runtime,plan=historicalVerificationCommands(cwd)){
  return plan.commands.map(({name,command:[bin,args],commandText,source})=>{
    let actualBin=bin,actualArgs=args;
    if(source==='package-scripts'&&['npm','pnpm','yarn','bun'].includes(bin)&&runtime.packageManager!==bin){actualBin=runtime.packageManager;actualArgs=runtime.packageManager==='npm'?['run',name,'--if-present']:[name];}
    const started=Date.now(),wrapped=commandForRuntime(actualBin,actualArgs,runtime),r=runtimeShell(actualBin,actualArgs,cwd,runtime);
    return{name,ok:r.status===0,status:r.status,ms:Date.now()-started,stdout:r.stdout,stderr:r.stderr,commandText:commandText||[bin,...args].join(' '),source:source||plan.source,runtimeCommand:wrapped.flat().join(' '),jobId:plan.jobId||null,toolchain:plan.toolchain||null};
  });
}
function failureDetails(results=[]){return results.filter(x=>!x.ok).map(x=>({name:x.name,status:x.status,kind:classifyVerificationFailure(x),command:x.commandText,runtimeCommand:x.runtimeCommand,snippet:verificationOutputSnippet(x),jobId:x.jobId,toolchain:x.toolchain}));}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function currentRuntime(){const n=Number(process.versions.node.split('.')[0]);return{currentNodeMajor:n,selectedNodeMajor:n,source:'current-runtime',workflowNodeMajors:[],engineRange:null,usesHistoricalNode:false,packageManager:'npm',packageManagerVersion:null,packageManagerSource:'current-runtime',verificationJobId:null,verificationToolchain:null};}

export function qualificationReason(q){if(!q.preparation?.ok)return'dependency-failure';if(!q.before?.length)return'no-verification';if(!q.regressionDetected)return'no-regression';if(!q.stableRegression)return'unstable-regression';if(q.patchApplied===false)return'patch-apply-failure';if(q.postPatchPreparation&&!q.postPatchPreparation.ok)return'post-patch-dependency-failure';if(!q.groundTruthPass)return'ground-truth-verification-failure';return'qualified';}
export function prioritizeCommits(commits){return[...commits].sort((a,b)=>Number(FIX_PATTERN.test(b.subject))-Number(FIX_PATTERN.test(a.subject))||a.index-b.index);}
export function qualificationFingerprint(task,q){
  const payload={task:{commit:task.commit,parent:task.parent},runtime:{node:q.runtime?.selectedNodeMajor,source:q.runtime?.source,packageManager:q.runtime?.packageManager,packageManagerVersion:q.runtime?.packageManagerVersion,packageManagerSource:q.runtime?.packageManagerSource},postRuntime:q.postRuntime?{node:q.postRuntime.selectedNodeMajor,source:q.postRuntime.source,packageManager:q.postRuntime.packageManager,packageManagerVersion:q.postRuntime.packageManagerVersion,packageManagerSource:q.postRuntime.packageManagerSource}:null,dependencies:{mode:q.dependencyResolutionMode,date:q.dependencyResolutionDate,refresh:q.dependencyRefreshNeeded},verification:{source:q.verificationSource,jobId:q.verificationJobId,toolchain:q.verificationToolchain,commands:q.verificationCommands},before:{signature:q.failureSignature,kinds:(q.beforeFailureDetails||[]).map(x=>`${x.name}:${x.kind}:${x.command}`).sort()},groundTruth:(q.groundTruthRuns||[]).map(run=>failureSignature(run))};
  return hash(payload);
}
export function qualificationSetFingerprint(tasks=[]){const entries=tasks.map(task=>`${task.id}:${task.qualification?.fingerprint||''}`).sort();return entries.length?hash(entries):null;}

export function qualifyTaskDetailed(repo,task,{installDependencies=false,stabilityRuns=2,groundTruthRuns=2,historicalRuntime=true}={}){
  const wt=makeWorktree(repo,'qualify',task.parent),resolutionDate=historicalResolutionDate(repo,task.commit);
  try{
    resetWorktreeTo(wt,task.parent);
    const verificationPlan=historicalVerificationCommands(wt),baseRuntime=historicalRuntime?detectHistoricalRuntime(wt):currentRuntime(),runtime=runtimeForVerificationPlan(wt,baseRuntime,verificationPlan);
    const preparation=installDependencies?installForHistoricalRuntime(wt,runtime,{resolutionDate}):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,failureKind:null,resolutionMode:'skipped',resolutionDate:null,locked:false};
    const beforeRuns=[];
    if(preparation.ok&&verificationPlan.commands.length)for(let i=0;i<Math.max(1,stabilityRuns);i++)beforeRuns.push(verifyForRuntime(wt,runtime,verificationPlan));
    const before=beforeRuns[0]||[],regressionDetected=before.some(x=>!x.ok),firstSignature=failureSignature(before),stableRegression=regressionDetected&&beforeRuns.length===Math.max(1,stabilityRuns)&&beforeRuns.every(run=>failureSignature(run)===firstSignature&&failureSignature(run)!=='');
    let patchApplied=null,postPatchPreparation=null,postRuntime=null,groundTruthRunsResults=[],groundTruthPass=false;
    if(preparation.ok&&stableRegression&&before.length){
      const patchPath=join(wt,'.kodematik-qualification.patch');writeFileSync(patchPath,task.expectedPatch||'');const patch=shell('git',['apply','--whitespace=nowarn',patchPath],{cwd:wt,allowFailure:true});rmSync(patchPath,{force:true});patchApplied=patch.status===0;
      if(patchApplied){
        const postBaseRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime;postRuntime=runtimeForVerificationPlan(wt,postBaseRuntime,verificationPlan);
        postPatchPreparation=installDependencies&&touchesDependencies(task)?installForHistoricalRuntime(wt,postRuntime,{resolutionDate}):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:postRuntime.packageManager,packageManagerVersion:postRuntime.packageManagerVersion,failureKind:null,resolutionMode:preparation.resolutionMode,resolutionDate:preparation.resolutionDate,locked:preparation.locked};
        if(postPatchPreparation.ok){for(let i=0;i<Math.max(1,groundTruthRuns);i++)groundTruthRunsResults.push(verifyForRuntime(wt,postRuntime,verificationPlan));groundTruthPass=groundTruthRunsResults.length===Math.max(1,groundTruthRuns)&&groundTruthRunsResults.every(run=>run.length>0&&run.every(x=>x.ok));}
      }
    }
    const usable=preparation.ok&&before.length>0&&stableRegression&&patchApplied===true&&(postPatchPreparation?.ok??true)&&groundTruthPass;
    return{taskId:task.id,preparation,before,beforeRuns,regressionDetected,stableRegression,failureSignature:firstSignature,failedChecks:failedChecks(before),beforeFailureDetails:failureDetails(before),patchApplied,postPatchPreparation,dependencyRefreshNeeded:touchesDependencies(task),dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate,groundTruthRuns:groundTruthRunsResults,groundTruthPass,groundTruthFailedChecks:groundTruthRunsResults.flatMap(failedChecks),groundTruthFailureDetails:failureDetails(groundTruthRunsResults[0]||[]),verificationSource:verificationPlan.source,verificationJobId:verificationPlan.jobId||null,verificationJobName:verificationPlan.jobName||null,verificationToolchain:verificationPlan.toolchain||null,verificationCommands:verificationPlan.commands.map(x=>x.commandText||x.command.flat().join(' ')),verificationOmittedJobs:verificationPlan.omittedJobs||[],runtime,runtimeSummary:runtimeSummary(runtime),postRuntime,postRuntimeSummary:postRuntime?runtimeSummary(postRuntime):null,usable};
  }finally{removeWorktree(repo,wt);}
}

export function discoverQualifiedTasksSmart(repo,{limit=10,scanLimit=Math.max(limit*10,50),installDependencies=false,historicalRuntime=true,reproducibilityRuns=2}={}){
  const r=shell('git',['log',`--max-count=${scanLimit}`,'--format=%H%x09%s'],{cwd:repo,allowFailure:true}),counts={qualified:0,'low-usefulness-qualified':0,'non-reproducible-qualified':0,'dependency-failure':0,'no-verification':0,'no-regression':0,'unstable-regression':0,'patch-apply-failure':0,'post-patch-dependency-failure':0,'ground-truth-verification-failure':0};
  if(r.status!==0)return{tasks:[],scanned:0,rejected:0,counts,prioritized:0,diagnostics:[],runtimeCounts:{},dependencyFailureCounts:{},verificationFailureCounts:{},resolutionCounts:{},qualitySummary:{strong:0,useful:0,low:0,eligible:0},setFingerprint:null};
  const commits=r.stdout.split('\n').filter(Boolean).map((line,index)=>{const[hashValue,...parts]=line.split('\t');return{hash:hashValue,subject:parts.join('\t'),index};});
  const candidates=commits.map(commit=>{const task=makeTaskFromCommit(repo,commit.hash);return task?{...commit,task,usefulness:taskUsefulness(task)}:null;}).filter(Boolean),ordered=prioritizeTasks(candidates),qualitySummary=usefulnessSummary(candidates),tasks=[],diagnostics=[],runtimeCounts={},dependencyFailureCounts={},verificationFailureCounts={},resolutionCounts={};let scanned=0,prioritized=0;
  for(const entry of ordered){
    if(tasks.length>=limit)break;const task=entry.task,usefulness=entry.usefulness;scanned++;if(usefulness.fixLike)prioritized++;
    const options={installDependencies,stabilityRuns:2,groundTruthRuns:2,historicalRuntime},qualification=qualifyTaskDetailed(repo,task,options),initialReason=qualificationReason(qualification);
    const runtimeKey=`node-${qualification.runtime.selectedNodeMajor}:${qualification.runtime.source}:${qualification.runtime.packageManager}@${qualification.runtime.packageManagerVersion}`;runtimeCounts[runtimeKey]=(runtimeCounts[runtimeKey]||0)+1;
    const mode=qualification.dependencyResolutionMode||'unknown';resolutionCounts[mode]=(resolutionCounts[mode]||0)+1;
    let reason=initialReason,replayReason=null,replayFingerprint=null,fingerprint=null;
    if(initialReason==='qualified'&&!usefulness.benchmarkEligible){reason='low-usefulness-qualified';}
    else if(initialReason==='qualified'){
      fingerprint=qualificationFingerprint(task,qualification);let reproduced=true;
      for(let run=1;run<Math.max(1,reproducibilityRuns);run++){
        const replay=qualifyTaskDetailed(repo,task,options);replayReason=qualificationReason(replay);replayFingerprint=qualificationFingerprint(task,replay);
        if(replayReason!=='qualified'||replayFingerprint!==fingerprint){reproduced=false;break;}
      }
      if(!reproduced)reason='non-reproducible-qualified';else{qualification.reproducible=true;qualification.fingerprint=fingerprint;qualification.replayFingerprint=replayFingerprint||fingerprint;qualification.usefulness=usefulness;}
    }
    counts[reason]=(counts[reason]||0)+1;
    const depFailure=reason==='dependency-failure'?qualification.preparation?.failureKind:reason==='post-patch-dependency-failure'?qualification.postPatchPreparation?.failureKind:null;if(depFailure)dependencyFailureCounts[depFailure]=(dependencyFailureCounts[depFailure]||0)+1;
    if(reason==='ground-truth-verification-failure')for(const detail of qualification.groundTruthFailureDetails||[])verificationFailureCounts[detail.kind]=(verificationFailureCounts[detail.kind]||0)+1;
    const diagnostic={taskId:task.id,title:task.title,reason,initialReason,replayReason,fingerprint,replayFingerprint,usefulness,failedChecks:qualification.failedChecks,beforeFailureDetails:qualification.beforeFailureDetails,groundTruthFailedChecks:qualification.groundTruthFailedChecks,groundTruthFailureDetails:qualification.groundTruthFailureDetails,verificationSource:qualification.verificationSource,verificationJobId:qualification.verificationJobId,verificationJobName:qualification.verificationJobName,verificationToolchain:qualification.verificationToolchain,verificationCommands:qualification.verificationCommands,verificationOmittedJobs:qualification.verificationOmittedJobs,dependencyRefreshNeeded:qualification.dependencyRefreshNeeded,dependencyResolutionMode:qualification.dependencyResolutionMode,dependencyResolutionDate:qualification.dependencyResolutionDate,runtime:qualification.runtimeSummary,postRuntime:qualification.postRuntimeSummary,packageManager:qualification.preparation?.packageManager,packageManagerVersion:qualification.preparation?.packageManagerVersion,installCommand:qualification.preparation?.command,runtimeInstallCommand:qualification.preparation?.runtimeCommand,dependencyFailure:depFailure,failedInstallStep:qualification.preparation?.failedStep||qualification.postPatchPreparation?.failedStep||null};
    if(reason==='qualified')tasks.push({...task,usefulness,qualification});else diagnostics.push(diagnostic);
  }
  return{tasks,scanned,rejected:scanned-tasks.length,counts,prioritized,diagnostics,runtimeCounts,dependencyFailureCounts,verificationFailureCounts,resolutionCounts,qualitySummary,setFingerprint:qualificationSetFingerprint(tasks)};
}
