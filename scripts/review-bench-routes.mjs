// mono:experimental-bench-route-data
// Candidate declarations from the approved MONO-81 research snapshot, 2026-09-16.
// Eligibility is a billing assertion with provenance, never a compatibility result.
const route = (id, engine, model, effort, provider, credentialEnv, environment, source, extra={}) => ({
  id, engine, model, effort, provider, credentialEnv, environment,
  eligibility:{billingChannelAllowed:true,source,...extra},
});
export default [
  {...route('incumbent','claude','claude-opus-5','high',{id:'anthropic'},['ANTHROPIC_API_KEY'],{ANTHROPIC_API_KEY:'ANTHROPIC_API_KEY'},'https://docs.anthropic.com/en/api/overview'),baseline:true},
  route('glm','claude','glm-5.3','high',{id:'zai',endpoint:'https://api.z.ai/api/anthropic'},['ZAI_API_KEY'],{ANTHROPIC_AUTH_TOKEN:'ZAI_API_KEY'},'https://docs.z.ai/devpack/tool/claude'),
  route('kimi','claude','kimi-k3','high',{id:'moonshot',endpoint:'https://api.moonshot.ai/anthropic'},['MOONSHOT_API_KEY'],{ANTHROPIC_AUTH_TOKEN:'MOONSHOT_API_KEY'},'https://platform.moonshot.ai/docs/guide/agent-support'),
  route('deepseek','claude','deepseek-v4-pro','high',{id:'deepseek',endpoint:'https://api.deepseek.com/anthropic'},['DEEPSEEK_API_KEY'],{ANTHROPIC_AUTH_TOKEN:'DEEPSEEK_API_KEY'},'https://api-docs.deepseek.com/guides/anthropic_api'),
  route('grok','pi','grok-4.6','high',{id:'xai'},['XAI_API_KEY'],{XAI_API_KEY:'XAI_API_KEY'},'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md',{toVerify:'Pi model support and API billing; subscription login requires separate verification'}),
  route('minimax','claude','MiniMax-M2.7','high',{id:'minimax',endpoint:'https://api.minimax.io/anthropic'},['MINIMAX_API_KEY'],{ANTHROPIC_AUTH_TOKEN:'MINIMAX_API_KEY'},'https://platform.minimax.io/docs/token-plan/intro',{toVerify:'Token Plan automation permission, model selector and Anthropic compatibility'}),
  route('terra-medium','codex','gpt-5.6-terra','medium',{id:'openai'},[],{},'MONO-81 approved research: Codex quota permitting',{toVerify:'Excluded from common protocol: helper rejects no-tools for Codex'}),
  route('terra-high','codex','gpt-5.6-terra','high',{id:'openai'},[],{},'MONO-81 approved research: Codex quota permitting',{toVerify:'Excluded from common protocol: helper rejects no-tools for Codex'}),
  route('gemini','pi','gemini-3.1-pro','high',{id:'google'},['GEMINI_API_KEY'],{GEMINI_API_KEY:'GEMINI_API_KEY'},'https://ai.google.dev/gemini-api/docs/billing',{toVerify:'Pi installation and exact model selector'}),
];
