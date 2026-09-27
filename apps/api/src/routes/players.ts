import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  clockInfo,
  drawEnvelope,
  drawSeats,
  placeNewPlayer,
  playerInputSchema,
  resolveClock,
  type Tournament,
} from '@pokerorga/shared';
import { z } from 'zod';
import { schema, type Tx } from '../db';
import { bad, conflict, idParam, notFound, parse, userId } from '../lib';
import { baseBounty, ensureMysteryFrozen, loadPlayers, loadTables, mutateTournament, rebalance, toTable, type MutationCtx, type PlayerRow } from '../services/tournament';

const { players, tournamentTables, playerActions } = schema;
const pParams = idParam.extend({ pid: z.string().uuid() });

function lateRegOpen(t: Tournament, now: number) {
  return clockInfo(t.structure, resolveClock(t.clock, t.structure, now)).lateRegOpen;
}

async function getPlayer(tx: Tx, tid: string, pid: string): Promise<PlayerRow> {
  const [p] = await tx.select().from(players).where(and(eq(players.id, pid), eq(players.tournamentId, tid)));
  if (!p) throw notFound('Joueur introuvable.');
  return p;
}

async function pseudoTaken(tx: Tx, tid: string, pseudo: string, exceptId?: string) {
  const rows = await tx
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.tournamentId, tid), sql`lower(${players.pseudo}) = lower(${pseudo})`));
  return rows.some((r) => r.id !== exceptId);
}

/** Attribue un siège à un joueur si le tournoi est placé (tables existantes). */
export async function seatPlayer(ctx: MutationCtx, playerId: string) {
  const { tx, t } = ctx;
  const tables = await loadTables(tx, t.id);
  if (tables.length === 0) return null;
  const active = (await loadPlayers(tx, t.id)).filter((p) => p.status === 'active' && p.id !== playerId);
  const res = placeNewPlayer(
    active.map((p) => ({ id: p.id, table: p.tableNumber, seat: p.seatNumber, locked: p.seatLocked })),
    tables.map(toTable),
    t.settings.maxPerTable,
  );
  if (res.newTable) await tx.insert(tournamentTables).values({ tournamentId: t.id, number: res.seat.table });
  await tx.update(players).set({ tableNumber: res.seat.table, seatNumber: res.seat.seat }).where(eq(players.id, playerId));
  return res.seat;
}

export async function insertPlayers(ctx: MutationCtx, rows: { pseudo: string; firstName?: string | null; lastName?: string | null; registrationId?: string | null; present?: boolean }[]) {
  const { tx, t } = ctx;
  const existing = await loadPlayers(tx, t.id);
  const seen = new Set(existing.map((p) => p.pseudo.toLowerCase()));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    const key = r.pseudo.trim().toLowerCase();
    if (!key || seen.has(key)) {
      skipped.push(r.pseudo);
      continue;
    }
    seen.add(key);
    const [p] = await tx
      .insert(players)
      .values({
        tournamentId: t.id,
        pseudo: r.pseudo.trim(),
        firstName: r.firstName || null,
        lastName: r.lastName || null,
        bountyValue: baseBounty(t.settings),
        registrationId: r.registrationId ?? null,
        present: r.present ?? false,
      })
      .returning();
    await seatPlayer(ctx, p.id);
    added.push(p.pseudo);
  }
  if (added.length > 0) await rebalance(ctx);
  return { added, skipped };
}

async function logAction(ctx: MutationCtx, playerId: string, type: string, payload: Record<string, unknown> = {}) {
  await ctx.tx.insert(playerActions).values({ tournamentId: ctx.t.id, playerId, type, payload });
}

export async function playerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/tournaments/:id/players', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(playerInputSchema.extend({ override: z.boolean().optional() }), req.body);
    return mutateTournament(id, userId(req), async (ctx) => {
      if (ctx.t.status === 'running' && !lateRegOpen(ctx.t, ctx.now) && !body.override) {
        throw conflict("La late registration est terminée. L'ajout nécessite une dérogation explicite.");
      }
      if (await pseudoTaken(ctx.tx, id, body.pseudo)) {
        throw bad('Ce nom existe déjà dans le tournoi. Veuillez ajouter une initiale ou utiliser un pseudo différent.');
      }
      const res = await insertPlayers(ctx, [body]);
      return { ok: true, added: res.added };
    });
  });

  app.post('/tournaments/:id/players/import', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ rows: z.array(playerInputSchema).max(500) }), req.body);
    return mutateTournament(id, userId(req), async (ctx) => insertPlayers(ctx, body.rows));
  });

  app.patch('/tournaments/:id/players/:pid', async (req) => {
    const { id, pid } = parse(pParams, req.params);
    const body = parse(playerInputSchema.partial().extend({ seatLocked: z.boolean().optional() }), req.body);
    await mutateTournament(id, userId(req), async (ctx) => {
      await getPlayer(ctx.tx, id, pid);
      if (body.pseudo && (await pseudoTaken(ctx.tx, id, body.pseudo, pid))) throw bad('Ce pseudo est déjà inscrit dans le tournoi.');
      const set: Partial<PlayerRow> = {};
      if (body.pseudo !== undefined) set.pseudo = body.pseudo;
      if (body.firstName !== undefined) set.firstName = body.firstName || null;
      if (body.lastName !== undefined) set.lastName = body.lastName || null;
      if (body.seatLocked !== undefined) set.seatLocked = body.seatLocked;
      await ctx.tx.update(players).set(set).where(eq(players.id, pid));
    });
    return { ok: true };
  });

  app.delete('/tournaments/:id/players/:pid', async (req) => {
    const { id, pid } = parse(pParams, req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      await getPlayer(ctx.tx, id, pid);
      await ctx.tx.update(players).set({ eliminatedBy: null }).where(and(eq(players.tournamentId, id), eq(players.eliminatedBy, pid)));
      await ctx.tx.delete(playerActions).where(eq(playerActions.playerId, pid));
      await ctx.tx.delete(players).where(eq(players.id, pid));
      await rebalance(ctx);
    });
    return { ok: true };
  });

  app.post('/tournaments/:id/players/:pid/bust', async (req) => {
    const { id, pid } = parse(pParams, req.params);
    const body = parse(z.object({ eliminatedBy: z.string().uuid().nullish(), again: z.boolean().optional() }), req.body ?? {});
    return mutateTournament(id, userId(req), async (ctx) => {
      const { tx, t, now } = ctx;
      const victim = await getPlayer(tx, id, pid);
      if (victim.status !== 'active') throw bad('Ce joueur est déjà éliminé.');
      const all = await loadPlayers(tx, id);
      const activeBefore = all.filter((p) => p.status === 'active').length;
      const open = lateRegOpen(t, now);
      const fmt = t.settings.entryFormat;
      if (body.again) {
        if (fmt === 'freezeout') throw bad("Le re-entry n'est pas activé sur ce tournoi.");
        if (!open) throw bad('Re-entry interdit : la late registration est terminée.');
        if (fmt === 'reentry' && t.settings.reentryLimit >= 0 && victim.entries - 1 >= t.settings.reentryLimit) {
          throw bad('Ce joueur a atteint sa limite de re-entry.');
        }
      }
      if (!body.again && activeBefore <= 1) throw bad('Le dernier joueur en lice est le vainqueur.');

      // éliminateur & primes
      let killer: PlayerRow | undefined;
      if (body.eliminatedBy) {
        killer = all.find((p) => p.id === body.eliminatedBy);
        if (!killer || killer.status !== 'active' || killer.id === pid) throw bad('Éliminateur invalide.');
      }
      let won = 0;
      let added = 0;
      let envelope: { id: string; amount: number; group: string } | null = null;
      const bType = t.settings.bounty.type;
      const victimBounty = Number(victim.bountyValue);
      if (killer && bType === 'fixed') won = victimBounty;
      if (killer && bType === 'progressive') {
        won = victimBounty / 2;
        added = victimBounty / 2;
      }
      if (killer && bType === 'mystery') {
        const totalEntries = all.reduce((a, p) => a + p.entries, 0);
        if (!open) ensureMysteryFrozen(ctx, totalEntries);
        const m = ctx.patch.mystery ?? t.mystery;
        const drawFrom = t.settings.bounty.drawFrom;
        if (m.frozen && (drawFrom == null || activeBefore <= drawFrom)) {
          const e = drawEnvelope(m.envelopes);
          if (e) {
            envelope = { id: e.id, amount: e.amount, group: e.group };
            won = e.amount;
            ctx.patch.mystery = { ...m, envelopes: m.envelopes.map((x) => (x.id === e.id ? { ...x, drawn: true, drawnBy: killer!.id } : x)) };
          }
        }
      }
      if (killer) {
        await tx
          .update(players)
          .set({
            kills: killer.kills + 1,
            bountyWon: Number(killer.bountyWon) + won,
            bountyValue: Number(killer.bountyValue) + added,
          })
          .where(eq(players.id, killer.id));
      }

      const payload = {
        killerId: killer?.id ?? null,
        won,
        added,
        envelopeId: envelope?.id ?? null,
        again: body.again ? fmt : null,
        prevSeat: { table: victim.tableNumber, seat: victim.seatNumber },
        prevBounty: victimBounty,
      };
      let newSeat = null;
      if (body.again && fmt === 'reentry') {
        await tx
          .update(players)
          .set({ entries: victim.entries + 1, bountyValue: baseBounty(t.settings), tableNumber: null, seatNumber: null })
          .where(eq(players.id, pid));
        newSeat = await seatPlayer(ctx, pid);
      } else if (body.again && fmt === 'rebuys') {
        await tx.update(players).set({ rebuys: victim.rebuys + 1 }).where(eq(players.id, pid));
      } else {
        await tx
          .update(players)
          .set({ status: 'eliminated', eliminatedAt: new Date(now), eliminatedBy: killer?.id ?? null, tableNumber: null, seatNumber: null })
          .where(eq(players.id, pid));
      }
      await logAction(ctx, pid, 'bust', payload);
      const moves = await rebalance(ctx);
      return { ok: true, newSeat, envelope, moves };
    });
  });

  app.post('/tournaments/:id/players/:pid/undo-bust', async (req) => {
    const { id, pid } = parse(pParams, req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      const { tx, t } = ctx;
      const victim = await getPlayer(tx, id, pid);
      const [action] = await tx
        .select()
        .from(playerActions)
        .where(and(eq(playerActions.playerId, pid), eq(playerActions.type, 'bust'), isNull(playerActions.undoneAt)))
        .orderBy(desc(playerActions.createdAt))
        .limit(1);
      if (!action) throw bad('Aucune élimination à annuler.');
      const p = action.payload as { killerId: string | null; won: number; added: number; envelopeId: string | null; again: string | null; prevSeat: { table: number | null; seat: number | null }; prevBounty: number };
      if (p.killerId) {
        const [k] = await tx.select().from(players).where(eq(players.id, p.killerId));
        if (k) {
          await tx
            .update(players)
            .set({ kills: Math.max(0, k.kills - 1), bountyWon: Number(k.bountyWon) - p.won, bountyValue: Number(k.bountyValue) - p.added })
            .where(eq(players.id, k.id));
        }
      }
      if (p.envelopeId) {
        ctx.patch.mystery = { ...t.mystery, envelopes: t.mystery.envelopes.map((e) => (e.id === p.envelopeId ? { ...e, drawn: false, drawnBy: null } : e)) };
      }
      if (p.again === 'reentry') {
        await tx.update(players).set({ entries: Math.max(1, victim.entries - 1), bountyValue: p.prevBounty }).where(eq(players.id, pid));
      } else if (p.again === 'rebuys') {
        await tx.update(players).set({ rebuys: Math.max(0, victim.rebuys - 1) }).where(eq(players.id, pid));
      } else {
        if (victim.status !== 'eliminated') throw bad("Ce joueur n'est pas éliminé.");
        await tx.update(players).set({ status: 'active', eliminatedAt: null, eliminatedBy: null, finishRank: null }).where(eq(players.id, pid));
        // retrouve son siège s'il est libre
        const active = (await loadPlayers(tx, id)).filter((x) => x.status === 'active' && x.id !== pid);
        const tables = await loadTables(tx, id);
        const free =
          p.prevSeat.table != null &&
          tables.some((tb) => tb.number === p.prevSeat.table) &&
          !active.some((x) => x.tableNumber === p.prevSeat.table && x.seatNumber === p.prevSeat.seat);
        if (free) await tx.update(players).set({ tableNumber: p.prevSeat.table, seatNumber: p.prevSeat.seat }).where(eq(players.id, pid));
        else await seatPlayer(ctx, pid);
      }
      await tx.update(playerActions).set({ undoneAt: new Date() }).where(eq(playerActions.id, action.id));
    });
    return { ok: true };
  });

  app.post('/tournaments/:id/players/:pid/reentry', async (req) => {
    const { id, pid } = parse(pParams, req.params);
    return mutateTournament(id, userId(req), async (ctx) => {
      const { tx, t, now } = ctx;
      const p = await getPlayer(tx, id, pid);
      if (t.settings.entryFormat !== 'reentry') throw bad("Éliminé. Le re-entry n'est pas autorisé par le paramétrage.");
      if (!lateRegOpen(t, now)) throw bad('Re-entry interdit : la late registration est terminée.');
      if (p.status !== 'eliminated') throw bad("Ce joueur n'est pas éliminé.");
      if (t.settings.reentryLimit >= 0 && p.entries - 1 >= t.settings.reentryLimit) throw bad('Ce joueur a atteint sa limite de re-entry.');
      await tx
        .update(players)
        .set({ status: 'active', entries: p.entries + 1, eliminatedAt: null, eliminatedBy: null, finishRank: null, bountyValue: baseBounty(t.settings) })
        .where(eq(players.id, pid));
      await logAction(ctx, pid, 'reentry');
      const seat = await seatPlayer(ctx, pid);
      await rebalance(ctx);
      return { ok: true, newSeat: seat };
    });
  });

  app.post('/tournaments/:id/players/:pid/:op', async (req) => {
    const { id, pid, op } = parse(pParams.extend({ op: z.enum(['rebuy', 'addon', 'undo-rebuy', 'undo-addon', 'present']) }), req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      const { tx, t, now } = ctx;
      const p = await getPlayer(tx, id, pid);
      if (op === 'present') {
        await tx.update(players).set({ present: !p.present }).where(eq(players.id, pid));
        return;
      }
      if (op === 'rebuy') {
        if (t.settings.entryFormat !== 'rebuys') throw bad("Les recaves ne sont pas activées sur ce tournoi.");
        if (!lateRegOpen(t, now)) throw bad('Recave interdite : la late registration est terminée.');
        const set: Partial<PlayerRow> = { rebuys: p.rebuys + 1 };
        if (p.status === 'eliminated') Object.assign(set, { status: 'active', eliminatedAt: null, eliminatedBy: null });
        await tx.update(players).set(set).where(eq(players.id, pid));
        if (p.status === 'eliminated') {
          await seatPlayer(ctx, pid);
          await rebalance(ctx);
        }
        await logAction(ctx, pid, 'rebuy');
      } else if (op === 'addon') {
        if (!t.settings.addonsEnabled) throw bad("Les add-ons ne sont pas activés.");
        if (p.status !== 'active') throw bad('Ce joueur est éliminé.');
        if (p.addons >= 1) throw bad('Ce joueur a déjà pris un add-on.');
        await tx.update(players).set({ addons: p.addons + 1 }).where(eq(players.id, pid));
        await logAction(ctx, pid, 'addon');
      } else if (op === 'undo-rebuy') {
        if (p.rebuys <= 0) throw bad('Aucune recave à annuler.');
        await tx.update(players).set({ rebuys: p.rebuys - 1 }).where(eq(players.id, pid));
      } else if (op === 'undo-addon') {
        if (p.addons <= 0) throw bad('Aucun add-on à annuler.');
        await tx.update(players).set({ addons: p.addons - 1 }).where(eq(players.id, pid));
      }
    });
    return { ok: true };
  });

  app.post('/tournaments/:id/players/:pid/move', async (req) => {
    const { id, pid } = parse(pParams, req.params);
    const body = parse(z.object({ table: z.number().int().min(1), seat: z.number().int().min(1).max(10) }), req.body);
    await mutateTournament(id, userId(req), async (ctx) => {
      const { tx, t } = ctx;
      const p = await getPlayer(tx, id, pid);
      if (p.status !== 'active') throw bad('Ce joueur est éliminé.');
      if (body.seat > t.settings.maxPerTable) throw bad('Siège invalide pour ce format de table.');
      const tables = await loadTables(tx, id);
      if (!tables.some((tb) => tb.number === body.table)) await tx.insert(tournamentTables).values({ tournamentId: id, number: body.table });
      const [other] = await tx
        .select()
        .from(players)
        .where(and(eq(players.tournamentId, id), eq(players.status, 'active'), eq(players.tableNumber, body.table), eq(players.seatNumber, body.seat)));
      if (other && other.id !== pid) {
        await tx.update(players).set({ tableNumber: p.tableNumber, seatNumber: p.seatNumber }).where(eq(players.id, other.id));
        await logAction(ctx, pid, 'swap', { with: other.id });
      } else await logAction(ctx, pid, 'move', { from: { table: p.tableNumber, seat: p.seatNumber }, to: body });
      await tx.update(players).set({ tableNumber: body.table, seatNumber: body.seat }).where(eq(players.id, pid));
    });
    return { ok: true };
  });

  // ---- Placement & tables ----
  app.post('/tournaments/:id/seating/draw', async (req) => {
    const { id } = parse(idParam, req.params);
    return mutateTournament(id, userId(req), async (ctx) => {
      const { tx, t } = ctx;
      const all = await loadPlayers(tx, id);
      const active = all.filter((p) => p.status === 'active');
      if (active.length === 0) throw bad('Ajoutez au moins un joueur pour lancer le tirage des sièges.');
      const res = drawSeats(
        active.map((p) => ({ id: p.id, table: p.tableNumber, seat: p.seatNumber, locked: p.seatLocked })),
        t.settings.maxPerTable,
      );
      await tx.delete(tournamentTables).where(eq(tournamentTables.tournamentId, id));
      await tx.insert(tournamentTables).values(res.tableNumbers.map((n) => ({ tournamentId: id, number: n })));
      for (const p of active) {
        const s = res.seats[p.id];
        await tx.update(players).set({ tableNumber: s.table, seatNumber: s.seat }).where(eq(players.id, p.id));
      }
      const elimIds = all.filter((p) => p.status !== 'active').map((p) => p.id);
      if (elimIds.length) await tx.update(players).set({ tableNumber: null, seatNumber: null }).where(inArray(players.id, elimIds));
      ctx.patch.pendingMoves = [];
      return { ok: true, tables: res.tableNumbers.length };
    });
  });

  app.post('/tournaments/:id/seating/balance', async (req) => {
    const { id } = parse(idParam, req.params);
    return mutateTournament(id, userId(req), async (ctx) => {
      const moves = await rebalance(ctx, true);
      return { ok: true, moves };
    });
  });

  app.post('/tournaments/:id/tables', async (req) => {
    const { id } = parse(idParam, req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      const tables = await loadTables(ctx.tx, id);
      const used = new Set(tables.map((t) => t.number));
      let n = 1;
      while (used.has(n)) n++;
      await ctx.tx.insert(tournamentTables).values({ tournamentId: id, number: n });
    });
    return { ok: true };
  });

  app.patch('/tournaments/:id/tables/:n', async (req) => {
    const { id, n } = parse(idParam.extend({ n: z.coerce.number().int() }), req.params);
    const body = parse(z.object({ locked: z.boolean().optional(), isFinal: z.boolean().optional() }), req.body);
    await mutateTournament(id, userId(req), async (ctx) => {
      if (body.isFinal) await ctx.tx.update(tournamentTables).set({ isFinal: false }).where(eq(tournamentTables.tournamentId, id));
      const [row] = await ctx.tx
        .update(tournamentTables)
        .set(body)
        .where(and(eq(tournamentTables.tournamentId, id), eq(tournamentTables.number, n)))
        .returning();
      if (!row) throw notFound('Table introuvable.');
    });
    return { ok: true };
  });

  app.delete('/tournaments/:id/tables/:n', async (req) => {
    const { id, n } = parse(idParam.extend({ n: z.coerce.number().int() }), req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      const seated = (await loadPlayers(ctx.tx, id)).filter((p) => p.status === 'active' && p.tableNumber === n);
      if (seated.length > 0) throw bad('Impossible de supprimer une table occupée.');
      await ctx.tx.delete(tournamentTables).where(and(eq(tournamentTables.tournamentId, id), eq(tournamentTables.number, n)));
    });
    return { ok: true };
  });
}
