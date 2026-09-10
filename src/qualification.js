import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { shell, makeTaskFromCommit, makeWorktree, removeWorktree, resetWorktreeTo } from './core.js';
import { detectHistoricalRuntime, commandForRuntime, runtimeSummary } from './runtime.js';
import { historicalVerificationCommands, classifyVerificationFailure, verificationOutputSnippet } from './verification.js';
import { installForHistoricalRuntime, classifyDependencyFailure, historicalResolutionDate } from './dependencies.js';
export { classifyDependencyFailure } from './dependencies.js';

const FIX_PATTERN=/\b(fix(?:ed|es)?|bug(?:fix)?|regression|correct(?:ion|ed|s)?|repair|resolve[ds]?|patch|crash|broken|failure|incorrect|wrong)\b/i;
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
    return{name,ok:r.status===0,status:r.status,ms:Date.now()-started,stdout:r.stdout,stderr:r.stderr,commandText:commandText||[bin,...args].join(' '),source:source||plan.source,runtimeCommand:wrapped.flat().join(' ')};
  });
}
function failureDetails(results=[]){return results.filter(x=>!x.ok).map(x=>({name:x.name,status:x.status,kind:classifyVerificationFailure(x),command:x.commandText,runtimeCommand:x.runtimeCommand,snippet:verificationOutputSnippet(x)}));}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

export function qualificationReason(q){if(!q.preparation?.ok)return'dependency-failure';if(!q.before?.length)return'no-verification';if(!q.regressionDetected)return'no-regression';if(!q.stableRegression)return'unstable-regression';if(q.patchApplied===false)return'patch-apply-failure';if(q.postPatchPreparation&&!q.postPatchPreparation.ok)return'post-patch-dependency-failure';if(!q.groundTruthPass)return'ground-truth-verification-failure';return'qualified';}
export function prioritizeCommits(commits){return[...commits].sort((a,b)=>Number(FIX_PATTERN.test(b.subject))-Number(FIX_PATTERN.test(a.subject))||a.index-b.index);}
export function qualificationFingerprint(task,q){
  const payload={task:{commit:task.commit,parent:task.parent},runtime:{node:q.runtime?.selectedNodeMajor,source:q.runtime?.source,packageManager:q.runtime?.packageManager,packageManagerVersion:q.runtime?.packageManagerVersion,packageManagerSource:q.runtime?.packageManagerSource},postRuntime:q.postRuntime?{node:q.postRuntime.selectedNodeMajor,source:q.postRuntime.source,packageManager:q.postRuntime.packageManager,packageManagerVersion:q.postRuntime.packageManagerVersion,packageManagerSource:q.postRuntime.packageManagerSource}:null,dependencies:{mode:q.dependencyResolutionMode,date:q.dependencyResolutionDate,refresh:q.dependencyRefreshNeeded},verification:{source:q.verificationSource,commands:q.verificationCommands},before:{signature:q.failureSignature,kinds:(q.beforeFailureDetails||[]).map(x=>`${x.name}:${x.kind}:${x.command}`).sort()},groundTruth:(q.groundTruthRuns||[]).map(run=>failureSignature(run))};
  return hash(payload);
}
export function qualificationSetFingerprint(tasks=[]){const entries=tasks.map(task=>`${task.id}:${task.qualification?.fingerprint||''}`).sort();return entries.length?hash(entries):null;}

export function qualifyTaskDetailed(repo,task,{installDependencies=false,stabilityRuns=2,groundTruthRuns=2,historicalRuntime=true}={}){
  const wt=makeWorktree(repo,'qualify',task.parent),resolutionDate=historicalResolutionDate(repo,task.commit);
  try{
    resetWorktreeTo(wt,task.parent);
    const runtime=historicalRuntime?detectHistoricalRuntime(wt):{currentNodeMajor:Number(process.versions.node.split('.')[0]),selectedNodeMajor:Number(process.versions.node.split('.')[0]),source:'current-runtime',workflowNodeMajors:[],engineRange:null,usesHistoricalNode:false,packageManager:'npm',packageManagerVersion:null,packageManagerSource:'current-runtime'};
    const preparation=installDependencies?installForHistoricalRuntime(wt,runtime,{resolutionDate}):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,failureKind:null,resolutionMode:'skipped',resolutionDate:null,locked:false};
    const verificationPlan=preparation.ok?historicalVerificationCommands(wt):{source:null,commands:[]},beforeRuns=[];
    if(preparation.ok&&verificationPlan.commands.length)for(let i=0;i<Math.max(1,stabilityRuns);i++)beforeRuns.push(verifyForRuntime(wt,runtime,verificationPlan));
    const before=beforeRuns[0]||[],regressionDetected=before.some(x=>!x.ok),firstSignature=failureSignature(before),stableRegression=regressionDetected&&beforeRuns.length===Math.max(1,stabilityRuns)&&beforeRuns.every(run=>failureSignature(run)===firstSignature&&failureSignature(run)!=='');
    let patchApplied=null,postPatchPreparation=null,postRuntime=null,groundTruthRunsResults=[],groundTruthPass=false;
    if(preparation.ok&&stableRegression&&before.length){
      const patchPath=join(wt,'.kodematik-qualification.patch');writeFileSync(patchPath,task.expectedPatch||'');const patch=shell('git',['apply','--whitespace=nowarn',patchPath],{cwd:wt,allowFailure:true});rmSync(patchPath,{force:true});patchApplied=patch.status===0;
      if(patchApplied){
        postRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime;
        postPatchPreparation=installDependencies&&touchesDependencies(task)?installForHistoricalRuntime(wt,postRuntime,{resolutionDate}):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:postRuntime.packageManager,packageManagerVersion:postRuntime.packageManagerVersion,failureKind:null,resolutionMode:preparation.resolutionMode,resolutionDate:preparation.resolutionDate,locked:preparation.locked};
        if(postPatchPreparation.ok){for(let i=0;i<Math.max(1,groundTruthRuns);i++)groundTruthRunsResults.push(verifyForRuntime(wt,postRuntime,verificationPlan));groundTruthPass=groundTruthRunsResults.length===Math.max(1,groundTruthRuns)&&groundTruthRunsResults.every(run=>run.length>0&&run.every(x=>x.ok));}
      }
    }
    const usable=preparation.ok&&before.length>0&&stableRegression&&patchApplied===true&&(postPatchPreparation?.ok??true)&&groundTruthPass;
    return{taskId:task.id,preparation,before,beforeRuns,regressionDetected,stableRegression,failureSignature:firstSignature,failedChecks:failedChecks(before),beforeFailureDetails:failureDetails(before),patchApplied,postPatchPreparation,dependencyRefreshNeeded:touchesDependencies(task),dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate,groundTruthRuns:groundTruthRunsResults,groundTruthPass,groundTruthFailedChecks:groundTruthRunsResults.flatMap(failedChecks),groundTruthFailureDetails:failureDetails(groundTruthRunsResults[0]||[]),verificationSource:verificationPlan.source,verificationCommands:verificationPlan.commands.map(x=>x.commandText||x.command.flat().join(' ')),runtime,runtimeSummary:runtimeSummary(runtime),postRuntime,postRuntimeSummary:postRuntime?runtimeSummary(postRuntime):null,usable};
  }finally{removeWorktree(repo,wt);}
}

export function discoverQualifiedTasksSmart(repo,{limit=10,scanLimit=Math.max(limit*10,50),installDependencies=false,historicalRuntime=true,reproducibilityRuns=2}={}){
  const r=shell('git',['log',`--max-count=${scanLimit}`,'--format=%H%x09%s'],{cwd:repo,allowFailure:true}),counts={qualified:0,'non-reproducible-qualified':0,'dependency-failure':0,'no-verification':0,'no-regression':0,'unstable-regression':0,'patch-apply-failure':0,'post-patch-dependency-failure':0,'ground-truth-verification-failure':0};
  if(r.status!==0)return{tasks:[],scanned:0,rejected:0,counts,prioritized:0,diagnostics:[],runtimeCounts:{},dependencyFailureCounts:{},verificationFailureCounts:{},resolutionCounts:{},setFingerprint:null};
  const commits=r.stdout.split('\n').filter(Boolean).map((line,index)=>{const[hashValue,...parts]=line.split('\t');return{hash:hashValue,subject:parts.join('\t'),index};}),ordered=prioritizeCommits(commits),tasks=[],diagnostics=[],runtimeCounts={},dependencyFailureCounts={},verificationFailureCounts={},resolutionCounts={};let scanned=0,prioritized=0;
  for(const commit of ordered){
    if(tasks.length>=limit)break;const task=makeTaskFromCommit(repo,commit.hash);if(!task)continue;scanned++;if(FIX_PATTERN.test(commit.subject))prioritized++;
    const options={installDependencies,stabilityRuns:2,groundTruthRuns:2,historicalRuntime},qualification=qualifyTaskDetailed(repo,task,options),initialReason=qualificationReason(qualification);
    const runtimeKey=`node-${qualification.runtime.selectedNodeMajor}:${qualification.runtime.source}:${qualification.runtime.packageManager}@${qualification.runtime.packageManagerVersion}`;runtimeCounts[runtimeKey]=(runtimeCounts[runtimeKey]||0)+1;
    const mode=qualification.dependencyResolutionMode||'unknown';resolutionCounts[mode]=(resolutionCounts[mode]||0)+1;
    let reason=initialReason,replayReason=null,replayFingerprint=null,fingerprint=null;
    if(initialReason==='qualified'){
      fingerprint=qualificationFingerprint(task,qualification);let reproduced=true;
      for(let run=1;run<Math.max(1,reproducibilityRuns);run++){
        const replay=qualifyTaskDetailed(repo,task,options);replayReason=qualificationReason(replay);replayFingerprint=qualificationFingerprint(task,replay);
        if(replayReason!=='qualified'||replayFingerprint!==fingerprint){reproduced=false;break;}
      }
      if(!reproduced)reason='non-reproducible-qualified';else{qualification.reproducible=true;qualification.fingerprint=fingerprint;qualification.replayFingerprint=replayFingerprint||fingerprint;}
    }
    counts[reason]=(counts[reason]||0)+1;
    const depFailure=reason==='dependency-failure'?qualification.preparation?.failureKind:reason==='post-patch-dependency-failure'?qualification.postPatchPreparation?.failureKind:null;if(depFailure)dependencyFailureCounts[depFailure]=(dependencyFailureCounts[depFailure]||0)+1;
    if(reason==='ground-truth-verification-failure')for(const detail of qualification.groundTruthFailureDetails||[])verificationFailureCounts[detail.kind]=(verificationFailureCounts[detail.kind]||0)+1;
    const diagnostic={taskId:task.id,title:task.title,reason,initialReason,replayReason,fingerprint,replayFingerprint,failedChecks:qualification.failedChecks,beforeFailureDetails:qualification.beforeFailureDetails,groundTruthFailedChecks:qualification.groundTruthFailedChecks,groundTruthFailureDetails:qualification.groundTruthFailureDetails,verificationSource:qualification.verificationSource,verificationCommands:qualification.verificationCommands,dependencyRefreshNeeded:qualification.dependencyRefreshNeeded,dependencyResolutionMode:qualification.dependencyResolutionMode,dependencyResolutionDate:qualification.dependencyResolutionDate,runtime:qualification.runtimeSummary,postRuntime:qualification.postRuntimeSummary,packageManager:qualification.preparation?.packageManager,packageManagerVersion:qualification.preparation?.packageManagerVersion,installCommand:qualification.preparation?.command,runtimeInstallCommand:qualification.preparation?.runtimeCommand,dependencyFailure:depFailure,failedInstallStep:qualification.preparation?.failedStep||qualification.postPatchPreparation?.failedStep||null};
    if(reason==='qualified')tasks.push({...task,qualification});else diagnostics.push(diagnostic);
  }
  return{tasks,scanned,rejected:scanned-tasks.length,counts,prioritized,diagnostics,runtimeCounts,dependencyFailureCounts,verificationFailureCounts,resolutionCounts,setFingerprint:qualificationSetFingerprint(tasks)};
}
