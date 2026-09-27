import { describe, expect, it } from 'vitest';
import {
  applyClockAction,
  autoPayouts,
  championshipPoints,
  clockInfo,
  computeBalance,
  computeRanking,
  computeStats,
  DEFAULT_SETTINGS,
  defaultStructure,
  drawSeats,
  envelopesTotal,
  generateEnvelopes,
  generateStructure,
  initialClock,
  parsePlayersFile,
  parseStructureCsv,
  placeNewPlayer,
  resolveClock,
  type SeatPlayer,
} from './index';

function seededRng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('clock', () => {
  const levels = defaultStructure();
  it('reste figé en pause', () => {
    const c = initialClock(levels);
    const r = resolveClock(c, levels, 10_000_000);
    expect(r).toMatchObject({ levelIndex: 0, remainingMs: 20 * 60000, running: false });
  });
  it('avance les niveaux automatiquement', () => {
    const t0 = 1_000_000;
    const c = applyClockAction(initialClock(levels), levels, t0, { action: 'play' });
    const r = resolveClock(c, levels, t0 + 25 * 60000);
    expect(r.levelIndex).toBe(1);
    expect(r.remainingMs).toBe(15 * 60000);
  });
  it('pause conserve le temps restant', () => {
    const t0 = 0;
    let c = applyClockAction(initialClock(levels), levels, t0, { action: 'play' });
    c = applyClockAction(c, levels, t0 + 60000, { action: 'pause' });
    expect(resolveClock(c, levels, t0 + 999999).remainingMs).toBe(19 * 60000);
  });
  it('détecte un conflit de niveau', () => {
    const c = initialClock(levels);
    expect(() => applyClockAction(c, levels, 0, { action: 'next', expectedLevel: 3 })).toThrow();
  });
  it('fin de structure', () => {
    const c = applyClockAction(initialClock(levels), levels, 0, { action: 'play' });
    const r = resolveClock(c, levels, 1e10);
    expect(r.finished).toBe(true);
  });
  it('infos : pause et late reg', () => {
    const r = resolveClock(initialClock(levels), levels, 0);
    const info = clockInfo(levels, r);
    expect(info.msToNextBreak).toBe(60 * 60000);
    expect(info.msToLateRegEnd).toBe((20 * 6 + 10 * 2) * 60000);
    expect(info.nextLevel?.bb).toBe(150);
  });
});

describe('prize pool & payouts', () => {
  it('calcule le prize pool avec bounty', () => {
    const s = { ...DEFAULT_SETTINGS, buyin: 20, bounty: { type: 'fixed' as const, amount: 5, drawFrom: null } };
    const players = Array.from({ length: 10 }, () => ({ status: 'active' as const, entries: 1, rebuys: 0, addons: 0, tableNumber: 1 }));
    const st = computeStats(s, players);
    expect(st.prizePool).toBe(150);
    expect(st.bountyPool).toBe(50);
    expect(st.averageStack).toBe(10000);
  });
  it('répartition automatique = prize pool', () => {
    for (const n of [2, 5, 9, 14, 18, 27, 35, 50, 90, 200]) {
      const pool = n * 17;
      const a = autoPayouts(n, pool);
      expect(a.reduce((x, y) => x + y, 0)).toBe(Math.round(pool));
      for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThanOrEqual(a[i - 1]);
    }
  });
});

describe('seating', () => {
  const mk = (n: number): SeatPlayer[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, table: null, seat: null, locked: false }));
  it('tirage équilibré', () => {
    const r = drawSeats(mk(23), 9, seededRng());
    const counts = r.tableNumbers.map((t) => Object.values(r.seats).filter((s) => s.table === t).length);
    expect(counts.sort()).toEqual([7, 8, 8]);
    const keys = new Set(Object.values(r.seats).map((s) => `${s.table}-${s.seat}`));
    expect(keys.size).toBe(23);
  });
  it('place un nouvel entrant à la table la moins remplie', () => {
    const r = drawSeats(mk(15), 8, seededRng());
    const players = Object.entries(r.seats).map(([id, s]) => ({ id, table: s.table, seat: s.seat, locked: false }));
    const res = placeNewPlayer(players, r.tableNumbers.map((n) => ({ number: n, locked: false, isFinal: false })), 8, seededRng(3));
    const t = res.seat.table;
    expect(players.filter((p) => p.table === t).length).toBe(7);
  });
  it('équilibre, casse et fusionne', () => {
    const rng = seededRng(7);
    const r = drawSeats(mk(20), 10, rng);
    let players: SeatPlayer[] = Object.entries(r.seats).map(([id, s]) => ({ id, table: s.table, seat: s.seat, locked: false }));
    const tables = r.tableNumbers.map((n) => ({ number: n, locked: false, isFinal: false }));
    // élimine 4 joueurs de la table 1
    const t1 = players.filter((p) => p.table === 1).slice(0, 4).map((p) => p.id);
    players = players.filter((p) => !t1.includes(p.id));
    const b = computeBalance(players, tables, { maxPerTable: 10, finalTableSize: 10, breakTablesHighToLow: true }, rng);
    expect(b.moves.length).toBe(2);
    // réduit à 10 joueurs → fusion
    const ten = players.slice(0, 10);
    const f = computeBalance(ten, tables, { maxPerTable: 10, finalTableSize: 10, breakTablesHighToLow: true }, rng);
    expect(f.finalTable).not.toBeNull();
    expect(f.removedTables.length).toBe(1);
  });
});

describe('generator', () => {
  it('génère une structure croissante', () => {
    const { levels, summary } = generateStructure({ players: 20, startStack: 20000, durationHours: 4, levelMinutes: 20, smallestChip: 25, ante: true, breakEvery: 4 });
    const lv = levels.filter((l) => l.kind === 'level');
    for (let i = 1; i < lv.length; i++) expect(lv[i].bb).toBeGreaterThan(lv[i - 1].bb);
    expect(levels.some((l) => l.lateRegEnd)).toBe(true);
    expect(summary.startBB).toBe(200);
  });
});

describe('championship', () => {
  it('formule de points', () => {
    expect(championshipPoints(16, 1)).toBe(40);
    expect(championshipPoints(16, 4)).toBe(20);
  });
  it('jokers', () => {
    const rows = computeRanking(
      [
        { id: 'a', name: 'A', results: [{ importId: '1', points: 10, kills: 1 }, { importId: '2', points: 30, kills: 0 }], bonuses: [{ points: 2 }] },
        { id: 'b', name: 'B', results: [{ importId: '1', points: 25, kills: 3 }], bonuses: [] },
      ],
      1,
    );
    expect(rows[0]).toMatchObject({ id: 'a', points: 32, retained: 1, played: 2 });
  });
});

describe('csv', () => {
  it('parse joueurs csv et txt', () => {
    expect(parsePlayersFile('pseudo;prenom;nom\nMax;Maxime;D\nmax;;\nBob;;').rows).toHaveLength(2);
    expect(parsePlayersFile('Alice\nBob\n').rows.map((r) => r.pseudo)).toEqual(['Alice', 'Bob']);
  });
  it('parse structure', () => {
    const r = parseStructureCsv('type;sb;bb;ante;duree\nniveau;50;100;0;20\npause;0;0;0;10');
    expect(r.errors).toEqual([]);
    expect(r.levels).toHaveLength(2);
    expect(parseStructureCsv('a;b\n1;2').errors.length).toBe(1);
  });
});

describe('mystery', () => {
  it('somme des enveloppes = pool', () => {
    for (const [pool, n] of [[500, 10], [123, 4], [1000, 7]] as const) {
      const e = generateEnvelopes(pool, n);
      expect(e).toHaveLength(n);
      expect(envelopesTotal(e)).toBe(pool);
    }
  });
});
