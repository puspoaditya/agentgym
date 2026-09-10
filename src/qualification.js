import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  shell,
  makeTaskFromCommit,
  makeWorktree,
  removeWorktree,
  resetWorktreeTo,
  installRepositoryDependencies,
  verificationCommands,
  runVerification,
} from './core.js';

const FIX_PATTERN=/\b(fix(?:ed|es)?|bug(?:fix)?|regression|correct(?:ion|ed|s)?|repair|resolve[ds]?|patch|crash|broken|failure|incorrect|wrong)\b/i;
const DEPENDENCY_FILES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml']);

function failedChecks(results=[]){return results.filter(x=>!x.ok).map(x=>`${x.name}:${x.status}`).sort();}
function failureSignature(results=[]){return failedChecks(results).join('|');}
function touchesDependencies(task){return (task.touchedFiles||[]).some(file=>DEPENDENCY_FILES.has(file.split('/').pop())||DEPENDENCY_FILES.has(file));}

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

export function qualifyTaskDetailed(repo,task,{installDependencies=false,stabilityRuns=2,groundTruthRuns=2}={}){
  const wt=makeWorktree(repo,'qualify',task.parent);
  try{
    resetWorktreeTo(wt,task.parent);
    const preparation=installDependencies?installRepositoryDependencies(wt):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:''};
    const commands=preparation.ok?verificationCommands(wt):[];
    const beforeRuns=[];
    if(preparation.ok&&commands.length){
      for(let i=0;i<Math.max(1,stabilityRuns);i++)beforeRuns.push(runVerification(wt,commands));
    }
    const before=beforeRuns[0]||[];
    const regressionDetected=before.some(x=>!x.ok);
    const firstSignature=failureSignature(before);
    const stableRegression=regressionDetected&&beforeRuns.length===Math.max(1,stabilityRuns)&&beforeRuns.every(run=>failureSignature(run)===firstSignature&&failureSignature(run)!=='');

    let patchApplied=null;
    let postPatchPreparation=null;
    let groundTruthRunsResults=[];
    let groundTruthPass=false;

    if(preparation.ok&&stableRegression&&before.length){
      const patchPath=join(wt,'.kodematik-qualification.patch');
      writeFileSync(patchPath,task.expectedPatch||'');
      const patch=shell('git',['apply','--whitespace=nowarn',patchPath],{cwd:wt,allowFailure:true});
      rmSync(patchPath,{force:true});
      patchApplied=patch.status===0;
      if(patchApplied){
        if(installDependencies&&touchesDependencies(task))postPatchPreparation=installRepositoryDependencies(wt);
        else postPatchPreparation={ok:true,skipped:true,command:null,status:0,stdout:'',stderr:''};
        if(postPatchPreparation.ok){
          const postCommands=verificationCommands(wt);
          for(let i=0;i<Math.max(1,groundTruthRuns);i++)groundTruthRunsResults.push(runVerification(wt,postCommands));
          groundTruthPass=groundTruthRunsResults.length===Math.max(1,groundTruthRuns)&&groundTruthRunsResults.every(run=>run.length>0&&run.every(x=>x.ok));
        }
      }
    }

    const usable=preparation.ok&&before.length>0&&stableRegression&&patchApplied===true&&(postPatchPreparation?.ok??true)&&groundTruthPass;
    return{
      taskId:task.id,
      preparation,
      before,
      beforeRuns,
      regressionDetected,
      stableRegression,
      failureSignature:firstSignature,
      failedChecks:failedChecks(before),
      patchApplied,
      postPatchPreparation,
      dependencyRefreshNeeded:touchesDependencies(task),
      groundTruthRuns:groundTruthRunsResults,
      groundTruthPass,
      groundTruthFailedChecks:groundTruthRunsResults.flatMap(failedChecks),
      usable,
    };
  }finally{
    removeWorktree(repo,wt);
  }
}

export function discoverQualifiedTasksSmart(repo,{limit=10,scanLimit=Math.max(limit*10,50),installDependencies=false}={}){
  const r=shell('git',['log',`--max-count=${scanLimit}`,'--format=%H%x09%s'],{cwd:repo,allowFailure:true});
  const counts={qualified:0,'dependency-failure':0,'no-verification':0,'no-regression':0,'unstable-regression':0,'patch-apply-failure':0,'post-patch-dependency-failure':0,'ground-truth-verification-failure':0};
  if(r.status!==0)return{tasks:[],scanned:0,rejected:0,counts,prioritized:0,diagnostics:[]};
  const commits=r.stdout.split('\n').filter(Boolean).map((line,index)=>{const[hash,...parts]=line.split('\t');return{hash,subject:parts.join('\t'),index};});
  const ordered=prioritizeCommits(commits),tasks=[],diagnostics=[];
  let scanned=0,prioritized=0;
  for(const commit of ordered){
    if(tasks.length>=limit)break;
    const task=makeTaskFromCommit(repo,commit.hash);
    if(!task)continue;
    scanned++;
    if(FIX_PATTERN.test(commit.subject))prioritized++;
    const qualification=qualifyTaskDetailed(repo,task,{installDependencies,stabilityRuns:2,groundTruthRuns:2});
    const reason=qualificationReason(qualification);
    counts[reason]=(counts[reason]||0)+1;
    if(reason==='qualified')tasks.push({...task,qualification});
    else diagnostics.push({taskId:task.id,title:task.title,reason,failedChecks:qualification.failedChecks,groundTruthFailedChecks:qualification.groundTruthFailedChecks,dependencyRefreshNeeded:qualification.dependencyRefreshNeeded});
  }
  return{tasks,scanned,rejected:scanned-tasks.length,counts,prioritized,diagnostics};
}
