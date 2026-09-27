import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  autoPayouts,
  clockInfo,
  computeBalance,
  computeStats,
  DEFAULT_MYSTERY,
  DEFAULT_PAYOUTS,
  DEFAULT_SETTINGS,
  DEFAULT_THEME,
  DEFAULT_TITLE,
  defaultEnvelopeCount,
  defaultStructure,
  generateEnvelopes,
  initialClock,
  resolveClock,
  type Move,
  type Player,
  type TableRow,
  type Tournament,
  type TournamentSettings,
  type TournamentSnapshot,
} from '@pokerorga/shared';
import { db, schema, type Tx } from '../db';
import { HttpError, notFound, publicToken, publishTournament } from '../lib';

const { tournaments, players, tournamentTables } = schema;

export type TournamentRow = typeof tournaments.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type TableDbRow = typeof tournamentTables.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toTournament(r: TournamentRow): Tournament {
  return {
    id: r.id,
    ownerId: r.ownerId,
    title: r.title,
    status: r.status,
    settings: { ...DEFAULT_SETTINGS, ...r.settings, bounty: { ...DEFAULT_SETTINGS.bounty, ...r.settings.bounty } },
    structure: r.structure,
    payouts: { ...DEFAULT_PAYOUTS, ...r.payouts },
    theme: { ...DEFAULT_THEME, ...r.theme, sounds: { ...DEFAULT_THEME.sounds, ...r.theme.sounds } },
    clock: r.clock,
    mystery: { ...DEFAULT_MYSTERY, ...r.mystery },
    publicToken: r.publicToken,
    version: r.version,
    pendingMoves: r.pendingMoves ?? [],
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    exportedChampionshipIds: r.exportedChampionshipIds ?? [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    pseudo: r.pseudo,
    firstName: r.firstName,
    lastName: r.lastName,
    status: r.status,
    tableNumber: r.tableNumber,
    seatNumber: r.seatNumber,
    seatLocked: r.seatLocked,
    entries: r.entries,
    rebuys: r.rebuys,
    addons: r.addons,
    kills: r.kills,
    bountyValue: Number(r.bountyValue),
    bountyWon: Number(r.bountyWon),
    eliminatedBy: r.eliminatedBy,
    eliminatedAt: iso(r.eliminatedAt),
    finishRank: r.finishRank,
    prizeAmount: r.prizeAmount == null ? null : Number(r.prizeAmount),
    prizeLabel: r.prizeLabel,
    present: r.present,
    registrationId: r.registrationId,
    memberId: r.memberId,
    sngGroup: r.sngGroup,
    createdAt: r.createdAt.toISOString(),
  };
}

export const toTable = (r: TableDbRow): TableRow => ({ id: r.id, number: r.number, locked: r.locked, isFinal: r.isFinal });

export function baseBounty(s: TournamentSettings): number {
  return s.bounty.type === 'fixed' || s.bounty.type === 'progressive' ? s.bounty.amount : 0;
}

export async function createTournament(ownerId: string, init: Partial<{ title: string; settings: TournamentSettings }> = {}, tx: Tx | typeof db = db) {
  const structure = defaultStructure();
  const [row] = await tx
    .insert(tournaments)
    .values({
      ownerId,
      title: init.title ?? DEFAULT_TITLE,
      settings: init.settings ?? DEFAULT_SETTINGS,
      structure,
      payouts: DEFAULT_PAYOUTS,
      theme: DEFAULT_THEME,
      clock: initialClock(structure),
      mystery: DEFAULT_MYSTERY,
      publicToken: publicToken(),
    })
    .returning();
  return row;
}

/** Classe les joueurs : rangs dynamiques (éliminés du plus récent au plus ancien) et gains. */
export function rankPlayers(list: Player[], payouts: number[], lots: string[], lotsMode: boolean, finished: boolean, multiSng = false): Player[] {
  if (multiSng) {
    const groups = new Map<number, Player[]>();
    for (const p of list) {
      const g = p.sngGroup ?? 0;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(p);
    }
    const ranked = new Map<string, Player>();
    for (const g of groups.values()) for (const p of rankPlayers(g, [], [], false, finished)) ranked.set(p.id, p);
    return list.map((p) => ranked.get(p.id)!);
  }
  const active = list.filter((p) => p.status === 'active');
  const elim = list
    .filter((p) => p.status === 'eliminated')
    .sort((a, b) => (b.eliminatedAt ?? '').localeCompare(a.eliminatedAt ?? ''));
  const ranks = new Map<string, number>();
  if (active.length === 1) ranks.set(active[0].id, 1);
  elim.forEach((p, i) => ranks.set(p.id, active.length + i + 1));
  return list.map((p) => {
    const rank = finished && p.finishRank != null ? p.finishRank : (ranks.get(p.id) ?? null);
    if (finished) return { ...p, finishRank: rank };
    const prizeAmount = rank != null && !lotsMode && payouts[rank - 1] != null ? payouts[rank - 1] : null;
    const prizeLabel = rank != null && lotsMode && lots[rank - 1] ? lots[rank - 1] : null;
    return { ...p, finishRank: rank, prizeAmount, prizeLabel };
  });
}

export function computedPayoutsFor(t: Tournament, prizePool: number, totalEntries: number): number[] {
  if (t.settings.isFree || t.payouts.type === 'lots') return [];
  if (t.payouts.mode === 'manual') return t.payouts.amounts;
  return autoPayouts(totalEntries, prizePool);
}

export async function buildSnapshot(row: TournamentRow, now = Date.now()): Promise<TournamentSnapshot> {
  const [prow, trows] = await Promise.all([
    db.select().from(players).where(eq(players.tournamentId, row.id)).orderBy(asc(players.createdAt)),
    db.select().from(tournamentTables).where(eq(tournamentTables.tournamentId, row.id)).orderBy(asc(tournamentTables.number)),
  ]);
  const t = toTournament(row);
  const list = prow.map(toPlayer);
  const stats = computeStats(t.settings, list);
  const computedPayouts = computedPayoutsFor(t, stats.prizePool, stats.totalEntries);
  const ranked = rankPlayers(list, computedPayouts, t.payouts.lots, t.payouts.type === 'lots', t.status === 'finished', t.settings.multiSng);
  const r = resolveClock(t.clock, t.structure, now);
  const info = clockInfo(t.structure, r);
  return {
    tournament: t,
    tables: trows.map(toTable),
    players: ranked,
    stats,
    computedPayouts,
    lateRegOpen: info.lateRegOpen,
    serverTime: now,
  };
}

export async function getOwned(id: string, ownerId: string): Promise<TournamentRow> {
  const [row] = await db
    .select()
    .from(tournaments)
    .where(and(eq(tournaments.id, id), eq(tournaments.ownerId, ownerId)));
  if (!row) throw notFound('Tournoi introuvable.');
  return row;
}

export interface MutationCtx {
  tx: Tx;
  t: Tournament;
  row: TournamentRow;
  now: number;
  /** Modifications à persister sur la ligne du tournoi. */
  patch: Partial<typeof tournaments.$inferInsert>;
}

/**
 * Exécute une mutation transactionnelle sur un tournoi (verrou pessimiste),
 * incrémente la version et notifie les abonnés temps réel.
 */
export async function mutateTournament<T>(
  id: string,
  ownerId: string,
  fn: (ctx: MutationCtx) => Promise<T>,
  opts: { allowFinished?: boolean } = {},
): Promise<T> {
  let version = 0;
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`select id from tournaments where id = ${id} and owner_id = ${ownerId} for update`).then((r) => r.rows);
    if (!row) throw notFound('Tournoi introuvable.');
    const [full] = await tx.select().from(tournaments).where(eq(tournaments.id, id));
    if (full.status === 'finished' && !opts.allowFinished) throw new HttpError(409, 'Ce tournoi est terminé (lecture seule).');
    const ctx: MutationCtx = { tx, t: toTournament(full), row: full, now: Date.now(), patch: {} };
    const res = await fn(ctx);
    version = full.version + 1;
    await tx
      .update(tournaments)
      .set({ ...ctx.patch, version, updatedAt: new Date() })
      .where(eq(tournaments.id, id));
    return res;
  });
  publishTournament(id, version);
  return result;
}

export async function loadPlayers(tx: Tx, tournamentId: string) {
  return tx.select().from(players).where(eq(players.tournamentId, tournamentId));
}

export async function loadTables(tx: Tx, tournamentId: string) {
  return tx.select().from(tournamentTables).where(eq(tournamentTables.tournamentId, tournamentId)).orderBy(asc(tournamentTables.number));
}

/** Équilibre les tables après un changement d'effectif (si des tables existent). */
export async function rebalance(ctx: MutationCtx, force = false): Promise<Move[]> {
  const { tx, t } = ctx;
  if (!t.settings.autoBalance && !force) return [];
  const tables = await loadTables(tx, t.id);
  if (tables.length === 0) return [];
  const plist = (await loadPlayers(tx, t.id)).filter((p) => p.status === 'active');
  const res = computeBalance(
    plist.map((p) => ({ id: p.id, pseudo: p.pseudo, table: p.tableNumber, seat: p.seatNumber, locked: p.seatLocked })),
    tables.map(toTable),
    t.settings,
  );
  for (const m of res.moves) {
    await tx.update(players).set({ tableNumber: m.to.table, seatNumber: m.to.seat }).where(eq(players.id, m.playerId));
  }
  if (res.finalTable != null) {
    await tx
      .update(tournamentTables)
      .set({ isFinal: true })
      .where(and(eq(tournamentTables.tournamentId, t.id), eq(tournamentTables.number, res.finalTable)));
  }
  for (const n of res.removedTables) {
    await tx.delete(tournamentTables).where(and(eq(tournamentTables.tournamentId, t.id), eq(tournamentTables.number, n)));
  }
  if (res.moves.length > 0) {
    ctx.patch.pendingMoves = [...(ctx.patch.pendingMoves ?? t.pendingMoves), ...res.moves].slice(-40);
  }
  return res.moves;
}

/** Fige automatiquement la grille mystery (fin de late reg) si nécessaire. */
export function ensureMysteryFrozen(ctx: MutationCtx, totalEntries: number) {
  const { t } = ctx;
  if (t.settings.bounty.type !== 'mystery') return;
  const m = ctx.patch.mystery ?? t.mystery;
  if (m.frozen) return;
  const pool = totalEntries * t.settings.bounty.amount;
  const envelopes = m.custom && m.envelopes.length > 0 ? m.envelopes : generateEnvelopes(pool, defaultEnvelopeCount(totalEntries));
  ctx.patch.mystery = { ...m, frozen: true, envelopes };
}

export async function otherLiveTournaments(ownerId: string, exceptId: string) {
  return db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(and(eq(tournaments.ownerId, ownerId), ne(tournaments.status, 'finished'), ne(tournaments.id, exceptId)));
}
