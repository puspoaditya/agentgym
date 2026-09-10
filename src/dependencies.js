import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shell } from './core.js';
import { commandForRuntime, dependencyInstallCommandForRuntime } from './runtime.js';

function hasNpmLockfile(cwd){return existsSync(join(cwd,'package-lock.json'))||existsSync(join(cwd,'npm-shrinkwrap.json'));}
function hasAnyLockfile(cwd,runtime){if(runtime?.packageManager==='npm')return hasNpmLockfile(cwd);if(runtime?.packageManager==='pnpm')return existsSync(join(cwd,'pnpm-lock.yaml'));if(runtime?.packageManager==='yarn')return existsSync(join(cwd,'yarn.lock'));if(runtime?.packageManager==='bun')return existsSync(join(cwd,'bun.lock'))||existsSync(join(cwd,'bun.lockb'));return false;}

export function historicalResolutionDate(repo,commit){
  if(!repo||!commit)return null;
  const result=shell('git',['show','-s','--format=%cI',commit],{cwd:repo,allowFailure:true});
  if(result.status!==0||!result.stdout)return null;
  const date=new Date(result.stdout.trim());
  return Number.isNaN(date.getTime())?null:date.toISOString();
}

export function historicalDependencyPlan(cwd,runtime,{resolutionDate=null}={}){
  const[bin,baseArgs]=dependencyInstallCommandForRuntime(cwd,runtime),args=[...baseArgs],locked=hasAnyLockfile(cwd,runtime);
  let resolutionMode=locked?'lockfile':'unbounded-fallback';
  if(bin==='npm'&&!locked&&resolutionDate){
    args.push(`--before=${resolutionDate}`,'--no-package-lock');
    resolutionMode='commit-date-cutoff';
  }
  return{bin,args,locked,resolutionMode,resolutionDate:resolutionMode==='commit-date-cutoff'?resolutionDate:null,command:[bin,...args].join(' ')};
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
  const plan=historicalDependencyPlan(cwd,runtime,{resolutionDate}),[runtimeBin,runtimeArgs]=commandForRuntime(plan.bin,plan.args,runtime),result=shell(runtimeBin,runtimeArgs,{cwd,allowFailure:true,timeout});
  const preparation={ok:result.status===0,skipped:false,packageManager:runtime?.packageManager||plan.bin,packageManagerVersion:runtime?.packageManagerVersion||null,command:plan.command,runtimeCommand:[runtimeBin,...runtimeArgs].join(' '),status:result.status,stdout:result.stdout,stderr:result.stderr,resolutionMode:plan.resolutionMode,resolutionDate:plan.resolutionDate,locked:plan.locked};
  return{...preparation,failureKind:preparation.ok?null:classifyDependencyFailure(preparation)};
}
