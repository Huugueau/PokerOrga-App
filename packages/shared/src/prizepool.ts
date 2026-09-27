import type { Player, TournamentSettings, TournamentStats } from './types';

export function bountyShare(s: TournamentSettings): number {
  return s.bounty.type === 'none' ? 0 : Math.max(0, s.bounty.amount);
}

export function computeStats(s: TournamentSettings, players: Pick<Player, 'status' | 'entries' | 'rebuys' | 'addons' | 'tableNumber'>[]): TournamentStats {
  const activePlayers = players.filter((p) => p.status === 'active').length;
  const totalEntries = players.reduce((a, p) => a + p.entries, 0);
  const totalRebuys = players.reduce((a, p) => a + p.rebuys, 0);
  const totalAddons = players.reduce((a, p) => a + p.addons, 0);
  const rebuyCost = s.rebuyCost ?? s.buyin;
  const rebuyStack = s.rebuyStack ?? s.startStack;
  const bShare = bountyShare(s);
  const prizePool = s.isFree
    ? 0
    : Math.max(0, totalEntries * (s.buyin - bShare - s.rake) + totalRebuys * (rebuyCost - s.rake) + totalAddons * s.addonCost);
  const bountyPool = totalEntries * bShare;
  const chipsInPlay = totalEntries * s.startStack + totalRebuys * rebuyStack + totalAddons * s.addonStack;
  const tables = new Set(players.filter((p) => p.status === 'active' && p.tableNumber != null).map((p) => p.tableNumber)).size;
  return {
    activePlayers,
    totalEntries,
    totalRebuys,
    totalAddons,
    registered: players.length,
    prizePool: round2(prizePool),
    bountyPool: round2(bountyPool),
    chipsInPlay,
    averageStack: activePlayers > 0 ? Math.round(chipsInPlay / activePlayers) : 0,
    tables,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatChips(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n));
}

export function formatMoney(n: number): string {
  const opts = Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `${new Intl.NumberFormat('fr-FR', opts).format(n)} €`;
}

/** Format court pour les blindes : 1 500 → 1,5k si >= 10 000. */
export function formatBlind(n: number): string {
  if (n >= 10000 && n % 1000 === 0) return `${n / 1000}k`;
  return new Intl.NumberFormat('fr-FR').format(n);
}
