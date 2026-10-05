function requireEnvironment(condition, message) {
  if (!condition) throw new Error(message);
}

export function reviewEnvironment(route, source = process.env) {
  const providerVariable = /^(?:ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_API_|KIMI_|PI_|AWS_|AZURE_|GOOGLE_|GEMINI_|CLOUD_ML_|AUTOREVIEW_.*FALLBACK)|(?:API_KEY|ACCESS_KEY|SECRET_ACCESS_KEY|AUTH_TOKEN|ACCESS_TOKEN|API_TOKEN|TOKEN|PAT|BASE_URL|ENDPOINT|CREDENTIALS)$/;
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !providerVariable.test(key) && key !== route.credentialEnv));
  const { engine, provider, credentialEnv } = route;
  if (credentialEnv) {
    requireEnvironment(typeof source[credentialEnv] === 'string' && source[credentialEnv].length > 0, `missing route credential variable ${credentialEnv}`);
    let target = 'OPENAI_API_KEY';
    if (engine === 'claude') target = credentialEnv === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
    if (engine === 'kimi') target = 'KIMI_API_KEY';
    if (engine === 'pi') target = { openai: 'OPENAI_API_KEY', xai: 'XAI_API_KEY', google: 'GEMINI_API_KEY', minimax: 'MINIMAX_API_KEY' }[provider.id];
    requireEnvironment(target, 'unsupported provider credential mapping'); env[target] = source[credentialEnv];
  }
  if (provider.endpoint) env[engine === 'claude' ? 'ANTHROPIC_BASE_URL' : engine === 'kimi' ? 'KIMI_BASE_URL' : 'OPENAI_BASE_URL'] = provider.endpoint;
  return env;
}
