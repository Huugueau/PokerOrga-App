import { makeBreak, makeLevel } from './defaults';
import type { Level } from './types';

export interface GeneratorInput {
  players: number;
  startStack: number;
  durationHours: number;
  levelMinutes: number;
  smallestChip: number;
  ante: boolean;
  breakEvery: number; // 0 = pas de pause
  breakMinutes?: number;
}

export interface GeneratorSummary {
  levels: number;
  startBB: number;
  startDepth: number;
  endBB: number;
  estimatedMinutes: number;
  finalAverageDepth: number;
}

const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

function ladder(chip: number, max: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 12; k++) {
    for (const m of STEPS) {
      const v = Math.round(m * Math.pow(10, k));
      if (v % chip === 0 && v >= 2 * chip) out.push(v);
      if (v > max * 4) return [...new Set(out)].sort((a, b) => a - b);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function nearest(values: number[], target: number, above: number): number {
  const candidates = values.filter((v) => v > above);
  if (candidates.length === 0) return above * 2;
  let best = candidates[0];
  for (const v of candidates) if (Math.abs(Math.log(v / target)) < Math.abs(Math.log(best / target))) best = v;
  return best;
}

export function generateStructure(input: GeneratorInput): { levels: Level[]; summary: GeneratorSummary } {
  const players = Math.max(2, Math.round(input.players));
  const stack = Math.max(input.smallestChip * 20, input.startStack);
  const chip = Math.max(1, input.smallestChip);
  const levelMin = Math.max(1, input.levelMinutes);
  const breakMin = input.breakMinutes ?? 10;
  const breakEvery = Math.max(0, Math.round(input.breakEvery));
  const perLevel = levelMin + (breakEvery > 0 ? breakMin / breakEvery : 0);
  const nLevels = Math.max(3, Math.floor((input.durationHours * 60) / perLevel));
  const totalChips = players * stack;
  const endTarget = totalChips / 20;
  const values = ladder(chip, endTarget);
  const bb0 = nearest(values, Math.max(2 * chip, stack / 100), 0);
  const ratio = Math.pow(Math.max(endTarget, bb0 * 2) / bb0, 1 / Math.max(1, nLevels - 1));

  const bbs: number[] = [bb0];
  for (let i = 1; i < nLevels; i++) {
    const target = bb0 * Math.pow(ratio, i);
    bbs.push(nearest(values, target, bbs[i - 1]));
  }
  const anteFrom = Math.ceil(nLevels / 3);
  const levels: Level[] = [];
  bbs.forEach((bb, i) => {
    const sbRaw = Math.max(chip, Math.round(bb / 2 / chip) * chip);
    levels.push(makeLevel({ sb: sbRaw, bb, ante: input.ante && i >= anteFrom ? bb : 0, minutes: levelMin }));
    if (breakEvery > 0 && (i + 1) % breakEvery === 0 && i < nLevels - 1) levels.push(makeBreak(breakMin));
  });
  // fin de late reg : pause la plus proche de 40 % de la durée
  const breaks = levels.map((l, i) => ({ l, i })).filter((x) => x.l.kind === 'break');
  if (breaks.length > 0) {
    let elapsed = 0;
    const at: { i: number; t: number }[] = [];
    levels.forEach((l, i) => {
      elapsed += l.minutes;
      if (l.kind === 'break') at.push({ i, t: elapsed });
    });
    const target = elapsed * 0.4;
    const best = at.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a));
    levels[best.i].lateRegEnd = true;
  } else if (levels.length > 2) {
    levels[Math.floor(levels.length * 0.4)].lateRegEnd = true;
  }
  const estimatedMinutes = levels.reduce((a, l) => a + l.minutes, 0);
  const endBB = bbs[bbs.length - 1];
  const finalPlayers = Math.max(2, Math.round(players * 0.1));
  return {
    levels,
    summary: {
      levels: nLevels,
      startBB: bb0,
      startDepth: Math.round(stack / bb0),
      endBB,
      estimatedMinutes,
      finalAverageDepth: Math.round((totalChips / finalPlayers / endBB) * 10) / 10,
    },
  };
}
