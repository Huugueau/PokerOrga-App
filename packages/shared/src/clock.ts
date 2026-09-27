import type { ClockState, Level } from './types';

export interface ResolvedClock {
  levelIndex: number;
  remainingMs: number;
  finished: boolean;
  running: boolean;
}

export const levelMs = (l: Level | undefined) => Math.max(1, l?.minutes ?? 0) * 60000;

/** Calcule l'état effectif de l'horloge à l'instant `now` (ms epoch serveur). */
export function resolveClock(state: ClockState, levels: Level[], now: number): ResolvedClock {
  if (levels.length === 0) return { levelIndex: 0, remainingMs: 0, finished: true, running: false };
  let idx = Math.min(Math.max(0, state.levelIndex), levels.length - 1);
  if (!state.running || state.anchorAt == null) {
    return { levelIndex: idx, remainingMs: Math.max(0, state.remainingMs), finished: false, running: false };
  }
  let remaining = state.remainingMs - Math.max(0, now - state.anchorAt);
  while (remaining <= 0) {
    if (idx >= levels.length - 1) {
      return { levelIndex: levels.length - 1, remainingMs: 0, finished: true, running: false };
    }
    idx += 1;
    remaining += levelMs(levels[idx]);
  }
  return { levelIndex: idx, remainingMs: remaining, finished: false, running: true };
}

export type ClockAction =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'next'; expectedLevel?: number }
  | { action: 'prev'; expectedLevel?: number }
  | { action: 'seek'; remainingMs: number }
  | { action: 'goto'; levelIndex: number }
  | { action: 'reset' };

export class ClockConflictError extends Error {
  constructor() {
    super('Le niveau a déjà changé sur un autre écran.');
  }
}

/** Applique une action sur l'horloge. Retourne le nouvel état persistant. */
export function applyClockAction(state: ClockState, levels: Level[], now: number, a: ClockAction): ClockState {
  const r = resolveClock(state, levels, now);
  const frozen = (levelIndex: number, remainingMs: number, running: boolean): ClockState => ({
    levelIndex,
    remainingMs,
    running,
    anchorAt: running ? now : null,
  });
  switch (a.action) {
    case 'play':
      if (r.finished) return frozen(r.levelIndex, 0, false);
      return frozen(r.levelIndex, r.remainingMs, true);
    case 'pause':
      return frozen(r.levelIndex, r.remainingMs, false);
    case 'next': {
      if (a.expectedLevel != null && a.expectedLevel !== r.levelIndex) throw new ClockConflictError();
      const idx = Math.min(levels.length - 1, r.levelIndex + 1);
      if (idx === r.levelIndex) return frozen(idx, 0, false);
      return frozen(idx, levelMs(levels[idx]), r.running);
    }
    case 'prev': {
      if (a.expectedLevel != null && a.expectedLevel !== r.levelIndex) throw new ClockConflictError();
      const idx = Math.max(0, r.levelIndex - 1);
      return frozen(idx, levelMs(levels[idx]), r.running);
    }
    case 'goto': {
      const idx = Math.min(levels.length - 1, Math.max(0, a.levelIndex));
      return frozen(idx, levelMs(levels[idx]), r.running);
    }
    case 'seek': {
      const max = levelMs(levels[r.levelIndex]);
      return frozen(r.levelIndex, Math.min(max, Math.max(0, a.remainingMs)), r.running);
    }
    case 'reset':
      return frozen(0, levelMs(levels[0]), false);
  }
}

/** Réajuste l'horloge après modification de la structure (garde le niveau courant si possible). */
export function clampClockToStructure(state: ClockState, levels: Level[], now: number): ClockState {
  const r = resolveClock(state, levels, now);
  const idx = Math.min(r.levelIndex, Math.max(0, levels.length - 1));
  const max = levelMs(levels[idx]);
  const remaining = Math.min(r.remainingMs, max);
  return { levelIndex: idx, remainingMs: remaining, running: r.running, anchorAt: r.running ? now : null };
}

export interface ClockInfo {
  current: Level | undefined;
  nextLevel: Level | undefined;
  levelNumber: number; // numéro du niveau (hors pauses), 0 si pause
  msToNextBreak: number | null;
  msToLateRegEnd: number | null;
  lateRegOpen: boolean;
}

/** Numéro de niveau affiché (les pauses ne sont pas comptées). */
export function levelNumberAt(levels: Level[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index && i < levels.length; i++) if (levels[i].kind === 'level') n++;
  return levels[index]?.kind === 'level' ? n : 0;
}

export function clockInfo(levels: Level[], r: ResolvedClock): ClockInfo {
  const current = levels[r.levelIndex];
  let nextLevel: Level | undefined;
  for (let i = r.levelIndex + 1; i < levels.length; i++) {
    if (levels[i].kind === 'level') {
      nextLevel = levels[i];
      break;
    }
  }
  let msToNextBreak: number | null = null;
  if (current?.kind !== 'break') {
    let acc = r.remainingMs;
    for (let i = r.levelIndex + 1; i < levels.length; i++) {
      if (levels[i].kind === 'break') {
        msToNextBreak = acc;
        break;
      }
      acc += levelMs(levels[i]);
    }
  }
  const lateIdx = levels.findIndex((l) => l.lateRegEnd);
  let msToLateRegEnd: number | null = null;
  let lateRegOpen = true;
  if (lateIdx >= 0) {
    if (r.levelIndex > lateIdx || (r.finished && r.levelIndex >= lateIdx)) {
      lateRegOpen = false;
    } else {
      let acc = r.remainingMs;
      for (let i = r.levelIndex + 1; i <= lateIdx; i++) acc += levelMs(levels[i]);
      msToLateRegEnd = acc;
    }
  }
  return {
    current,
    nextLevel,
    levelNumber: levelNumberAt(levels, r.levelIndex),
    msToNextBreak,
    msToLateRegEnd,
    lateRegOpen,
  };
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Durée courte : "60 min", "2h20". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
