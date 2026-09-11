import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function major(value){const m=String(value||'').match(/(?:^|[^0-9])(\d{1,2})(?:\.|\b)/);return m?Number(m[1]):null;}
function unique(values){return [...new Set(values.filter(Number.isFinite))];}
function readPackage(cwd){const path=join(cwd,'package.json');if(!existsSync(path))return{};try{return JSON.parse(readFileSync(path,'utf8'));}catch{return{};}}
function workflowNodeMajors(cwd){const dir=join(cwd,'.github','workflows');if(!existsSync(dir))return[];const values=[];for(const name of readdirSync(dir)){if(!/\.ya?ml$/i.test(name))continue;const text=readFileSync(join(dir,name),'utf8');for(const match of text.matchAll(/node-version\s*:\s*['"]?([^\n#'"]+)/gi)){const n=major(match[1]);if(n)values.push(n);}for(const match of text.matchAll(/^\s*-\s*['"]?(\d{1,2})(?:\.x)?['"]?\s*$/gm)){const n=Number(match[1]);if(n>=4&&n<=40)values.push(n);}}return unique(values).sort((a,b)=>b-a);}
function fileNodeMajor(cwd){for(const file of ['.nvmrc','.node-version']){const path=join(cwd,file);if(existsSync(path)){const n=major(readFileSync(path,'utf8').trim());if(n)return{major:n,source:file};}}return null;}
function packageNodeMajor(cwd){const pkg=readPackage(cwd),n=major(pkg.engines?.node);return n?{major:n,source:'package.json#engines.node',range:pkg.engines.node}:null;}
function packageManagerField(cwd){const value=readPackage(cwd).packageManager;if(!value)return null;const match=String(value).match(/^(npm|pnpm|yarn|bun)@(.+)$/i);return match?{name:match[1].toLowerCase(),version:match[2],source:'package.json#packageManager'}:null;}
function packageLockVersion(cwd){for(const file of ['package-lock.json','npm-shrinkwrap.json']){const path=join(cwd,file);if(!existsSync(path))continue;try{const value=JSON.parse(readFileSync(path,'utf8')).lockfileVersion;return Number.isFinite(Number(value))?Number(value):null;}catch{return null;}}return null;}
function pnpmLockVersion(cwd){const path=join(cwd,'pnpm-lock.yaml');if(!existsSync(path))return null;const match=readFileSync(path,'utf8').match(/^lockfileVersion:\s*['"]?([^'"\n]+)['"]?/m);return match?Number.parseFloat(match[1]):null;}
function inferNpmVersion(nodeMajor,lockfileVersion){
  if(lockfileVersion===1)return'6';
  if(lockfileVersion===2)return nodeMajor>=16?'8':'7';
  if(lockfileVersion>=3){if(nodeMajor>=20)return'10';if(nodeMajor>=18)return'9';return'8';}
  if(nodeMajor<=4)return'2.15.11';
  if(nodeMajor<=6)return'3.10.10';
  if(nodeMajor<=8)return'5.6.0';
  if(nodeMajor<=14)return'6';
  if(nodeMajor===16)return'8';
  if(nodeMajor===18)return'9';
  if(nodeMajor>=20)return'10';
  return'6';
}
function inferPnpmMajor(nodeMajor,lockfileVersion){if(lockfileVersion>=9)return 9;if(lockfileVersion>=6)return 8;if(nodeMajor>=16)return 8;if(nodeMajor>=14)return 7;return 6;}
export function detectHistoricalPackageManager(cwd,nodeMajor=Number(process.versions.node.split('.')[0])){
  const explicit=packageManagerField(cwd);if(explicit)return explicit;
  if(existsSync(join(cwd,'pnpm-lock.yaml'))){const lock=pnpmLockVersion(cwd);return{name:'pnpm',version:String(inferPnpmMajor(nodeMajor,lock)),source:lock?`pnpm-lock.yaml#${lock}`:'pnpm-lock.yaml'};}
  if(existsSync(join(cwd,'yarn.lock')))return{name:'yarn',version:'1',source:'yarn.lock'};
  if(existsSync(join(cwd,'bun.lock'))||existsSync(join(cwd,'bun.lockb')))return{name:'bun',version:'1',source:'bun-lock'};
  const lock=packageLockVersion(cwd),version=inferNpmVersion(nodeMajor,lock),source=lock?`package-lock#${lock}`:nodeMajor<=8?'node-bundled-era':'node-compatibility';
  return{name:'npm',version,source};
}
export function detectHistoricalRuntime(cwd){const explicit=fileNodeMajor(cwd),workflow=workflowNodeMajors(cwd),pkg=packageNodeMajor(cwd),current=Number(process.versions.node.split('.')[0]);let selected=null,source=null;if(explicit){selected=explicit.major;source=explicit.source;}else if(workflow.length){selected=workflow[0];source='historical-ci';}else if(pkg){selected=pkg.major;source=pkg.source;}const selectedNodeMajor=selected||current,pm=detectHistoricalPackageManager(cwd,selectedNodeMajor);return{currentNodeMajor:current,selectedNodeMajor,source:source||'current-runtime',workflowNodeMajors:workflow,engineRange:pkg?.range||null,usesHistoricalNode:Boolean(selected&&selected!==current),packageManager:pm.name,packageManagerVersion:pm.version,packageManagerSource:pm.source,verificationJobId:null,verificationToolchain:null};}
export function runtimeForVerificationPlan(cwd,runtime,plan){
  if(!runtime)return runtime;
  if(!plan?.nodeMajor)return{...runtime,verificationJobId:plan?.jobId||null,verificationToolchain:plan?.toolchain||null};
  const pm=detectHistoricalPackageManager(cwd,plan.nodeMajor);
  return{...runtime,selectedNodeMajor:plan.nodeMajor,source:plan.jobId?`historical-ci-job:${plan.jobId}`:'historical-ci-job',usesHistoricalNode:plan.nodeMajor!==runtime.currentNodeMajor,packageManager:pm.name,packageManagerVersion:pm.version,packageManagerSource:pm.source,verificationJobId:plan.jobId||null,verificationToolchain:plan.toolchain||'node'};
}
export function dependencyInstallCommandForRuntime(cwd,runtime){const pm=runtime?.packageManager||detectHistoricalPackageManager(cwd).name;if(pm==='pnpm')return['pnpm',existsSync(join(cwd,'pnpm-lock.yaml'))?['install','--frozen-lockfile']:['install']];if(pm==='yarn')return['yarn',existsSync(join(cwd,'yarn.lock'))?['install','--frozen-lockfile']:['install']];if(pm==='bun')return['bun',(existsSync(join(cwd,'bun.lock'))||existsSync(join(cwd,'bun.lockb')))?['install','--frozen-lockfile']:['install']];if(existsSync(join(cwd,'package-lock.json'))||existsSync(join(cwd,'npm-shrinkwrap.json')))return['npm',['ci']];return['npm',['install']];}
export function commandForRuntime(bin,args,runtime){if(!runtime)return[bin,args];const packages=[];if(runtime.selectedNodeMajor&&runtime.selectedNodeMajor!==runtime.currentNodeMajor)packages.push(`node@${runtime.selectedNodeMajor}`);if(['npm','pnpm','yarn','bun'].includes(bin)&&runtime.packageManager===bin&&runtime.packageManagerVersion)packages.push(`${bin}@${runtime.packageManagerVersion}`);if(!packages.length)return[bin,args];return['npx',['--yes',...packages.flatMap(pkg=>['--package',pkg]),bin,...args]];}
export function runtimeSummary(runtime){const tested=runtime.workflowNodeMajors.length?` · historical CI [${runtime.workflowNodeMajors.join(', ')}]`:'';const engines=runtime.engineRange?` · engines ${runtime.engineRange}`:'';const pm=runtime.packageManager?` · ${runtime.packageManager}@${runtime.packageManagerVersion} (${runtime.packageManagerSource})`:'';const job=runtime.verificationJobId?` · job ${runtime.verificationJobId}`:'';return`Node ${runtime.selectedNodeMajor} (${runtime.source})${tested}${engines}${pm}${job}`;}
