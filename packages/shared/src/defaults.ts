import type { ClockState, Level, MysteryState, PayoutConfig, ThemeConfig, TournamentSettings } from './types';

export const DEFAULT_TITLE = 'Tournoi entre amis';

export function uid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const DEFAULT_SETTINGS: TournamentSettings = {
  entryFormat: 'freezeout',
  reentryLimit: -1,
  rebuyLimit: -1,
  addonsEnabled: false,
  addonCost: 10,
  addonStack: 10000,
  rebuyCost: null,
  rebuyStack: null,
  startStack: 10000,
  buyin: 10,
  isFree: false,
  rake: 0,
  hidePayout: false,
  trackKills: false,
  maxPerTable: 10,
  finalTableSize: 10,
  autoBalance: true,
  breakTablesHighToLow: true,
  bounty: { type: 'none', amount: 0, drawFrom: null },
  showLocalClock: false,
};

type L = [number, number, number, number, boolean?];
const RAW_DEFAULT: (L | 'break' | 'break-latereg')[] = [
  [50, 100, 0, 20],
  [75, 150, 0, 20],
  [100, 200, 0, 20],
  'break',
  [200, 400, 400, 20],
  [300, 600, 600, 20],
  [400, 800, 800, 20],
  'break-latereg',
  [600, 1200, 1200, 20],
  [800, 1600, 1600, 20],
  [1000, 2000, 2000, 20],
  'break',
  [1500, 3000, 3000, 20],
  [2000, 4000, 4000, 20],
  [3000, 6000, 6000, 20],
  'break',
  [4000, 8000, 8000, 20],
  [5000, 10000, 10000, 20],
  [6000, 12000, 12000, 20],
];

export function makeLevel(partial: Partial<Level> = {}): Level {
  return { id: uid(), kind: 'level', sb: 0, bb: 0, ante: 0, minutes: 20, lateRegEnd: false, ...partial };
}

export function makeBreak(minutes = 10, lateRegEnd = false): Level {
  return { id: uid(), kind: 'break', sb: 0, bb: 0, ante: 0, minutes, lateRegEnd };
}

export function defaultStructure(): Level[] {
  return RAW_DEFAULT.map((r) => {
    if (r === 'break') return makeBreak(10);
    if (r === 'break-latereg') return makeBreak(10, true);
    return makeLevel({ sb: r[0], bb: r[1], ante: r[2], minutes: r[3] });
  });
}

export const DEFAULT_PAYOUTS: PayoutConfig = { mode: 'auto', type: 'money', amounts: [], lots: [] };

export const DEFAULT_THEME: ThemeConfig = {
  primary: '#1a1f26',
  secondary: '#4ea486',
  title: '#f4f4f5',
  glassOpacity: 0.55,
  glassBlur: 12,
  font: 'Inter',
  backgroundAssetId: null,
  logoAssetId: null,
  sounds: { start: null, warning60: null, levelEnd: null },
};

export const TIMER_FONTS = ['Inter', 'Oswald', 'Oxanium', 'Montserrat', 'Roboto', 'Lato'] as const;

export function initialClock(structure: Level[]): ClockState {
  return { levelIndex: 0, running: false, remainingMs: (structure[0]?.minutes ?? 20) * 60000, anchorAt: null };
}

export const DEFAULT_MYSTERY: MysteryState = { frozen: false, custom: false, envelopes: [] };

export const FORMAT_LABELS: Record<number, string> = {
  2: "Head's up (2)",
  3: '3-Max',
  4: '4-Max',
  5: '5-Max',
  6: '6-Max',
  7: '7-Max',
  8: '8-Max',
  9: '9-Max',
  10: 'Full ring (10)',
};
