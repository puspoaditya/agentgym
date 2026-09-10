import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shell } from './core.js';
import { commandForRuntime, dependencyInstallCommandForRuntime } from './runtime.js';

function hasNpmLockfile(cwd){return existsSync(join(cwd,'package-lock.json'))||existsSync(join(cwd,'npm-shrinkwrap.json'));}
function hasAnyLockfile(cwd,runtime){if(runtime?.packageManager==='npm')return hasNpmLockfile(cwd);if(runtime?.packageManager==='pnpm')return existsSync(join(cwd,'pnpm-lock.yaml'));if(runtime?.packageManager==='yarn')return existsSync(join(cwd,'yarn.lock'));if(runtime?.packageManager==='bun')return existsSync(join(cwd,'bun.lock'))||existsSync(join(cwd,'bun.lockb'));return false;}
function npmMajor(runtime){const value=Number.parseInt(String(runtime?.packageManagerVersion||''),10);return Number.isFinite(value)?value:null;}
function readPackage(cwd){try{return JSON.parse(readFileSync(join(cwd,'package.json'),'utf8'));}catch{return{};}}
function legacyRootLifecycle(cwd){const scripts=readPackage(cwd).scripts||{};return['preinstall','install','postinstall','prepublish'].filter(name=>scripts[name]).map(name=>({bin:'npm',args:['run',name],role:`root-${name}`}));}

export function historicalResolutionDate(repo,commit){
  if(!repo||!commit)return null;
  const result=shell('git',['show','-s','--format=%cI',commit],{cwd:repo,allowFailure:true});
  if(result.status!==0||!result.stdout)return null;
  const date=new Date(result.stdout.trim());
  return Number.isNaN(date.getTime())?null:date.toISOString();
}

export function historicalDependencyPlan(cwd,runtime,{resolutionDate=null}={}){
  const[bin,baseArgs]=dependencyInstallCommandForRuntime(cwd,runtime),locked=hasAnyLockfile(cwd,runtime),steps=[];
  let resolutionMode=locked?'lockfile':'unbounded-fallback';
  if(bin==='npm'&&!locked&&resolutionDate){
    const historicalNpmMajor=npmMajor(runtime);
    if(historicalNpmMajor&&historicalNpmMajor<6){
      const resolverRuntime={...runtime,selectedNodeMajor:14,packageManager:'npm',packageManagerVersion:'6',packageManagerSource:'legacy-cutoff-resolver',source:'legacy-cutoff-resolver'};
      steps.push({bin:'npm',args:['install',`--before=${resolutionDate}`,'--no-package-lock','--ignore-scripts'],runtime:resolverRuntime,role:'resolve'});
      steps.push({bin:'npm',args:['rebuild'],runtime,role:'rebuild'});
      for(const step of legacyRootLifecycle(cwd))steps.push({...step,runtime});
      resolutionMode='legacy-two-phase-cutoff';
    }else{
      steps.push({bin:'npm',args:[...baseArgs,`--before=${resolutionDate}`,'--no-package-lock'],runtime,role:'install'});
      resolutionMode='commit-date-cutoff';
    }
  }else steps.push({bin,args:[...baseArgs],runtime,role:'install'});
  const command=steps.map(step=>[step.bin,...step.args].join(' ')).join(' && ');
  return{bin,args:steps[0]?.args||baseArgs,locked,resolutionMode,resolutionDate:['commit-date-cutoff','legacy-two-phase-cutoff'].includes(resolutionMode)?resolutionDate:null,command,steps};
}

export function classifyDependencyFailure(preparation={}){
  const text=`${preparation.stderr||''}\n${preparation.stdout||''}`.toLowerCase();
  if(/no matching version|notarget|before=.*(?:no|none)|versions? available on or before/.test(text))return'historical-resolution';
  if(/unsupported engine|ebadengine|engine .*node/.test(text))return'node-engine';
  if(/lockfile|package-lock|npm-shrinkwrap|frozen-lockfile|out of date|synchronized/.test(text))return'lockfile';
  if(/eresolve|dependency conflict|peer dep|peer dependency/.test(text))return'dependency-resolution';
  if(/not found|enoent|command not found|could not determine executable/.test(text))return'missing-tool';
  if(/network|econn|etimedout|enotfound|fetch failed|socket/.test(text))return'network';
  return'install-command';
}

export function installForHistoricalRuntime(cwd,runtime,{resolutionDate=null,timeout=300000}={}){
  const plan=historicalDependencyPlan(cwd,runtime,{resolutionDate}),outputs=[],runtimeCommands=[];
  let status=0,failedStep=null;
  for(const step of plan.steps){
    const[runtimeBin,runtimeArgs]=commandForRuntime(step.bin,step.args,step.runtime||runtime),runtimeCommand=[runtimeBin,...runtimeArgs].join(' ');
    runtimeCommands.push(runtimeCommand);
    const result=shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});
    outputs.push({role:step.role,status:result.status,stdout:result.stdout,stderr:result.stderr,runtimeCommand});
    if(result.status!==0){status=result.status;failedStep=step.role;break;}
  }
  const stdout=outputs.map(x=>x.stdout).filter(Boolean).join('\n'),stderr=outputs.map(x=>x.stderr).filter(Boolean).join('\n');
  const preparation={ok:status===0,skipped:false,packageManager:runtime?.packageManager||plan.bin,packageManagerVersion:runtime?.packageManagerVersion||null,command:plan.command,runtimeCommand:runtimeCommands.join(' && '),status,stdout,stderr,resolutionMode:plan.resolutionMode,resolutionDate:plan.resolutionDate,locked:plan.locked,failedStep,steps:outputs};
  return{...preparation,failureKind:preparation.ok?null:classifyDependencyFailure(preparation)};
}
