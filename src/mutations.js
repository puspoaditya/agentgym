import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageManager } from './core.js';

function existing(cwd){const p=join(cwd,'AGENTS.md');return existsSync(p)?readFileSync(p,'utf8').trim():'';}
function verification(info,cwd){const s=info.scripts||{},pm=packageManager(cwd),cmd=n=>pm==='npm'?`npm run ${n}`:`${pm} ${n}`,out=[];if(s.test)out.push(pm==='npm'?'npm test':`${pm} test`);if(s.typecheck)out.push(cmd('typecheck'));else if(s['type-check'])out.push(cmd('type-check'));if(s.lint)out.push(cmd('lint'));return out;}
function write(cwd,title,rules,info){const prior=existing(cwd),checks=verification(info,cwd),parts=[];if(prior)parts.push(prior,'','---','');parts.push(`# Kodematik candidate: ${title}`,'',...rules.map(x=>`- ${x}`));if(checks.length)parts.push('','## Required verification',...checks.map(x=>`- \`${x}\``));parts.push('');writeFileSync(join(cwd,'AGENTS.md'),parts.join('\n'));}

export const mutationCatalog=[
 {id:'minimal',title:'Minimal change',apply:(cwd,info)=>write(cwd,'Minimal change',['Make the smallest correct change that addresses the observed failure.','Preserve existing tests; never weaken or delete them to get green checks.','Avoid generated, vendor, lock, and build-output files unless the task requires them.'],info)},
 {id:'test-first',title:'Test-first diagnosis',apply:(cwd,info)=>write(cwd,'Test-first diagnosis',['Run the narrowest relevant failing test before editing.','Use the failure output to identify the root cause before changing code.','Preserve existing tests and add production-code fixes rather than test workarounds.','After the targeted check passes, run all available repository verification.'],info)},
 {id:'repo-map',title:'Repository-aware',apply:(cwd,info)=>write(cwd,'Repository-aware',['Inspect package scripts and nearby implementation/tests before editing.','Follow existing repository patterns, naming, module style, and error-handling conventions.','Change only files needed for the regression.','Run the narrowest relevant check first, then all available verification.'],info)},
 {id:'verify-strict',title:'Strict verification',apply:(cwd,info)=>write(cwd,'Strict verification',['Do not declare success until every available verification command passes.','Never modify tests merely to make a failure disappear.','If a check fails after the edit, diagnose and fix the production change before finishing.','Keep the patch focused and avoid unrelated refactors.'],info)},
 {id:'combined',title:'Combined strategy',apply:(cwd,info)=>write(cwd,'Combined strategy',['Inspect package scripts, nearby implementation, and relevant tests before editing.','Reproduce the failure with the narrowest relevant check first.','Identify the root cause and make the smallest production-code change that fixes it.','Preserve tests and repository conventions; avoid unrelated refactors and generated output.','Run the targeted check again, then every available repository verification command before finishing.'],info)}
];

export function selectMutations(limit=5){return mutationCatalog.slice(0,Math.max(1,Math.min(mutationCatalog.length,Number(limit)||5)));}
export function rankTournament(entries){return [...entries].sort((a,b)=>b.suite.summary.passRate-a.suite.summary.passRate||b.suite.summary.score-a.suite.summary.score||(a.suite.summary.inputTokens+a.suite.summary.outputTokens)-(b.suite.summary.inputTokens+b.suite.summary.outputTokens)||a.mutation.id.localeCompare(b.mutation.id));}
export function tournamentWinner(entries){return rankTournament(entries)[0]||null;}
