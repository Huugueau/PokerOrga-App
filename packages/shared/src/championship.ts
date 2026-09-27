export function championshipPoints(entries: number, rank: number): number {
  const r = rank > 0 ? rank : entries;
  return Math.round(10 * Math.sqrt(entries / r) * 10) / 10;
}

export interface ChampResult {
  importId: string;
  points: number;
  kills: number;
  cancelled?: boolean;
}

export interface ChampBonus {
  points: number;
  cancelled?: boolean;
}

export interface ChampPlayerInput {
  id: string;
  name: string;
  results: ChampResult[];
  bonuses: ChampBonus[];
}

export interface RankingRow {
  id: string;
  name: string;
  points: number;
  bonus: number;
  kills: number;
  played: number;
  retained: number;
  retainedImportIds: string[];
  position: number;
}

export function computeRanking(players: ChampPlayerInput[], bestResults: number | null): RankingRow[] {
  const rows = players.map((p) => {
    const res = p.results.filter((r) => !r.cancelled).slice().sort((a, b) => b.points - a.points);
    const kept = bestResults && bestResults > 0 ? res.slice(0, bestResults) : res;
    const bonus = p.bonuses.filter((b) => !b.cancelled).reduce((a, b) => a + b.points, 0);
    const pts = kept.reduce((a, r) => a + r.points, 0) + bonus;
    return {
      id: p.id,
      name: p.name,
      points: Math.round(pts * 10) / 10,
      bonus: Math.round(bonus * 10) / 10,
      kills: res.reduce((a, r) => a + r.kills, 0),
      played: res.length,
      retained: kept.length,
      retainedImportIds: kept.map((r) => r.importId),
      position: 0,
    };
  });
  rows.sort((a, b) => b.points - a.points || b.kills - a.kills || a.name.localeCompare(b.name, 'fr'));
  let prev: RankingRow | null = null;
  rows.forEach((r, i) => {
    r.position = prev && prev.points === r.points && prev.kills === r.kills ? prev.position : i + 1;
    prev = r;
  });
  return rows.filter((r) => r.played > 0 || r.bonus !== 0);
}
