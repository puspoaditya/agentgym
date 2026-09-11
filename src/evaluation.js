import {
  shell,
  makeWorktree,
  removeWorktree,
  resetWorktreeTo,
  detectRepo,
  createCandidateInstructions,
  changedFiles,
  gitDiff,
  scoreVerification,
  summarizeResults,
  runCodexTask,
} from './core.js';
import { detectHistoricalRuntime, commandForRuntime, runtimeSummary, runtimeForVerificationPlan } from './runtime.js';
import { historicalVerificationCommands } from './verification.js';
import { installForHistoricalRuntime, historicalResolutionDate } from './dependencies.js';

function runtimeShell(bin,args,cwd,runtime,{timeout=180000}={}){const[runtimeBin,runtimeArgs]=commandForRuntime(bin,args,runtime);return shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});}
function verifyForRuntime(cwd,runtime,plan=historicalVerificationCommands(cwd)){
  return plan.commands.map(({name,command:[bin,args],commandText,source})=>{
    let actualBin=bin,actualArgs=args;
    if(source==='package-scripts'&&['npm','pnpm','yarn','bun'].includes(bin)&&runtime?.packageManager&&runtime.packageManager!==bin){actualBin=runtime.packageManager;actualArgs=runtime.packageManager==='npm'?['run',name,'--if-present']:[name];}
    const started=Date.now(),r=runtimeShell(actualBin,actualArgs,cwd,runtime);
    return{name,ok:r.status===0,status:r.status,ms:Date.now()-started,stdout:r.stdout,stderr:r.stderr,commandText:commandText||[bin,...args].join(' '),source:source||plan.source,jobId:plan.jobId||null,toolchain:plan.toolchain||null};
  });
}
function currentRuntime(){const n=Number(process.versions.node.split('.')[0]);return{currentNodeMajor:n,selectedNodeMajor:n,source:'current-runtime',workflowNodeMajors:[],engineRange:null,usesHistoricalNode:false,packageManager:'npm',packageManagerVersion:null,packageManagerSource:'current-runtime',verificationJobId:null,verificationToolchain:null};}

export function evaluateTask(repo,task,{candidate=false,mutation=null,runAgent=true,model,installDependencies=false,agentRunner=runCodexTask,maxTurns,historicalRuntime=true}={}){
  const label=mutation?.id||(candidate?'candidate':'baseline'),wt=makeWorktree(repo,label,task.parent),resolutionDate=historicalResolutionDate(repo,task.commit);
  try{
    resetWorktreeTo(wt,task.parent);
    const verificationPlan=historicalVerificationCommands(wt),baseRuntime=historicalRuntime?detectHistoricalRuntime(wt):currentRuntime(),runtime=runtimeForVerificationPlan(wt,baseRuntime,verificationPlan);
    const preparation=installDependencies?installForHistoricalRuntime(wt,runtime,{resolutionDate}):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime?.packageManager||null,packageManagerVersion:runtime?.packageManagerVersion||null,resolutionMode:'skipped',resolutionDate:null};
    const info=detectRepo(wt),before=preparation.ok?verifyForRuntime(wt,runtime,verificationPlan):[],regressionDetected=before.some(x=>!x.ok);
    const verificationMeta={verificationSource:verificationPlan.source,verificationJobId:verificationPlan.jobId||null,verificationJobName:verificationPlan.jobName||null,verificationToolchain:verificationPlan.toolchain||null,verificationCommands:verificationPlan.commands.map(x=>x.commandText||x.command.flat().join(' ')),verificationOmittedJobs:verificationPlan.omittedJobs||[]};
    if(!preparation.ok||!regressionDetected||before.length===0){return{taskId:task.id,title:task.title,variant:mutation?.id||(candidate?'candidate':'baseline'),score:scoreVerification(before),preparation,before,after:before,agent:{ok:false,status:0,usage:null,events:[],stderr:'skipped: task is not a usable regression'},files:[],testFilesTouched:[],diff:'',regressionDetected,usable:false,pass:false,runtime,runtimeSummary:runtime?runtimeSummary(runtime):'current runtime',...verificationMeta,dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate};}
    if(mutation)mutation.apply(wt,info);else if(candidate)createCandidateInstructions(wt,info);
    const agent=runAgent?agentRunner(wt,task.prompt,{model,task,mutation,maxTurns}):{ok:true,status:0,usage:null,events:[],stderr:''};
    const afterBaseRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime,afterRuntime=runtimeForVerificationPlan(wt,afterBaseRuntime,verificationPlan),after=verifyForRuntime(wt,afterRuntime,verificationPlan),files=changedFiles(wt),score=scoreVerification(after),testFilesTouched=files.filter(f=>/(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\./i.test(f)),usable=true;
    return{taskId:task.id,title:task.title,variant:mutation?.id||(candidate?'candidate':'baseline'),score,preparation,before,after,agent,files,testFilesTouched,diff:gitDiff(wt),regressionDetected,usable,pass:usable&&after.every(x=>x.ok)&&testFilesTouched.length===0,runtime,runtimeSummary:runtime?runtimeSummary(runtime):'current runtime',afterRuntime,afterRuntimeSummary:afterRuntime?runtimeSummary(afterRuntime):'current runtime',...verificationMeta,dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate};
  }finally{removeWorktree(repo,wt);}
}

export function evaluateSuite(repo,tasks,options={}){const results=tasks.map(task=>evaluateTask(repo,task,options));return{results,summary:summarizeResults(results)};}
