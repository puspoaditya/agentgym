import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  shell,
  makeTaskFromCommit,
  makeWorktree,
  removeWorktree,
  resetWorktreeTo,
} from './core.js';
import { detectHistoricalRuntime, commandForRuntime, dependencyInstallCommandForRuntime, runtimeSummary } from './runtime.js';
import { historicalVerificationCommands, classifyVerificationFailure, verificationOutputSnippet } from './verification.js';

const FIX_PATTERN=/\b(fix(?:ed|es)?|bug(?:fix)?|regression|correct(?:ion|ed|s)?|repair|resolve[ds]?|patch|crash|broken|failure|incorrect|wrong)\b/i;
const DEPENDENCY_FILES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb']);

function failedChecks(results=[]){return results.filter(x=>!x.ok).map(x=>`${x.name}:${x.status}`).sort();}
function failureSignature(results=[]){return failedChecks(results).join('|');}
function touchesDependencies(task){return (task.touchedFiles||[]).some(file=>DEPENDENCY_FILES.has(file.split('/').pop())||DEPENDENCY_FILES.has(file));}
export function classifyDependencyFailure(preparation={}){const text=`${preparation.stderr||''}\n${preparation.stdout||''}`.toLowerCase();if(/unsupported engine|ebadengine|engine .*node/.test(text))return'node-engine';if(/lockfile|package-lock|npm-shrinkwrap|frozen-lockfile|out of date|synchronized/.test(text))return'lockfile';if(/eresolve|dependency conflict|peer dep|peer dependency/.test(text))return'dependency-resolution';if(/not found|enoent|command not found|could not determine executable/.test(text))return'missing-tool';if(/network|econn|etimedout|enotfound|fetch failed|socket/.test(text))return'network';return'install-command';}
function runtimeShell(bin,args,cwd,runtime,{timeout=180000}={}){const[runtimeBin,runtimeArgs]=commandForRuntime(bin,args,runtime);return shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});}
function installForRuntime(cwd,runtime,{timeout=300000}={}){const[bin,args]=dependencyInstallCommandForRuntime(cwd,runtime),r=runtimeShell(bin,args,cwd,runtime,{timeout}),result={ok:r.status===0,skipped:false,packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,command:[bin,...args].join(' '),runtimeCommand:commandForRuntime(bin,args,runtime).flat().join(' '),status:r.status,stdout:r.stdout,stderr:r.stderr};return{...result,failureKind:result.ok?null:classifyDependencyFailure(result)};}
function verifyForRuntime(cwd,runtime,plan=historicalVerificationCommands(cwd)){
  return plan.commands.map(({name,command:[bin,args],commandText,source})=>{
    let actualBin=bin,actualArgs=args;
    if(source==='package-scripts'&&['npm','pnpm','yarn','bun'].includes(bin)&&runtime.packageManager!==bin){
      actualBin=runtime.packageManager;
      actualArgs=runtime.packageManager==='npm'?['run',name,'--if-present']:[name];
    }
    const started=Date.now(),wrapped=commandForRuntime(actualBin,actualArgs,runtime),r=runtimeShell(actualBin,actualArgs,cwd,runtime);
    return{name,ok:r.status===0,status:r.status,ms:Date.now()-started,stdout:r.stdout,stderr:r.stderr,commandText:commandText||[bin,...args].join(' '),source:source||plan.source,runtimeCommand:wrapped.flat().join(' ')};
  });
}
function failureDetails(results=[]){
  return results.filter(x=>!x.ok).map(x=>({name:x.name,status:x.status,kind:classifyVerificationFailure(x),command:x.commandText,runtimeCommand:x.runtimeCommand,snippet:verificationOutputSnippet(x)}));
}

export function qualificationReason(q){
  if(!q.preparation?.ok)return'dependency-failure';
  if(!q.before?.length)return'no-verification';
  if(!q.regressionDetected)return'no-regression';
  if(!q.stableRegression)return'unstable-regression';
  if(q.patchApplied===false)return'patch-apply-failure';
  if(q.postPatchPreparation&&!q.postPatchPreparation.ok)return'post-patch-dependency-failure';
  if(!q.groundTruthPass)return'ground-truth-verification-failure';
  return'qualified';
}

export function prioritizeCommits(commits){
  return [...commits].sort((a,b)=>Number(FIX_PATTERN.test(b.subject))-Number(FIX_PATTERN.test(a.subject))||a.index-b.index);
}

export function qualifyTaskDetailed(repo,task,{installDependencies=false,stabilityRuns=2,groundTruthRuns=2,historicalRuntime=true}={}){
  const wt=makeWorktree(repo,'qualify',task.parent);
  try{
    resetWorktreeTo(wt,task.parent);
    const runtime=historicalRuntime?detectHistoricalRuntime(wt):{currentNodeMajor:Number(process.versions.node.split('.')[0]),selectedNodeMajor:Number(process.versions.node.split('.')[0]),source:'current-runtime',workflowNodeMajors:[],engineRange:null,usesHistoricalNode:false,packageManager:'npm',packageManagerVersion:null,packageManagerSource:'current-runtime'};
    const preparation=installDependencies?installForRuntime(wt,runtime):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,failureKind:null};
    const verificationPlan=preparation.ok?historicalVerificationCommands(wt):{source:null,commands:[]};
    const beforeRuns=[];
    if(preparation.ok&&verificationPlan.commands.length){for(let i=0;i<Math.max(1,stabilityRuns);i++)beforeRuns.push(verifyForRuntime(wt,runtime,verificationPlan));}
    const before=beforeRuns[0]||[];
    const regressionDetected=before.some(x=>!x.ok);
    const firstSignature=failureSignature(before);
    const stableRegression=regressionDetected&&beforeRuns.length===Math.max(1,stabilityRuns)&&beforeRuns.every(run=>failureSignature(run)===firstSignature&&failureSignature(run)!=='');

    let patchApplied=null;
    let postPatchPreparation=null;
    let postRuntime=null;
    let groundTruthRunsResults=[];
    let groundTruthPass=false;

    if(preparation.ok&&stableRegression&&before.length){
      const patchPath=join(wt,'.kodematik-qualification.patch');
      writeFileSync(patchPath,task.expectedPatch||'');
      const patch=shell('git',['apply','--whitespace=nowarn',patchPath],{cwd:wt,allowFailure:true});
      rmSync(patchPath,{force:true});
      patchApplied=patch.status===0;
      if(patchApplied){
        postRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime;
        if(installDependencies&&touchesDependencies(task))postPatchPreparation=installForRuntime(wt,postRuntime);
        else postPatchPreparation={ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:postRuntime.packageManager,packageManagerVersion:postRuntime.packageManagerVersion,failureKind:null};
        if(postPatchPreparation.ok){
          for(let i=0;i<Math.max(1,groundTruthRuns);i++)groundTruthRunsResults.push(verifyForRuntime(wt,postRuntime,verificationPlan));
          groundTruthPass=groundTruthRunsResults.length===Math.max(1,groundTruthRuns)&&groundTruthRunsResults.every(run=>run.length>0&&run.every(x=>x.ok));
        }
      }
    }

    const usable=preparation.ok&&before.length>0&&stableRegression&&patchApplied===true&&(postPatchPreparation?.ok??true)&&groundTruthPass;
    return{taskId:task.id,preparation,before,beforeRuns,regressionDetected,stableRegression,failureSignature:firstSignature,failedChecks:failedChecks(before),beforeFailureDetails:failureDetails(before),patchApplied,postPatchPreparation,dependencyRefreshNeeded:touchesDependencies(task),groundTruthRuns:groundTruthRunsResults,groundTruthPass,groundTruthFailedChecks:groundTruthRunsResults.flatMap(failedChecks),groundTruthFailureDetails:failureDetails(groundTruthRunsResults[0]||[]),verificationSource:verificationPlan.source,verificationCommands:verificationPlan.commands.map(x=>x.commandText||x.command.flat().join(' ')),runtime,runtimeSummary:runtimeSummary(runtime),postRuntime,postRuntimeSummary:postRuntime?runtimeSummary(postRuntime):null,usable};
  }finally{removeWorktree(repo,wt);}
}

export function discoverQualifiedTasksSmart(repo,{limit=10,scanLimit=Math.max(limit*10,50),installDependencies=false,historicalRuntime=true}={}){
  const r=shell('git',['log',`--max-count=${scanLimit}`,'--format=%H%x09%s'],{cwd:repo,allowFailure:true});
  const counts={qualified:0,'dependency-failure':0,'no-verification':0,'no-regression':0,'unstable-regression':0,'patch-apply-failure':0,'post-patch-dependency-failure':0,'ground-truth-verification-failure':0};
  if(r.status!==0)return{tasks:[],scanned:0,rejected:0,counts,prioritized:0,diagnostics:[],runtimeCounts:{},dependencyFailureCounts:{},verificationFailureCounts:{}};
  const commits=r.stdout.split('\n').filter(Boolean).map((line,index)=>{const[hash,...parts]=line.split('\t');return{hash,subject:parts.join('\t'),index};});
  const ordered=prioritizeCommits(commits),tasks=[],diagnostics=[],runtimeCounts={},dependencyFailureCounts={},verificationFailureCounts={};
  let scanned=0,prioritized=0;
  for(const commit of ordered){
    if(tasks.length>=limit)break;
    const task=makeTaskFromCommit(repo,commit.hash);
    if(!task)continue;
    scanned++;
    if(FIX_PATTERN.test(commit.subject))prioritized++;
    const qualification=qualifyTaskDetailed(repo,task,{installDependencies,stabilityRuns:2,groundTruthRuns:2,historicalRuntime});
    const reason=qualificationReason(qualification);
    counts[reason]=(counts[reason]||0)+1;
    const runtimeKey=`node-${qualification.runtime.selectedNodeMajor}:${qualification.runtime.source}:${qualification.runtime.packageManager}@${qualification.runtime.packageManagerVersion}`;
    runtimeCounts[runtimeKey]=(runtimeCounts[runtimeKey]||0)+1;
    const depFailure=reason==='dependency-failure'?qualification.preparation?.failureKind:reason==='post-patch-dependency-failure'?qualification.postPatchPreparation?.failureKind:null;
    if(depFailure)dependencyFailureCounts[depFailure]=(dependencyFailureCounts[depFailure]||0)+1;
    if(reason==='ground-truth-verification-failure')for(const detail of qualification.groundTruthFailureDetails||[])verificationFailureCounts[detail.kind]=(verificationFailureCounts[detail.kind]||0)+1;
    const diagnostic={taskId:task.id,title:task.title,reason,failedChecks:qualification.failedChecks,beforeFailureDetails:qualification.beforeFailureDetails,groundTruthFailedChecks:qualification.groundTruthFailedChecks,groundTruthFailureDetails:qualification.groundTruthFailureDetails,verificationSource:qualification.verificationSource,verificationCommands:qualification.verificationCommands,dependencyRefreshNeeded:qualification.dependencyRefreshNeeded,runtime:qualification.runtimeSummary,postRuntime:qualification.postRuntimeSummary,packageManager:qualification.preparation?.packageManager,packageManagerVersion:qualification.preparation?.packageManagerVersion,installCommand:qualification.preparation?.command,runtimeInstallCommand:qualification.preparation?.runtimeCommand,dependencyFailure:depFailure};
    if(reason==='qualified')tasks.push({...task,qualification});else diagnostics.push(diagnostic);
  }
  return{tasks,scanned,rejected:scanned-tasks.length,counts,prioritized,diagnostics,runtimeCounts,dependencyFailureCounts,verificationFailureCounts};
}
