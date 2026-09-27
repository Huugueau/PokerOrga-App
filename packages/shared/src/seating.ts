import type { Move, SeatRef } from './types';

export type Rng = () => number;

export interface SeatPlayer {
  id: string;
  pseudo?: string;
  table: number | null;
  seat: number | null;
  locked: boolean;
}

export interface SeatTable {
  number: number;
  locked: boolean;
  isFinal: boolean;
}

export function shuffle<T>(arr: T[], rng: Rng = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Répartition cible des joueurs par table. */
export function tableDistribution(n: number, maxPerTable: number): number[] {
  if (n <= 0) return [];
  const nt = Math.ceil(n / maxPerTable);
  const base = Math.floor(n / nt);
  const extra = n % nt;
  return Array.from({ length: nt }, (_, i) => base + (i < extra ? 1 : 0));
}

export interface DrawResult {
  seats: Record<string, SeatRef>;
  tableNumbers: number[];
}

/** Tirage (ou retirage) des sièges. Les joueurs à siège verrouillé conservent leur place si leur table existe encore. */
export function drawSeats(players: SeatPlayer[], maxPerTable: number, rng: Rng = Math.random): DrawResult {
  const dist = tableDistribution(players.length, maxPerTable);
  const tableNumbers = dist.map((_, i) => i + 1);
  const occ = new Map<number, Set<number>>(tableNumbers.map((t) => [t, new Set<number>()]));
  const count = new Map<number, number>(tableNumbers.map((t) => [t, 0]));
  const seats: Record<string, SeatRef> = {};
  const rest: SeatPlayer[] = [];
  for (const p of players) {
    if (p.locked && p.table != null && p.seat != null && occ.has(p.table) && p.seat <= maxPerTable && !occ.get(p.table)!.has(p.seat)) {
      occ.get(p.table)!.add(p.seat);
      count.set(p.table, count.get(p.table)! + 1);
      seats[p.id] = { table: p.table, seat: p.seat };
    } else rest.push(p);
  }
  for (const p of shuffle(rest, rng)) {
    let best: number[] = [];
    let bestDeficit = -Infinity;
    tableNumbers.forEach((t, i) => {
      const deficit = dist[i] - count.get(t)!;
      if (occ.get(t)!.size >= maxPerTable) return;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = [t];
      } else if (deficit === bestDeficit) best.push(t);
    });
    const t = best[0];
    const free = freeSeats(occ.get(t)!, maxPerTable);
    const s = pick(free, rng);
    occ.get(t)!.add(s);
    count.set(t, count.get(t)! + 1);
    seats[p.id] = { table: t, seat: s };
  }
  return { seats, tableNumbers };
}

function freeSeats(taken: Set<number>, maxPerTable: number): number[] {
  const out: number[] = [];
  for (let s = 1; s <= maxPerTable; s++) if (!taken.has(s)) out.push(s);
  return out;
}

function occupancy(players: SeatPlayer[]): Map<number, Map<number, SeatPlayer>> {
  const m = new Map<number, Map<number, SeatPlayer>>();
  for (const p of players) {
    if (p.table == null || p.seat == null) continue;
    if (!m.has(p.table)) m.set(p.table, new Map());
    m.get(p.table)!.set(p.seat, p);
  }
  return m;
}

/**
 * Place un nouvel entrant (ou re-entry) : table ouverte la moins remplie, siège libre aléatoire.
 * Retourne `newTable=true` si une nouvelle table doit être créée.
 */
export function placeNewPlayer(
  players: SeatPlayer[],
  tables: SeatTable[],
  maxPerTable: number,
  rng: Rng = Math.random,
): { seat: SeatRef; newTable: boolean } {
  const occ = occupancy(players);
  const candidates = tables
    .filter((t) => !t.locked)
    .map((t) => ({ t: t.number, n: occ.get(t.number)?.size ?? 0 }))
    .filter((c) => c.n < maxPerTable)
    .sort((a, b) => a.n - b.n || a.t - b.t);
  if (candidates.length > 0) {
    const t = candidates[0].t;
    const taken = new Set(occ.get(t)?.keys() ?? []);
    return { seat: { table: t, seat: pick(freeSeats(taken, maxPerTable), rng) }, newTable: false };
  }
  const used = new Set(tables.map((t) => t.number));
  let n = 1;
  while (used.has(n)) n++;
  return { seat: { table: n, seat: 1 + Math.floor(rng() * maxPerTable) }, newTable: true };
}

export interface BalanceSettings {
  maxPerTable: number;
  finalTableSize: number;
  breakTablesHighToLow: boolean;
}

export interface BalanceResult {
  moves: Move[];
  removedTables: number[];
  finalTable: number | null;
}

/** Calcule les déplacements nécessaires : fusion en table finale, casse de tables, égalisation. */
export function computeBalance(
  activePlayers: SeatPlayer[],
  tables: SeatTable[],
  cfg: BalanceSettings,
  rng: Rng = Math.random,
): BalanceResult {
  const players = activePlayers.filter((p) => p.table != null && p.seat != null).map((p) => ({ ...p }));
  const original = new Map(players.map((p) => [p.id, { table: p.table!, seat: p.seat! }]));
  const tableMeta = new Map(tables.map((t) => [t.number, t]));
  const removed: number[] = [];
  let finalTable: number | null = null;

  const occupied = () => {
    const m = new Map<number, SeatPlayer[]>();
    for (const p of players) {
      if (!m.has(p.table!)) m.set(p.table!, []);
      m.get(p.table!)!.push(p);
    }
    return m;
  };
  const seatsTaken = (t: number) => new Set(players.filter((p) => p.table === t).map((p) => p.seat!));
  const moveTo = (p: SeatPlayer, t: number, cap = cfg.maxPerTable) => {
    const free = freeSeats(seatsTaken(t), cap);
    if (free.length === 0) return false;
    p.table = t;
    p.seat = pick(free, rng);
    return true;
  };

  let occ = occupied();
  const n = players.length;

  const finalCap = Math.max(cfg.maxPerTable, cfg.finalTableSize);
  if (occ.size > 1 && n <= cfg.finalTableSize && n <= finalCap) {
    const flagged = tables.find((t) => t.isFinal && occ.has(t.number))?.number;
    // table finale : table marquée, sinon la plus remplie (moins de déplacements), puis numéro le plus bas
    const target =
      flagged ??
      [...occ.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0][0];
    finalTable = target;
    for (const p of shuffle(players.filter((p) => p.table !== target), rng)) moveTo(p, target, finalCap);
    for (const t of occ.keys()) if (t !== target) removed.push(t);
  } else {
    // casse de tables
    let guard = 0;
    while (
      occ.size > 1 &&
      n <= (occ.size - 1) * cfg.maxPerTable &&
      (occ.size - 1 > 1 || n <= cfg.finalTableSize) &&
      guard++ < 50
    ) {
      const breakable = [...occ.keys()].filter((t) => !tableMeta.get(t)?.locked && !tableMeta.get(t)?.isFinal);
      if (breakable.length === 0) break;
      breakable.sort((a, b) => (cfg.breakTablesHighToLow ? b - a : a - b));
      const victim = breakable[0];
      for (const p of shuffle(occ.get(victim)!, rng)) {
        const others = [...occupied().entries()]
          .filter(([t]) => t !== victim)
          .map(([t, ps]) => ({ t, n: ps.length }))
          .filter((c) => c.n < cfg.maxPerTable)
          .sort((a, b) => a.n - b.n || a.t - b.t);
        if (others.length === 0) break;
        moveTo(p, others[0].t);
      }
      removed.push(victim);
      occ = occupied();
    }
    // égalisation
    guard = 0;
    while (guard++ < 200) {
      occ = occupied();
      const counts = [...occ.entries()]
        .filter(([t]) => !tableMeta.get(t)?.locked)
        .map(([t, ps]) => ({ t, n: ps.length, ps }));
      if (counts.length < 2) break;
      const max = counts.reduce((a, b) => (b.n > a.n || (b.n === a.n && b.t > a.t) ? b : a));
      const min = counts.reduce((a, b) => (b.n < a.n || (b.n === a.n && b.t < a.t) ? b : a));
      if (max.n - min.n <= 1) break;
      const movable = max.ps.filter((p) => !p.locked);
      if (movable.length === 0) break;
      moveTo(pick(movable, rng), min.t);
    }
  }

  const moves: Move[] = [];
  for (const p of players) {
    const o = original.get(p.id)!;
    if (o.table !== p.table || o.seat !== p.seat) {
      moves.push({ playerId: p.id, pseudo: p.pseudo, from: o, to: { table: p.table!, seat: p.seat! } });
    }
  }
  moves.sort((a, b) => a.from!.table - b.from!.table || a.to.table - b.to.table);
  return { moves, removedTables: removed, finalTable };
}

/** Aperçu textuel pour les réglages. */
export function tablesPreview(maxPerTable: number, finalTableSize: number) {
  const ft = Math.min(finalTableSize, maxPerTable + 1);
  // à ft+1 joueurs restants, sur 2 tables
  const a = Math.ceil((ft + 1) / 2);
  const b = ft + 1 - a;
  return { finalAt: ft, beforeFinal: { n: ft + 1, a, b } };
}

/** Nombre de sièges d'une table : la table finale peut compter un siège de plus. */
export function tableCapacity(isFinal: boolean, s: { maxPerTable: number; finalTableSize: number }): number {
  return isFinal ? Math.max(s.maxPerTable, Math.min(10, s.finalTableSize)) : s.maxPerTable;
}
