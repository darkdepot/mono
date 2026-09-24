// mono:experimental-bench-route-data
// Subscription-login declarations approved for MONO-85, 2026-09-24.
// Eligibility records evidence supplied by the orchestrator; the bench never runs statusCommand.
const checkedAt = '2026-09-24T00:23:45Z';
const login = cli => ({cli,statusCommand:cli==='claude'?'claude auth status':'codex login status',checkedAt,by:'mono-orchestrator'});
const route = (id, engine, model, effort, source) => ({
  id, engine, model, effort, provider:{id:engine==='claude'?'anthropic':'openai'}, credentialEnv:[], environment:{},
  eligibility:{billingChannelAllowed:true,source,subscriptionLogin:login(engine)},
});
export default [
  {...route('incumbent','claude','claude-opus-5','high','MONO-85 approved Claude subscription login'),baseline:true},
  route('sonnet-high','claude','claude-sonnet-5','high','MONO-85 approved Claude subscription login'),
  route('sol-high','codex','gpt-5.6-sol','high','MONO-85 approved Codex subscription login'),
  route('sol-medium','codex','gpt-5.6-sol','medium','MONO-85 approved Codex subscription login'),
  route('astra-high','codex','gpt-6-astra','high','MONO-85 approved Codex subscription login'),
  route('terra-high','codex','gpt-5.6-terra','high','MONO-85 approved Codex subscription login'),
];
