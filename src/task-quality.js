const FIX_PATTERN=/\b(fix(?:ed|es)?|bug(?:fix)?|regression|correct(?:ion|ed|s)?|repair|resolve[ds]?|patch|crash|broken|failure|incorrect|wrong)\b/i;
const MAINTENANCE_PATTERN=/\b(chore|meta|docs?|dependencies|dependency|deps|upgrade|bump|release|require node(?:\.js)?|move to esm|tooling|ci)\b/i;
const DEPENDENCY_FILES=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','pnpm-lock.yaml','bun.lock','bun.lockb']);
const SOURCE_EXT=/\.(?:[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp)$/i;
const TEST_FILE=/(^|\/)(?:__tests__|tests?|specs?)(\/|\.)|\.(?:test|spec)(?:-d)?\.[^.]+$|(^|\/)test\.[^.]+$/i;
const DOC_FILE=/\.(?:md|mdx|rst|txt|adoc)$/i;

function baseName(file=''){return file.split('/').pop()||file;}
function isDependencyFile(file=''){return DEPENDENCY_FILES.has(file)||DEPENDENCY_FILES.has(baseName(file));}
function isTestFile(file=''){return TEST_FILE.test(file);}
function isSourceFile(file=''){return SOURCE_EXT.test(file)&&!isTestFile(file)&&!/(^|\/)(?:\.github|docs?|examples?|fixtures?|scripts?)\//i.test(file)&&!/(?:^|\/)(?:eslint|babel|rollup|vite|webpack|jest|ava|tsup|prettier|xo)\.config\./i.test(file);}
function isMetaFile(file=''){return isDependencyFile(file)||DOC_FILE.test(file)||/(^|\/)(?:\.github|\.circleci|docs?|examples?|fixtures?)\//i.test(file)||/(^|\/)(?:\.travis\.yml|\.gitignore|\.gitattributes|license(?:\.[^/]+)?|readme(?:\.[^/]+)?)$/i.test(file)||/\.(?:ya?ml|json|toml)$/i.test(file);}

export function taskUsefulness(task={}){
  const files=task.touchedFiles||[],fixLike=FIX_PATTERN.test(task.title||''),maintenanceTitle=MAINTENANCE_PATTERN.test(task.title||''),touchesSource=files.some(isSourceFile),touchesTests=files.some(isTestFile),touchesDependencies=files.some(isDependencyFile),dependencyOnly=files.length>0&&files.every(isDependencyFile),docsMetaOnly=files.length>0&&files.every(isMetaFile);
  let score=0;
  if(touchesSource)score+=3;
  if(touchesTests)score+=2;
  if(touchesSource&&touchesTests)score+=2;
  if(fixLike)score+=2;
  if(dependencyOnly)score-=2;
  if(docsMetaOnly)score-=3;
  if(maintenanceTitle)score-=2;
  const benchmarkEligible=(fixLike&&(touchesSource||touchesTests))||(touchesSource&&touchesTests&&score>=7);
  const tier=benchmarkEligible?(score>=7?'strong':'useful'):'low';
  return{score,tier,benchmarkEligible,fixLike,maintenanceTitle,touchesSource,touchesTests,touchesDependencies,dependencyOnly,docsMetaOnly};
}

export function prioritizeTasks(entries=[]){return[...entries].sort((a,b)=>Number(b.usefulness?.benchmarkEligible)-Number(a.usefulness?.benchmarkEligible)||(b.usefulness?.score||0)-(a.usefulness?.score||0)||a.index-b.index);}
export function usefulnessSummary(entries=[]){const out={strong:0,useful:0,low:0,eligible:0};for(const entry of entries){const q=entry.usefulness||taskUsefulness(entry.task||entry);out[q.tier]=(out[q.tier]||0)+1;if(q.benchmarkEligible)out.eligible++;}return out;}
export { FIX_PATTERN };
