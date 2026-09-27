export type EntryFormat = 'freezeout' | 'reentry' | 'rebuys';
export type BountyType = 'none' | 'fixed' | 'progressive' | 'mystery';
export type UsageMode = 'private' | 'association';
export type TournamentStatus = 'prepared' | 'running' | 'finished';
export type PlayerStatus = 'active' | 'eliminated';

export interface BountySettings {
  type: BountyType;
  /** Part du buy-in allouée au bounty (ou aux enveloppes mystery). */
  amount: number;
  /** Mystery : tirage des enveloppes à partir de N joueurs restants (null = tout le field). */
  drawFrom: number | null;
}

export interface TournamentSettings {
  entryFormat: EntryFormat;
  reentryLimit: number; // -1 = illimité
  rebuyLimit: number; // -1 = illimité (1 = double chance)
  addonsEnabled: boolean;
  addonCost: number;
  addonStack: number;
  rebuyCost: number | null;
  rebuyStack: number | null;
  startStack: number;
  buyin: number;
  isFree: boolean;
  /** Rake par entrée/recave, payé en sus du buy-in (hors prize pool). */
  rake: number;
  hidePayout: boolean;
  trackKills: boolean;
  maxPerTable: number;
  finalTableSize: number;
  autoBalance: boolean;
  breakTablesHighToLow: boolean;
  bounty: BountySettings;
  showLocalClock: boolean;
  /** Session Multi Sit-and-Go : chaque table est un SnG indépendant sur le timer partagé. */
  multiSng: boolean;
}

export interface Level {
  id: string;
  kind: 'level' | 'break';
  sb: number;
  bb: number;
  ante: number;
  minutes: number;
  lateRegEnd: boolean;
}

export interface PayoutConfig {
  mode: 'auto' | 'manual';
  type: 'money' | 'lots';
  amounts: number[];
  lots: string[];
}

export type TimerFont = 'Inter' | 'Oswald' | 'Oxanium' | 'Montserrat' | 'Roboto' | 'Lato';

export interface ThemeConfig {
  primary: string;
  secondary: string;
  title: string;
  glassOpacity: number; // 0..1
  glassBlur: number; // px
  font: TimerFont;
  backgroundAssetId: string | null;
  logoAssetId: string | null;
  sounds: { start: string | null; warning60: string | null; levelEnd: string | null };
}

export interface ClockState {
  levelIndex: number;
  running: boolean;
  /** Temps restant du niveau au moment `anchorAt` (ou en pause). */
  remainingMs: number;
  /** Instant serveur (ms epoch) de référence quand running=true. */
  anchorAt: number | null;
}

export interface MysteryEnvelope {
  id: string;
  group: string;
  amount: number;
  drawn: boolean;
  drawnBy?: string | null;
}

export interface MysteryState {
  frozen: boolean;
  custom: boolean;
  envelopes: MysteryEnvelope[];
}

export interface Tournament {
  id: string;
  ownerId: string;
  title: string;
  status: TournamentStatus;
  settings: TournamentSettings;
  structure: Level[];
  payouts: PayoutConfig;
  theme: ThemeConfig;
  clock: ClockState;
  mystery: MysteryState;
  publicToken: string;
  version: number;
  pendingMoves: Move[];
  clockGroupId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  exportedChampionshipIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TableRow {
  id: string;
  number: number;
  locked: boolean;
  isFinal: boolean;
}

export interface Player {
  id: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  status: PlayerStatus;
  tableNumber: number | null;
  seatNumber: number | null;
  seatLocked: boolean;
  entries: number;
  rebuys: number;
  addons: number;
  kills: number;
  bountyValue: number;
  bountyWon: number;
  eliminatedBy: string | null;
  eliminatedAt: string | null;
  finishRank: number | null;
  prizeAmount: number | null;
  prizeLabel: string | null;
  present: boolean;
  registrationId: string | null;
  memberId: string | null;
  sngGroup: number | null;
  startChips: number | null;
  createdAt: string;
}

export interface SeatRef {
  table: number;
  seat: number;
}

export interface Move {
  playerId: string;
  pseudo?: string;
  from: SeatRef | null;
  to: SeatRef;
}

export interface TournamentStats {
  activePlayers: number;
  totalEntries: number;
  totalRebuys: number;
  totalAddons: number;
  registered: number;
  prizePool: number;
  bountyPool: number;
  rakeTotal: number;
  chipsInPlay: number;
  averageStack: number;
  tables: number;
}

export interface TournamentSnapshot {
  tournament: Tournament;
  tables: TableRow[];
  players: Player[];
  stats: TournamentStats;
  computedPayouts: number[];
  lateRegOpen: boolean;
  serverTime: number;
  /** Autres lives partageant l'horloge. */
  linked: { id: string; title: string; activePlayers: number }[];
}

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  pseudo: string | null;
  clubName: string | null;
  usageMode: UsageMode;
  rakeEnabled: boolean;
}
