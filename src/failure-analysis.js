const profiles=new Map();

function profileKey(repo,taskId){return`${repo}::${taskId}`;}
function testFile(path=''){return/(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\./i.test(path);}
function productionFile(path=''){
  if(!path||path==='AGENTS.md'||path.endsWith('/AGENTS.md')||testFile(path))return false;
  return !/(^|\/)(docs?|examples?|fixtures?|vendor|dist|build|coverage)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(path);
}
function normalize(value=''){return String(value).replace(/\s+/g,' ').trim();}
function toolCalls(events=[]){return events.filter(event=>event?.type==='tool.call');}
function exactVerificationWasRun(commands=[],verificationCommands=[],oracleFiles=[]){
  if(!verificationCommands.length&&!oracleFiles.length)return false;
  return commands.some(command=>{
    const actual=normalize(command);
    if(verificationCommands.some(expected=>{const target=normalize(expected);return actual===target||actual.includes(target)||target.includes(actual);}))return true;
    return oracleFiles.length>0&&oracleFiles.some(file=>actual.includes(file));
  });
}

export function analyzeFailureResult(result={}){
  const calls=toolCalls(result.agent?.events||[]),reads=calls.filter(x=>x.name==='read_file').map(x=>x.args?.path).filter(Boolean),writes=calls.filter(x=>x.name==='write_file').map(x=>x.args?.path).filter(Boolean),commands=calls.filter(x=>x.name==='run_command').map(x=>x.args?.command).filter(Boolean),oracleFiles=[...(result.testOracleFiles||[])],verificationCommands=[...(result.verificationCommands||[])],files=[...(result.files||[])],remaining=(result.after||[]).filter(check=>!check.ok),productionFiles=files.filter(productionFile),stderr=String(result.agent?.stderr||''),instructionContext=result.agent?.instructionContext||null;
  const profile={
    taskId:result.taskId||null,
    title:result.title||'',
    pass:!!result.pass,
    agentOk:!!result.agent?.ok,
    agentStatus:result.agent?.status??null,
    turnExhausted:/exceeded\s+\d+\s+tool-call turns/i.test(stderr),
    instructionDeliveryKnown:instructionContext!==null,
    instructionsLoaded:instructionContext?.loaded??null,
    instructionPath:instructionContext?.path||null,
    instructionFingerprint:instructionContext?.sha256||null,
    instructionChars:instructionContext?.chars||0,
    instructionTruncated:!!instructionContext?.truncated,
    oracleFiles,
    verificationCommands,
    readFiles:[...new Set(reads)],
    writtenFiles:[...new Set(writes)],
    commands:[...new Set(commands)],
    changedFiles:files,
    productionFiles,
    modifiedOracleFiles:[...(result.modifiedOracleFiles||[])],
    testFilesTouched:[...(result.testFilesTouched||[])],
    remainingFailures:remaining.map(check=>({name:check.name||'',family:check.family||'other',command:check.commandText||'',status:check.status??null})),
    didNotReadOracle:oracleFiles.length>0&&!oracleFiles.some(file=>reads.includes(file)),
    didNotRunTargetedVerification:!exactVerificationWasRun(commands,verificationCommands,oracleFiles),
    noProductionEdit:productionFiles.length===0,
    editedTests:(result.testFilesTouched||[]).length>0,
    editedOracle:(result.modifiedOracleFiles||[]).length>0,
    readCount:reads.length,
    writeCount:writes.length,
    commandCount:commands.length,
  };
  profile.signals=[
    profile.turnExhausted?'turn-budget-exhausted':null,
    profile.instructionDeliveryKnown&&profile.instructionsLoaded===false?'repository-instructions-not-delivered':null,
    profile.didNotReadOracle?'oracle-not-read':null,
    profile.didNotRunTargetedVerification?'targeted-verify-not-run':null,
    profile.noProductionEdit?'no-production-edit':null,
    profile.editedTests?'tests-edited':null,
    profile.editedOracle?'oracle-edited':null,
    profile.remainingFailures.length?'verification-still-failing':null,
  ].filter(Boolean);
  return profile;
}

export function rememberFailureProfile(repo,taskId,result){const profile=analyzeFailureResult(result);profiles.set(profileKey(repo,taskId),profile);return profile;}
export function failureProfileFor(repo,taskId){return profiles.get(profileKey(repo,taskId))||null;}
export function clearFailureProfiles(){profiles.clear();}
