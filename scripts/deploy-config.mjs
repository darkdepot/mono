const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value);
const need = (ok, message) => { if (!ok) throw new Error(`deploy: ${message}`); };

export function validateDeployConfig(deploy) {
  need(object(deploy) && Object.keys(deploy).every(key => key === 'targets'), 'expected {targets}, unknown field');
  need(Array.isArray(deploy.targets) && deploy.targets.length, 'targets must be nonempty');
  for (const target of deploy.targets) {
    const fields = { vercel: ['paths', 'domain', 'team', 'check'], local: ['paths', 'command', 'check'], pack: [], none: ['paths', 'reason'] };
    need(object(target) && Object.hasOwn(fields, target.kind), 'unknown target kind');
    need(Object.keys(target).every(key => key === 'kind' || fields[target.kind].includes(key)), 'unknown target field (at most five)');
    if ('paths' in target) need(Array.isArray(target.paths) && target.paths.length && target.paths.every(pattern => text(pattern)
      && !pattern.startsWith('/') && !pattern.split('/').some(part => ['..', '.'].includes(part)) && !/[\\?\[\]{}]/.test(pattern)), 'paths require root-relative patterns with * or **');
    for (const field of { vercel: ['domain', 'team', 'check'], local: ['command', 'check'], none: ['reason'], pack: [] }[target.kind])
      need(text(target[field]), `${target.kind}.${field} required`);
    if (target.kind === 'vercel') {
      need(/^[a-z0-9.-]+(?::\d+)?$/i.test(target.domain), 'domain must be bare name');
      need(/^team_[a-z0-9_-]+$/i.test(target.team), 'team must be a Vercel team ID');
    }
  }
  return deploy;
}

export function affected(target, files) {
  return !target.paths || files.some(file => target.paths.some(pattern => {
    let expression = '';
    for (let i = 0; i < pattern.length; i++) {
      if (pattern.slice(i, i + 3) === '**/') { expression += '(?:.*/)?'; i += 2; }
      else if (pattern.slice(i, i + 2) === '**') { expression += '.*'; i++; }
      else if (pattern[i] === '*') expression += '[^/]*';
      else expression += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${expression}$`).test(file);
  }));
}
