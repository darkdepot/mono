import { canonical, digest } from './runtime.mjs';

export function implementationComment(report) {
  const lines = [report.summary, '', 'Не проверено',
    ...report.not_verified.map(x => `- ${x.what}: ${x.why}. Риск: ${x.risk}`), '', 'Найдена поломка',
    ...report.criteria.filter(x => x.outcome === 'broken').map(x => `- ${x.criterion}: ${x.result}`), '', 'Доказательства',
    `phase_result=${report.phase_result}; reason=${report.reason ?? 'none'}`,
    ...report.criteria.map(x => `- ${x.criterion}: done=${x.done}, ${x.outcome}. ${x.proof}. ${x.result}. head=${x.head}; worktree=${x.worktree_fingerprint}`),
    ...(report.verification_items ?? []).map(x => `- ${x.item}: ${x.status}. ${x.evidence}`),
    '', 'Старт', `${report.issue}, попытка ${report.attempt}; ${report.branch ?? 'ветка из диспатча'}; head=${report.head}`,
    ...report.capsule.decisions.map(x => `- ${typeof x === 'string' ? x : canonical(x)}`), '', 'Не строил',
    ...report.not_built.map(x => `- ${x.what}: ${x.reason}`),
    ...(report.question ? ['', `Вопрос: ${report.question}`] : []),
    ...(report.recommendation ? [`Рекомендация: ${report.recommendation}`] : []),
    ...(report.superseded_reports ?? []).map(id => `Предыдущий отчёт ${id} устарел; его заменяет этот комментарий.`)];
  const body = lines.join('\n');
  return { id: `implementation-report:${digest(body)}`, operation: 'comment', target: report.issue, payload: { body } };
}

export function literalImplementationComment(write) {
  return write.operation === 'comment' && typeof write.payload?.body === 'string' &&
    write.id === `implementation-report:${digest(write.payload.body)}`;
}

export function implementationExit(report) {
  return report.phase === 'code' && report.kind === 'phase' && report.phase_result !== undefined && report.phase_result !== 'in-progress';
}

export function deferredImplementation(report) {
  if (!implementationExit(report) || report.phase_result !== 'implemented-needs-preflight') return false;
  const queue = report.capsule.open_queue;
  return queue.length === 1 && canonical(queue[0]) === canonical(implementationComment(report));
}
