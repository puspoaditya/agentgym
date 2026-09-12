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
import { historicalVerificationCommands, taskTestFiles } from './verification.js';
import { installForHistoricalRuntime, historicalResolutionDate } from './dependencies.js';
import { rememberFailureProfile, failureProfileFor } from './failure-analysis.js';

function runtimeShell(bin,args,cwd,runtime,{timeout=180000}={}){const[runtimeBin,runtimeArgs]=commandForRuntime(bin,args,runtime);return shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});}
function verifyForRuntime(cwd,runtime,plan=historicalVerificationCommands(cwd)){
  return plan.commands.map(({name,command:[bin,args],commandText,source,family='other',targeted=false,costClass='unknown'})=>{
    let actualBin=bin,actualArgs=args;
    if(source==='package-scripts'&&['npm','pnpm','yarn','bun'].includes(bin)&&runtime?.packageManager&&runtime.packageManager!==bin){actualBin=runtime.packageManager;actualArgs=runtime.packageManager==='npm'?['run',name,'--if-present']:[name];}
    const started=Date.now(),r=runtimeShell(actualBin,actualArgs,cwd,runtime);
    return{name,ok:r.status===0,status:r.status,ms:Date.now()-started,stdout:r.stdout,stderr:r.stderr,commandText:commandText||[bin,...args].join(' '),source:source||plan.source,jobId:plan.jobId||null,toolchain:plan.toolchain||null,family,targeted,costClass};
  });
}
function currentRuntime(){const n=Number(process.versions.node.split('.')[0]);return{currentNodeMajor:n,selectedNodeMajor:n,source:'current-runtime',workflowNodeMajors:[],engineRange:null,usesHistoricalNode:false,packageManager:'npm',packageManagerVersion:null,packageManagerSource:'current-runtime',verificationJobId:null,verificationToolchain:null};}
function stageHistoricalTestOracle(cwd,task,files=taskTestFiles(task)){
  const staged=[];
  for(const file of files){
    const exists=shell('git',['cat-file','-e',`${task.commit}:${file}`],{cwd,allowFailure:true});if(exists.status!==0)continue;
    const checkout=shell('git',['checkout',task.commit,'--',file],{cwd,allowFailure:true});if(checkout.status===0)staged.push(file);
  }
  return staged;
}
function substantiveTestFailure(result={}){
  if(result.ok||result.family!=='test')return false;
  const text=`${result.stdout||''}\n${result.stderr||''}`.toLowerCase();
  return !/(cannot find module|module not found|command not found|unknown option|enoent|ebadengine|no test files found|no tests found)/.test(text);
}
function oracleFileMatches(cwd,task,file){
  const actual=shell('git',['hash-object',file],{cwd,allowFailure:true}),expected=shell('git',['rev-parse',`${task.commit}:${file}`],{cwd,allowFailure:true});
  return actual.status===0&&expected.status===0&&actual.stdout===expected.stdout;
}
function sameList(a=[],b=[]){return a.length===b.length&&a.every((value,index)=>value===b[index]);}
function qualificationPlanMatches(task,plan,oracleFiles){
  const q=task.qualification;if(!q)return true;
  return q.verificationSource===plan.source&&(q.verificationJobId||null)===(plan.jobId||null)&&(q.verificationStrategy||null)===(plan.strategy||null)&&sameList(q.verificationCommands||[],plan.commands.map(x=>x.commandText||x.command.flat().join(' ')))&&sameList(q.testOracleFiles||[],oracleFiles);
}

export function evaluateTask(repo,task,{candidate=false,mutation=null,runAgent=true,model,installDependencies=false,agentRunner=runCodexTask,maxTurns,historicalRuntime=true}={}){
  const label=mutation?.id||(candidate?'candidate':'baseline'),wt=makeWorktree(repo,label,task.parent),resolutionDate=historicalResolutionDate(repo,task.commit);
  try{
    resetWorktreeTo(wt,task.parent);
    const requestedOracleFiles=task.qualification?.testOracleFiles?.length?task.qualification.testOracleFiles:taskTestFiles(task),testOracleFiles=stageHistoricalTestOracle(wt,task,requestedOracleFiles),verificationPlan=historicalVerificationCommands(wt,{testFiles:testOracleFiles}),planLocked=qualificationPlanMatches(task,verificationPlan,testOracleFiles),baseRuntime=historicalRuntime?detectHistoricalRuntime(wt):currentRuntime(),runtime=runtimeForVerificationPlan(wt,baseRuntime,verificationPlan);
    const preparation=installDependencies?installForHistoricalRuntime(wt,runtime,{resolutionDate}):{ok:true,skipped:true,command:null,status:0,stdout:'',stderr:'',packageManager:runtime?.packageManager||null,packageManagerVersion:runtime?.packageManagerVersion||null,resolutionMode:'skipped',resolutionDate:null};
    const info=detectRepo(wt),before=preparation.ok&&planLocked?verifyForRuntime(wt,runtime,verificationPlan):[],regressionDetected=before.some(x=>!x.ok),testRegressionDetected=before.some(substantiveTestFailure);
    const verificationMeta={verificationSource:verificationPlan.source,verificationJobId:verificationPlan.jobId||null,verificationJobName:verificationPlan.jobName||null,verificationToolchain:verificationPlan.toolchain||null,verificationStrategy:verificationPlan.strategy||null,verificationCommands:verificationPlan.commands.map(x=>x.commandText||x.command.flat().join(' ')),verificationTestFiles:verificationPlan.testFiles||[],testOracleFiles,verificationPlanLocked:planLocked,verificationOmittedJobs:verificationPlan.omittedJobs||[]};
    if(!preparation.ok||!planLocked||!regressionDetected||!testRegressionDetected||before.length===0){const why=!planLocked?'qualification verification plan mismatch':!testRegressionDetected?'no substantive targeted test regression':'task is not a usable regression';return{taskId:task.id,title:task.title,variant:mutation?.id||(candidate?'candidate':'baseline'),score:scoreVerification(before),preparation,before,after:before,agent:{ok:false,status:0,usage:null,events:[],stderr:`skipped: ${why}`},files:[],testFilesTouched:[],modifiedOracleFiles:[],diff:'',regressionDetected,testRegressionDetected,usable:false,pass:false,runtime,runtimeSummary:runtime?runtimeSummary(runtime):'current runtime',...verificationMeta,dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate};}
    const failureProfile=failureProfileFor(repo,task.id);
    if(mutation)mutation.apply(wt,info,{task,before,verificationPlan,testOracleFiles,failureProfile});else if(candidate)createCandidateInstructions(wt,info);
    const agent=runAgent?agentRunner(wt,task.prompt,{model,task,mutation,maxTurns}):{ok:true,status:0,usage:null,events:[],stderr:''};
    const afterBaseRuntime=historicalRuntime?detectHistoricalRuntime(wt):runtime,afterRuntime=runtimeForVerificationPlan(wt,afterBaseRuntime,verificationPlan),after=verifyForRuntime(wt,afterRuntime,verificationPlan),modifiedOracleFiles=testOracleFiles.filter(file=>!oracleFileMatches(wt,task,file)),rawFiles=changedFiles(wt),oracleSet=new Set(testOracleFiles),modifiedOracleSet=new Set(modifiedOracleFiles),files=rawFiles.filter(file=>!oracleSet.has(file)||modifiedOracleSet.has(file)),score=scoreVerification(after),testFilesTouched=files.filter(f=>/(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\./i.test(f)),usable=true;
    const result={taskId:task.id,title:task.title,variant:mutation?.id||(candidate?'candidate':'baseline'),score,preparation,before,after,agent,files,testFilesTouched,modifiedOracleFiles,diff:gitDiff(wt),regressionDetected,testRegressionDetected,usable,pass:usable&&after.length>0&&after.every(x=>x.ok)&&modifiedOracleFiles.length===0&&testFilesTouched.length===0,runtime,runtimeSummary:runtime?runtimeSummary(runtime):'current runtime',afterRuntime,afterRuntimeSummary:afterRuntime?runtimeSummary(afterRuntime):'current runtime',...verificationMeta,dependencyResolutionMode:preparation.resolutionMode,dependencyResolutionDate:preparation.resolutionDate||resolutionDate};
    if(!mutation&&!candidate&&runAgent)rememberFailureProfile(repo,task.id,result);
    return result;
  }finally{removeWorktree(repo,wt);}
}

export function evaluateSuite(repo,tasks,options={}){const results=tasks.map(task=>evaluateTask(repo,task,options));return{results,summary:summarizeResults(results)};}
