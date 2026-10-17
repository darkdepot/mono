// Stages rebuilt under «Mono как продукт». Add each stage here when it lands.
export const RUSSIAN_STAGES = ["idea"];

export function isRussianStage(file) {
  return RUSSIAN_STAGES.includes(/^skills\/([^/]+)\//.exec(file)?.[1]);
}
