import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  applyAction,
  defaultAnteMode,
  HandError,
  playerChips,
  replayHand,
  resolveClock,
  startHand,
  type HandAction,
  type HandConfig,
  type HandState,
} from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema, type Tx } from '../db';
import { bad, bus, conflict, idParam, notFound, parse, publishTournament, userId } from '../lib';
import { getOwned, mutateTournament, toPlayer, toTournament } from '../services/tournament';

const { hands, players, tournaments } = schema;
type HandRow = typeof hands.$inferSelect;

const card = z.string().regex(/^[2-9TJQKA][shdc]$/, 'Carte invalide.');
const seat = z.number().int().min(1).max(10);
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['fold', 'check', 'call', 'allin', 'muck']), seat }),
  z.object({ type: z.literal('bet'), seat, to: z.number().int().positive() }),
  z.object({ type: z.literal('board'), cards: z.array(card).max(5) }),
  z.object({ type: z.literal('show'), seat, cards: z.array(card).length(2) }),
  z.object({ type: z.literal('resolve') }),
]);

const handParams = idParam.extend({ hid: z.string().uuid() });

function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HandError) throw bad(e.message);
    throw e;
  }
}

function publishHand(tournamentId: string, table: number) {
  bus.emit(`t:${tournamentId}`, { type: 'hand', table });
}

/** Verrouille le tournoi (propriétaire) le temps d'une transaction. */
async function lockTournament(tx: Tx, id: string, uid: string) {
  const [row] = await tx.execute<{ id: string }>(sql`select id from tournaments where id = ${id} and owner_id = ${uid} for update`).then((r) => r.rows);
  if (!row) throw notFound('Tournoi introuvable.');
  const [full] = await tx.select().from(tournaments).where(eq(tournaments.id, id));
  return toTournament(full);
}

async function bumpVersion(tx: Tx, id: string): Promise<number> {
  const [r] = await tx
    .update(tournaments)
    .set({ version: sql`${tournaments.version} + 1`, updatedAt: new Date() })
    .where(eq(tournaments.id, id))
    .returning({ version: tournaments.version });
  return r.version;
}

/** Applique (sign = 1) ou annule (sign = -1) les variations de tapis d'une main terminée. */
async function applyDeltas(tx: Tx, tournamentId: string, deltas: Record<string, number>, sign: 1 | -1) {
  const ids = Object.keys(deltas);
  if (!ids.length) return;
  const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  const settings = toTournament(t).settings;
  const rows = await tx.select().from(players).where(and(eq(players.tournamentId, tournamentId), inArray(players.id, ids)));
  for (const r of rows) {
    const chips = Math.max(0, playerChips(toPlayer(r), settings) + sign * deltas[r.id]);
    await tx.update(players).set({ chips }).where(eq(players.id, r.id));
  }
}

function deltasOf(s: HandState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of s.players) if (p.playerId) out[p.playerId] = s.result!.finalStacks[p.seat] - p.startStack;
  return out;
}

function summary(h: HandRow) {
  const names = new Map(h.config.seats.map((x) => [x.seat, x.name]));
  const pots = h.result?.pots ?? [];
  const winners = [...new Set(pots.flatMap((p) => p.winners))].map((w) => names.get(w) ?? `Siège ${w}`);
  return {
    id: h.id,
    tableNumber: h.tableNumber,
    handNumber: h.handNumber,
    status: h.status,
    levelIndex: h.levelIndex,
    sb: h.config.sb,
    bb: h.config.bb,
    players: h.config.seats.length,
    pot: pots.reduce((a, p) => a + p.amount, 0),
    winners,
    hand: pots.find((p) => p.hand)?.hand ?? null,
    showdown: h.result?.showdown ?? false,
    startedAt: h.startedAt,
    finishedAt: h.finishedAt,
  };
}

async function loadHand(tx: Tx | typeof db, tournamentId: string, hid: string, lock = false): Promise<HandRow> {
  const q = tx.select().from(hands).where(and(eq(hands.id, hid), eq(hands.tournamentId, tournamentId)));
  const [h] = lock ? await q.for('update') : await q;
  if (!h) throw notFound('Main introuvable.');
  return h;
}

export async function handRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** Main en cours et dernière main terminée d'une table. */
  app.get('/tournaments/:id/tables/:n/hand', async (req) => {
    const { id, n } = parse(idParam.extend({ n: z.coerce.number().int().min(1) }), req.params);
    await getOwned(id, userId(req));
    const [current] = await db
      .select()
      .from(hands)
      .where(and(eq(hands.tournamentId, id), eq(hands.tableNumber, n), eq(hands.status, 'running')))
      .limit(1);
    const [last] = await db
      .select()
      .from(hands)
      .where(and(eq(hands.tournamentId, id), eq(hands.tableNumber, n), eq(hands.status, 'finished')))
      .orderBy(desc(hands.handNumber))
      .limit(1);
    return { hand: current ?? null, last: last ?? null };
  });

  app.get('/tournaments/:id/hands', async (req) => {
    const { id } = parse(idParam, req.params);
    const { table } = parse(z.object({ table: z.coerce.number().int().min(1).optional() }), req.query);
    await getOwned(id, userId(req));
    const rows = await db
      .select()
      .from(hands)
      .where(and(eq(hands.tournamentId, id), ne(hands.status, 'cancelled'), table ? eq(hands.tableNumber, table) : undefined))
      .orderBy(desc(hands.startedAt))
      .limit(300);
    return { hands: rows.map(summary) };
  });

  app.get('/tournaments/:id/hands/:hid', async (req) => {
    const { id, hid } = parse(handParams, req.params);
    await getOwned(id, userId(req));
    return { hand: await loadHand(db, id, hid) };
  });

  /** Distribue une nouvelle main à une table. */
  app.post('/tournaments/:id/hands', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        table: z.number().int().min(1),
        button: seat,
        anteMode: z.enum(['none', 'bb', 'all']).optional(),
        /** Sièges exclus de la main (joueur absent qui ne reçoit pas de cartes). */
        exclude: z.array(seat).max(10).default([]),
      }),
      req.body,
    );
    const row = await db.transaction(async (tx) => {
      const t = await lockTournament(tx, id, userId(req));
      if (t.status === 'finished') throw conflict('Ce tournoi est terminé (lecture seule).');
      const [running] = await tx
        .select({ id: hands.id })
        .from(hands)
        .where(and(eq(hands.tournamentId, id), eq(hands.tableNumber, body.table), eq(hands.status, 'running')));
      if (running) throw conflict('Une main est déjà en cours à cette table.');

      const rc = resolveClock(t.clock, t.structure, Date.now());
      let levelIndex = rc.levelIndex;
      while (t.structure[levelIndex]?.kind === 'break') levelIndex++;
      const level = t.structure[levelIndex] ?? t.structure.findLast((l) => l.kind === 'level');
      if (!level || level.bb <= 0) throw bad('Aucun niveau de blindes défini.');

      const seated = (await tx.select().from(players).where(and(eq(players.tournamentId, id), eq(players.tableNumber, body.table), eq(players.status, 'active'))))
        .filter((p) => p.seatNumber != null && !body.exclude.includes(p.seatNumber))
        .map(toPlayer);
      const config: HandConfig = {
        seats: seated
          .map((p) => ({ seat: p.seatNumber!, playerId: p.id, name: p.pseudo, stack: playerChips(p, t.settings) }))
          .filter((x) => x.stack > 0)
          .sort((a, b) => a.seat - b.seat),
        button: body.button,
        sb: level.sb,
        bb: level.bb,
        ante: level.ante,
        anteMode: level.ante > 0 ? (body.anteMode ?? defaultAnteMode(level.ante, level.bb)) : 'none',
      };
      run(() => startHand(config));
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${hands.handNumber}), 0)` })
        .from(hands)
        .where(and(eq(hands.tournamentId, id), eq(hands.tableNumber, body.table)));
      const [h] = await tx
        .insert(hands)
        .values({ tournamentId: id, tableNumber: body.table, handNumber: Number(max) + 1, config, actions: [], levelIndex })
        .returning();
      return h;
    });
    publishHand(id, body.table);
    return { hand: row };
  });

  /** Ajoute une action à la main (contrôle de concurrence : `expected` = nombre d'actions connues). */
  app.post('/tournaments/:id/hands/:hid/actions', async (req) => {
    const { id, hid } = parse(handParams, req.params);
    const body = parse(z.object({ action: actionSchema, expected: z.number().int().min(0) }), req.body);
    let version = 0;
    const row = await db.transaction(async (tx) => {
      await lockTournament(tx, id, userId(req));
      const h = await loadHand(tx, id, hid, true);
      if (h.status !== 'running') throw conflict('Cette main est terminée.');
      if (h.actions.length !== body.expected) throw conflict('La main a été modifiée depuis un autre appareil. Rechargement…');
      const actions = [...h.actions, body.action as HandAction];
      const state = run(() => applyAction(replayHand(h.config, h.actions), body.action as HandAction));
      const patch: Partial<HandRow> = { actions };
      if (state.phase === 'complete') {
        const deltas = deltasOf(state);
        await applyDeltas(tx, id, deltas, 1);
        Object.assign(patch, { status: 'finished', result: state.result, deltas, finishedAt: new Date() });
        version = await bumpVersion(tx, id);
      }
      const [u] = await tx.update(hands).set(patch).where(eq(hands.id, hid)).returning();
      return u;
    });
    publishHand(id, row.tableNumber);
    if (version) publishTournament(id, version);
    return { hand: row };
  });

  /** Annule la dernière action (y compris la clôture de la dernière main de la table). */
  app.post('/tournaments/:id/hands/:hid/undo', async (req) => {
    const { id, hid } = parse(handParams, req.params);
    const body = parse(z.object({ expected: z.number().int().min(0) }), req.body);
    let version = 0;
    const row = await db.transaction(async (tx) => {
      await lockTournament(tx, id, userId(req));
      const h = await loadHand(tx, id, hid, true);
      if (h.status === 'cancelled') throw conflict('Cette main a été annulée.');
      if (h.actions.length !== body.expected) throw conflict('La main a été modifiée depuis un autre appareil. Rechargement…');
      if (h.actions.length === 0) throw bad('Aucune action à annuler.');
      const patch: Partial<HandRow> = { actions: h.actions.slice(0, -1) };
      if (h.status === 'finished') {
        const later = await tx
          .select({ id: hands.id })
          .from(hands)
          .where(and(eq(hands.tournamentId, id), eq(hands.tableNumber, h.tableNumber), ne(hands.status, 'cancelled'), sql`${hands.handNumber} > ${h.handNumber}`));
        if (later.length) throw conflict("Seule la dernière main de la table peut être rouverte.");
        await applyDeltas(tx, id, h.deltas ?? {}, -1);
        Object.assign(patch, { status: 'running', result: null, deltas: null, finishedAt: null });
        version = await bumpVersion(tx, id);
      }
      const [u] = await tx.update(hands).set(patch).where(eq(hands.id, hid)).returning();
      return u;
    });
    publishHand(id, row.tableNumber);
    if (version) publishTournament(id, version);
    return { hand: row };
  });

  /** Annule une main en cours (maldonne) : aucun jeton ne bouge. */
  app.post('/tournaments/:id/hands/:hid/cancel', async (req) => {
    const { id, hid } = parse(handParams, req.params);
    const row = await db.transaction(async (tx) => {
      await lockTournament(tx, id, userId(req));
      const h = await loadHand(tx, id, hid, true);
      if (h.status !== 'running') throw conflict('Seule une main en cours peut être annulée.');
      const [u] = await tx.update(hands).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(hands.id, hid)).returning();
      return u;
    });
    publishHand(id, row.tableNumber);
    return { ok: true };
  });

  /** Correction manuelle d'un tapis (recomptage). null = revenir à l'estimation. */
  app.patch('/tournaments/:id/players/:pid/chips', async (req) => {
    const { id, pid } = parse(idParam.extend({ pid: z.string().uuid() }), req.params);
    const body = parse(z.object({ chips: z.number().int().min(0).max(1_000_000_000).nullable() }), req.body);
    await mutateTournament(id, userId(req), async ({ tx }) => {
      const [p] = await tx.select().from(players).where(and(eq(players.id, pid), eq(players.tournamentId, id)));
      if (!p) throw notFound('Joueur introuvable.');
      if (p.tableNumber != null) {
        const [running] = await tx
          .select({ config: hands.config })
          .from(hands)
          .where(and(eq(hands.tournamentId, id), eq(hands.tableNumber, p.tableNumber), eq(hands.status, 'running')));
        if (running?.config.seats.some((x) => x.playerId === pid)) throw conflict('Main en cours : corrigez le tapis une fois la main terminée.');
      }
      await tx.update(players).set({ chips: body.chips }).where(eq(players.id, pid));
    });
    return { ok: true };
  });
}
