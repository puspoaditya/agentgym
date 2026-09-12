import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageManager } from './core.js';

function existing(cwd){const p=join(cwd,'AGENTS.md');return existsSync(p)?readFileSync(p,'utf8').trim():'';}
function verification(info,cwd){const s=info.scripts||{},pm=packageManager(cwd),cmd=n=>pm==='npm'?`npm run ${n}`:`${pm} ${n}`,out=[];if(s.test)out.push(pm==='npm'?'npm test':`${pm} test`);if(s.typecheck)out.push(cmd('typecheck'));else if(s['type-check'])out.push(cmd('type-check'));if(s.lint)out.push(cmd('lint'));return out;}
function write(cwd,title,rules,info){const prior=existing(cwd),checks=verification(info,cwd),parts=[];if(prior)parts.push(prior,'','---','');parts.push(`# Kodematik candidate: ${title}`,'',...rules.map(x=>`- ${x}`));if(checks.length)parts.push('','## Repository verification',...checks.map(x=>`- \`${x}\``));parts.push('');writeFileSync(join(cwd,'AGENTS.md'),parts.join('\n'));}
function unique(values=[]){return[...new Set(values.filter(Boolean))];}
function compactList(values=[],max=4){const shown=values.slice(0,max);return shown.length<values.length?[...shown,`+${values.length-shown.length} more`]:shown;}
function exactChecks(context={},profile={}){return unique(profile.verificationCommands?.length?profile.verificationCommands:(context.verificationPlan?.commands||[]).map(x=>x.commandText||x.command?.flat?.().join(' ')));}
function oracleFiles(context={},profile={}){return unique(profile.oracleFiles?.length?profile.oracleFiles:(context.testOracleFiles||[]));}

export function failureRules(profile={},context={},mode='localized'){
  const oracle=oracleFiles(context,profile),checks=exactChecks(context,profile),rules=[];
  if(oracle.length)rules.push(`Treat the staged regression oracle as the specification. Read these files before editing production code: ${compactList(oracle).join(', ')}.`);
  if(checks.length)rules.push(`Use the narrow locked verification first and again after the patch: ${compactList(checks,2).map(x=>`\`${x}\``).join(' ; ')}.`);
  if(profile.didNotReadOracle)rules.push('The baseline agent did not read the regression oracle. Do not infer behavior from the task title alone; inspect the failing assertions and inputs first.');
  if(profile.didNotRunTargetedVerification)rules.push('The baseline agent did not run the locked targeted verification. Reproduce the failure before broad exploration and reserve time to rerun the same check after editing.');
  if(profile.noProductionEdit)rules.push('The baseline produced no production-code edit. After diagnosis, make the smallest source change that explains the failing oracle instead of stopping at analysis.');
  if(profile.turnExhausted)rules.push('The baseline exhausted its tool-call budget. Spend at most two early turns locating the failing path, edit by the middle of the run, and keep the final turns for the locked verification. Avoid broad test suites and unrelated browsing.');
  if(profile.editedTests||profile.editedOracle)rules.push('The baseline touched test/oracle files. Do not modify staged regression tests; fix production behavior only.');
  if(profile.remainingFailures?.length){const families=unique(profile.remainingFailures.map(x=>x.family));rules.push(`The baseline still failed ${families.join('/')} verification. Trace the first remaining failing check to the production branch that controls that behavior before changing unrelated code.`);}
  if(mode==='localized')rules.push('Follow the failing assertion backward to the nearest production function and patch that path only; avoid repository-wide refactors.');
  if(mode==='oracle')rules.push('For each failing oracle assertion, identify the exact observable contract it encodes, then inspect the implementation branch responsible for that contract before writing code.');
  if(mode==='budget')rules.push('Use a strict sequence: read oracle → read nearby implementation → make one focused production edit → run locked verification → adjust only if that exact check still fails.');
  return unique(rules);
}

const mutationDefinitions=[
  {id:'failure-localized',title:'Failure-localized repair',mode:'localized',base:['Make the smallest correct production change for the observed regression.','Preserve all existing tests and staged regression oracles.','Do not edit generated, vendor, lock, or build-output files unless the task explicitly requires it.']},
  {id:'oracle-guided',title:'Oracle-guided diagnosis',mode:'oracle',base:['Treat the regression test oracle as executable product behavior, not as something to work around.','Map the failing assertion to the responsible production path before editing.','Keep the patch focused and preserve repository conventions.']},
  {id:'turn-efficient',title:'Turn-efficient verification',mode:'budget',base:['Prefer narrow evidence over broad exploration.','Make a production edit early enough to leave tool budget for verification.','Never weaken tests or replace verification with reasoning-only confidence.']},
  {id:'minimal',title:'Minimal change',mode:'localized',base:['Make the smallest correct change that addresses the observed failure.','Preserve existing tests; never weaken or delete them to get green checks.','Avoid generated, vendor, lock, and build-output files unless the task requires them.']},
  {id:'repo-map',title:'Repository-aware',mode:'oracle',base:['Inspect package scripts and nearby implementation/tests before editing.','Follow existing repository patterns, naming, module style, and error-handling conventions.','Change only files needed for the regression.']},
];

function instantiate(definition){
  const frozenByTask=new Map();
  return{id:definition.id,title:definition.title,apply:(cwd,info,context={})=>{const taskId=context.task?.id||'unknown';let rules=frozenByTask.get(taskId);if(!rules){rules=unique([...definition.base,...failureRules(context.failureProfile||{},context,definition.mode)]);frozenByTask.set(taskId,rules);}write(cwd,definition.title,rules,info);}};
}

export const mutationCatalog=mutationDefinitions.map(({id,title})=>({id,title}));
export function selectMutations(limit=5){return mutationDefinitions.slice(0,Math.max(1,Math.min(mutationDefinitions.length,Number(limit)||5))).map(instantiate);}
export function rankTournament(entries){return [...entries].sort((a,b)=>b.suite.summary.passRate-a.suite.summary.passRate||b.suite.summary.score-a.suite.summary.score||(a.suite.summary.inputTokens+a.suite.summary.outputTokens)-(b.suite.summary.inputTokens+b.suite.summary.outputTokens)||a.mutation.id.localeCompare(b.mutation.id));}
export function tournamentWinner(entries){return rankTournament(entries)[0]||null;}
