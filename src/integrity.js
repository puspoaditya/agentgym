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

export function pairedTrialEvidence(baselineTrials,candidateTrials,{requireImprovement=true}={}){
  const baselines=Array.isArray(baselineTrials)?baselineTrials:[],candidates=Array.isArray(candidateTrials)?candidateTrials:[];
  if(!baselines.length||baselines.length!==candidates.length)return{valid:false,reason:'trial-count-mismatch',trials:Math.max(baselines.length,candidates.length),requiredWins:0,wins:0,nonRegressions:0,regressions:0,scoreDelta:0,passRateDelta:0,comparisons:[],eligible:false,safe:false};
  const comparisons=baselines.map((baseline,index)=>compareSuites(baseline,candidates[index]));
  if(comparisons.some(x=>!x.valid))return{valid:false,reason:comparisons.find(x=>!x.valid)?.reason||'invalid-trial',trials:comparisons.length,requiredWins:Math.floor(comparisons.length/2)+1,wins:0,nonRegressions:0,regressions:0,scoreDelta:0,passRateDelta:0,comparisons,eligible:false,safe:false};
  const trials=comparisons.length,requiredWins=Math.floor(trials/2)+1,wins=comparisons.filter(x=>x.candidateBetter&&x.candidateNotWorse).length,nonRegressions=comparisons.filter(x=>x.candidateNotWorse).length,regressions=trials-nonRegressions;
  const scoreDelta=Math.round(comparisons.reduce((sum,x)=>sum+x.scoreDelta,0)/trials),passRateDelta=Math.round(comparisons.reduce((sum,x)=>sum+x.passRateDelta,0)/trials);
  const safe=nonRegressions===trials,eligible=safe&&(!requireImprovement||wins>=requiredWins);
  return{valid:true,reason:null,trials,requiredWins,wins,nonRegressions,regressions,scoreDelta,passRateDelta,comparisons,eligible,safe};
}

export function decideEvolution({trainingBaseline,trainingCandidate,heldoutBaseline,heldoutCandidate}){
  const training=compareSuites(trainingBaseline,trainingCandidate),heldout=compareSuites(heldoutBaseline,heldoutCandidate),hasHeldout=usableIds(heldoutBaseline).length>0,trainingEligible=training.valid&&training.candidateBetter&&training.candidateNotWorse,heldoutSafe=hasHeldout&&heldout.valid&&heldout.candidateNotWorse,keep=trainingEligible&&heldoutSafe;
  const outcome=keep?'KEEP':trainingEligible&&!hasHeldout?'PROVISIONAL':'REJECT';
  return{keep,outcome,training,heldout,hasHeldout,trainingEligible,heldoutSafe};
}

export function decideStochasticEvolution({trainingBaselineTrials,trainingCandidateTrials,heldoutBaselineTrials=[],heldoutCandidateTrials=[]}){
  const training=pairedTrialEvidence(trainingBaselineTrials,trainingCandidateTrials,{requireImprovement:true});
  const hasHeldout=Array.isArray(heldoutBaselineTrials)&&heldoutBaselineTrials.length>0;
  const heldout=hasHeldout?pairedTrialEvidence(heldoutBaselineTrials,heldoutCandidateTrials,{requireImprovement:false}):pairedTrialEvidence([],[]);
  const trainingEligible=training.valid&&training.eligible,heldoutSafe=hasHeldout&&heldout.valid&&heldout.safe,keep=trainingEligible&&heldoutSafe;
  const outcome=keep?'KEEP':trainingEligible&&!hasHeldout?'PROVISIONAL':'REJECT';
  return{keep,outcome,training,heldout,hasHeldout,trainingEligible,heldoutSafe};
}
