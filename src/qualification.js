import { shell, makeTaskFromCommit, qualifyTask } from './core.js';

const FIX_PATTERN=/\b(fix(?:ed|es)?|bug(?:fix)?|regression|correct(?:ion|ed|s)?|repair|resolve[ds]?|patch)\b/i;

export function qualificationReason(q){
  if(!q.preparation?.ok)return'dependency-failure';
  if(!q.before?.length)return'no-verification';
  if(!q.regressionDetected)return'no-regression';
  if(!q.stableRegression)return'unstable-regression';
  if(!q.groundTruthPass)return'ground-truth-failed';
  return'qualified';
}

export function prioritizeCommits(commits){
  return [...commits].sort((a,b)=>Number(FIX_PATTERN.test(b.subject))-Number(FIX_PATTERN.test(a.subject))||a.index-b.index);
}

export function discoverQualifiedTasksSmart(repo,{limit=10,scanLimit=Math.max(limit*10,50),installDependencies=false}={}){
  const r=shell('git',['log',`--max-count=${scanLimit}`,'--format=%H%x09%s'],{cwd:repo,allowFailure:true});
  const counts={qualified:0,'dependency-failure':0,'no-verification':0,'no-regression':0,'unstable-regression':0,'ground-truth-failed':0};
  if(r.status!==0)return{tasks:[],scanned:0,rejected:0,counts,prioritized:0};
  const commits=r.stdout.split('\n').filter(Boolean).map((line,index)=>{const[hash,...parts]=line.split('\t');return{hash,subject:parts.join('\t'),index};});
  const ordered=prioritizeCommits(commits),tasks=[];
  let scanned=0,prioritized=0;
  for(const commit of ordered){
    if(tasks.length>=limit)break;
    const task=makeTaskFromCommit(repo,commit.hash);
    if(!task)continue;
    scanned++;
    if(FIX_PATTERN.test(commit.subject))prioritized++;
    const qualification=qualifyTask(repo,task,{installDependencies,verifyGroundTruth:true,stabilityRuns:2});
    const reason=qualificationReason(qualification);
    counts[reason]=(counts[reason]||0)+1;
    if(reason==='qualified')tasks.push({...task,qualification});
  }
  return{tasks,scanned,rejected:scanned-tasks.length,counts,prioritized};
}
