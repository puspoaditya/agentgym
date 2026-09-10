function usableIds(suite){return (suite?.results||[]).filter(result=>result.usable).map(result=>result.taskId).sort();}
function hasDuplicates(ids){return new Set(ids).size!==ids.length;}
function sameIds(a,b){return a.length===b.length&&a.every((id,index)=>id===b[index]);}

export function suiteUsableTaskIds(suite){return usableIds(suite);}
export function suitesUseSameTasks(baseline,candidate){const baselineIds=usableIds(baseline),candidateIds=usableIds(candidate);return baselineIds.length>0&&!hasDuplicates(baselineIds)&&!hasDuplicates(candidateIds)&&sameIds(baselineIds,candidateIds);}

export function compareSuites(baseline,candidate){
  const b=baseline?.summary||{},c=candidate?.summary||{},baselineIds=usableIds(baseline),candidateIds=usableIds(candidate);
  if(!baselineIds.length)return{scoreDelta:0,passRateDelta:0,candidateBetter:false,candidateNotWorse:false,valid:false,reason:'no-baseline-usable',baselineTaskIds:baselineIds,candidateTaskIds:candidateIds};
  if(hasDuplicates(baselineIds)||hasDuplicates(candidateIds)||!sameIds(baselineIds,candidateIds))return{scoreDelta:0,passRateDelta:0,candidateBetter:false,candidateNotWorse:false,valid:false,reason:'task-set-mismatch',baselineTaskIds:baselineIds,candidateTaskIds:candidateIds};
  const scoreDelta=(c.score||0)-(b.score||0),passRateDelta=(c.passRate||0)-(b.passRate||0);
  return{scoreDelta,passRateDelta,candidateBetter:scoreDelta>0||passRateDelta>0,candidateNotWorse:scoreDelta>=0&&passRateDelta>=0,valid:true,reason:null,baselineTaskIds:baselineIds,candidateTaskIds:candidateIds};
}

export function decideEvolution({trainingBaseline,trainingCandidate,heldoutBaseline,heldoutCandidate}){
  const training=compareSuites(trainingBaseline,trainingCandidate),heldout=compareSuites(heldoutBaseline,heldoutCandidate),hasHeldout=usableIds(heldoutBaseline).length>0,trainingEligible=training.valid&&training.candidateBetter&&training.candidateNotWorse,heldoutSafe=hasHeldout&&heldout.valid&&heldout.candidateNotWorse,keep=trainingEligible&&heldoutSafe;
  const outcome=keep?'KEEP':trainingEligible&&!hasHeldout?'PROVISIONAL':'REJECT';
  return{keep,outcome,training,heldout,hasHeldout,trainingEligible,heldoutSafe};
}
