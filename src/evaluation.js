import {
  shell,
  makeWorktree,
  removeWorktree,
  resetWorktreeTo,
  detectRepo,
  verificationCommands,
  createCandidateInstructions,
  changedFiles,
  gitDiff,
  scoreVerification,
  summarizeResults,
  runCodexTask,
} from './core.js';
import { detectHistoricalRuntime, commandForRuntime, dependencyInstallCommandForRuntime, runtimeSummary } from './runtime.js';

function runtimeShell(bin,args,cwd,runtime,{timeout=180000}={}){const[runtimeBin,runtimeArgs]=commandForRuntime(bin,args,runtime);return shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});}
function installForRuntime(cwd,runtime,{timeout=300000}={}){const[bin,args]=dependencyInstallCommandForRuntime(cwd,runtime),r=runtimeShell(bin,args,cwd,runtime,{timeout});return{ok:r.status===0,skipped:false,packageManager:runtime.packageManager,packageManagerVersion:runtime.packageManagerVersion,command:[bin,...args].join(' '),runtimeCommand:commandForRuntime(bin,args,runtime).flat().join(' '),status:r.status,stdout:r.stdout,stderr:r.stderr};}
function verifyForRuntime(cwd,runtime,commands=verificationCommands(cwd)){return commands.map(({name,command:[bin,args]})=>{const actualBin=['npm','pnpm','yarn','bun'].includes(bin)?runtime.packageManager:bin,actualArgs=actualBin===bin?args:(runtime.packageManager==='npm'?['run',name,'--if-present']:[name]),started=Date.now(),r=runtimeShell(actualBin,actualArgs,cwd,runtime);return{name,ok:r.status===0,status:r.status,ms:Date.now()-started,stdout:r.stdout,stderr:r.stderr};});}

export function evaluateTask(repo,task,{candidate=false,mutation=null,runAgent=true,model,installDependencies=false,agentRunner=runCodexTask,maxTurns,historicalRuntime=true}={}){
  const label=mutation?.id||(candidate?'candidate':'baseline'),wt=makeWorktree(repo,label,task.parent);
  try{
    resetWorktreeTo(wt,task.parent);
    const runtime=historicalRuntime?detectHistoricalRuntime(wt):null;
    const preparation=installDependencies?installForRuntime(wt,runtime):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime?.packageManager||null,packageManagerVersion:runtime?.packageManagerVersion||null};
    const info=detectRepo(wt),before=preparation.ok?verifyForRuntime(wt,runtime):[],regressionDetected=before.some(x=>!x.ok);
    if(!preparation.ok||!regressionDetected||before.length===0){return{taskId:task.id,title:task.title,variant:mutation?.id||(candidate?'candidate':'baseline'),score:scoreVerification(before),preparation,before,after:before,agent:{ok:false,status:0,usage:null,events:[],stderr:'skipped: task is not a usable regression'},files:[],testFilesTouched:[],diff:'',regressionDetected,usable:false,pass:false,runtime,runtimeSummary:runtime?runtimeSummary(runtime):'current runtime'};}
    if(mutation)mutation.apply(wt,info);else if(candidate)createCandidateInstructions(wt,info);
    const agent=runAgent?agentRunner(wt,task.prompt,{model,task,mutation,maxTurns}):{ok:true,status:0,usage:null,events:[],stderr:''};
    const afterRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime,after=verifyForRuntime(wt,afterRuntime),files=changedFiles(wt),score=scoreVerification(after),testFilesTouched=files.filter(f=>/(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\./i.test(f)),usable=true;
    return{taskId:task.id,title:task.title,variant:mutation?.id||(candidate?'candidate':'baseline'),score,preparation,before,after,agent,files,testFilesTouched,diff:gitDiff(wt),regressionDetected,usable,pass:usable&&after.every(x=>x.ok)&&testFilesTouched.length===0,runtime,runtimeSummary:runtime?runtimeSummary(runtime):'current runtime',afterRuntime,afterRuntimeSummary:afterRuntime?runtimeSummary(afterRuntime):'current runtime'};
  }finally{removeWorktree(repo,wt);}
}

export function evaluateSuite(repo,tasks,options={}){const results=tasks.map(task=>evaluateTask(repo,task,options));return{results,summary:summarizeResults(results)};}
