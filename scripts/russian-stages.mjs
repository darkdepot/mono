// Stages rebuilt under «Mono как продукт». Add each stage here when it lands.
export const RUSSIAN_STAGES = ["idea", "research", "discovery", "design", "tech-evaluation", "handoff", "implement", "qa", "ship"];

export function isRussianStage(file) {
  return RUSSIAN_STAGES.includes(/^skills\/([^/]+)\//.exec(file)?.[1]);
}
