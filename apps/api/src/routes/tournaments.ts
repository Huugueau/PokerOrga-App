import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  applyClockAction,
  clampClockToStructure,
  ClockConflictError,
  clockInfo,
  computeStats,
  DEFAULT_MYSTERY,
  DEFAULT_SETTINGS,
  defaultStructure,
  drawEnvelope,
  envelopesTotal,
  generateEnvelopes,
  defaultEnvelopeCount,
  initialClock,
  resolveClock,
  settingsSchema,
  toCsv,
  tournamentPatchSchema,
  type ClockAction,
  type TournamentSettings,
} from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { bad, bus, conflict, HttpError, idParam, parse, publicToken, sendCsv, userId } from '../lib';
import {
  buildSnapshot,
  createTournament,
  ensureMysteryFrozen,
  getOwned,
  loadPlayers,
  mutateTournament,
  otherLiveTournaments,
  rankPlayers,
  toPlayer,
  toTournament,
  computedPayoutsFor,
} from '../services/tournament';

const { tournaments, players, tournamentTables, playerActions, users, favoriteConfigs } = schema;

function checkSettings(next: TournamentSettings, prev: TournamentSettings, started: boolean, rakeAllowed: boolean): TournamentSettings {
  const s: TournamentSettings = { ...next, bounty: { ...next.bounty } };
  if (started) {
    if (s.entryFormat !== prev.entryFormat) throw bad('Verrouillé : tournoi commencé. Le format ne peut plus être modifié.');
    if (s.bounty.type !== prev.bounty.type) throw bad('Le type de bounty ne peut plus être modifié une fois le tournoi commencé.');
  }
  if (s.multiSng) {
    s.entryFormat = 'freezeout';
    s.isFree = true;
    s.autoBalance = false;
    s.bounty = { ...s.bounty, type: 'none' };
  }
  if (started && s.multiSng !== prev.multiSng) throw bad('Type de tournoi verrouillé : tournoi commencé.');
  if (s.entryFormat === 'rebuys' && s.bounty.type !== 'none') s.bounty = { ...s.bounty, type: 'none' };
  if (s.entryFormat !== 'rebuys') s.addonsEnabled = false;
  if (s.bounty.type !== 'none' && s.bounty.amount > s.buyin) throw bad(`La prime ne peut pas dépasser le buy-in (${s.buyin} €).`);
  if (s.bounty.type === 'none') s.bounty.amount = s.bounty.amount || 0;
  if (!rakeAllowed) s.rake = 0;
  if (s.finalTableSize > Math.min(10, s.maxPerTable + 1)) s.finalTableSize = Math.min(10, s.maxPerTable + 1);
  return settingsSchema.parse(s);
}

export async function tournamentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/tournaments', async (req) => {
    const rows = await db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.ownerId, userId(req)), ne(tournaments.status, 'finished')))
      .orderBy(asc(tournaments.createdAt));
    const out = [];
    for (const r of rows) {
      const plist = await db.select().from(players).where(eq(players.tournamentId, r.id));
      const t = toTournament(r);
      const stats = computeStats(t.settings, plist.map(toPlayer));
      const rc = resolveClock(t.clock, t.structure, Date.now());
      out.push({ id: r.id, title: r.title, status: r.status, stats, levelIndex: rc.levelIndex, running: rc.running, clockGroupId: r.clockGroupId, createdAt: r.createdAt });
    }
    return { tournaments: out };
  });

  /** Retourne le live courant (le crée si aucun). */
  app.post('/tournaments/current', async (req) => {
    const uid = userId(req);
    const [row] = await db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.ownerId, uid), ne(tournaments.status, 'finished')))
      .orderBy(desc(tournaments.updatedAt))
      .limit(1);
    if (row) return { id: row.id };
    const created = await createTournament(uid);
    return { id: created.id };
  });

  app.post('/tournaments', async (req) => {
    const body = parse(z.object({ title: z.string().trim().max(80).optional(), fromConfigId: z.string().uuid().optional(), linkTo: z.string().uuid().optional() }).default({}), req.body ?? {});
    let settings: TournamentSettings | undefined;
    if (body.fromConfigId) {
      const [cfg] = await db
        .select()
        .from(favoriteConfigs)
        .where(and(eq(favoriteConfigs.id, body.fromConfigId), eq(favoriteConfigs.ownerId, userId(req))));
      if (cfg) settings = { ...DEFAULT_SETTINGS, ...cfg.settings };
    }
    if (body.linkTo) {
      const src = await getOwned(body.linkTo, userId(req));
      if (src.status === 'finished') throw bad('Action impossible sur ce tournoi.');
      if (src.settings.multiSng) throw bad('Terminez la session Multi Sit-and-Go avant de lier les horloges.');
      const groupId = src.clockGroupId ?? randomUUID();
      if (!src.clockGroupId) await db.update(tournaments).set({ clockGroupId: groupId }).where(eq(tournaments.id, src.id));
      const row = await createTournament(userId(req), { title: body.title || undefined, settings, structure: src.structure, clock: src.clock, clockGroupId: groupId });
      return { id: row.id };
    }
    const row = await createTournament(userId(req), { title: body.title || undefined, settings });
    return { id: row.id };
  });

  app.get('/tournaments/:id/full', async (req) => {
    const { id } = parse(idParam, req.params);
    const row = await getOwned(id, userId(req));
    return buildSnapshot(row);
  });

  app.patch('/tournaments/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(tournamentPatchSchema, req.body);
    const [u] = await db.select().from(users).where(eq(users.id, userId(req)));
    await mutateTournament(id, userId(req), async (ctx) => {
      const { t, patch, now } = ctx;
      if (body.title !== undefined) patch.title = body.title;
      if (body.settings) {
        const merged = { ...t.settings, ...body.settings, bounty: { ...t.settings.bounty, ...(body.settings.bounty ?? {}) } };
        patch.settings = checkSettings(merged, t.settings, t.status !== 'prepared', u.rakeEnabled);
        if (patch.settings.multiSng && ctx.row.clockGroupId) throw bad('Une horloge liée est active. Séparez ces tournois avant de lancer une session Multi Sit-and-Go.');
        if (patch.settings.bounty.type !== t.settings.bounty.type || patch.settings.bounty.amount !== t.settings.bounty.amount) {
          // prime de base pour tous les joueurs actifs (avant démarrage)
          if (t.status === 'prepared') {
            const base = ['fixed', 'progressive'].includes(patch.settings.bounty.type) ? patch.settings.bounty.amount : 0;
            await ctx.tx.update(players).set({ bountyValue: base }).where(eq(players.tournamentId, t.id));
          }
        }
      }
      if (body.structure) {
        patch.structure = body.structure;
        patch.clock = clampClockToStructure(t.clock, body.structure, now);
      }
      if (body.payouts) patch.payouts = body.payouts;
      if (body.theme) patch.theme = { ...t.theme, ...body.theme, sounds: { ...t.theme.sounds, ...(body.theme.sounds ?? {}) } };
    });
    return { ok: true };
  });

  app.post('/tournaments/:id/clock', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('play') }),
        z.object({ action: z.literal('pause') }),
        z.object({ action: z.literal('next'), expectedLevel: z.number().int().optional() }),
        z.object({ action: z.literal('prev'), expectedLevel: z.number().int().optional() }),
        z.object({ action: z.literal('seek'), remainingMs: z.number().min(0) }),
        z.object({ action: z.literal('goto'), levelIndex: z.number().int().min(0) }),
        z.object({ action: z.literal('reset') }),
      ]),
      req.body,
    ) as ClockAction;
    await mutateTournament(id, userId(req), async (ctx) => {
      const { t, now } = ctx;
      if (body.action === 'play' && t.status === 'prepared') {
        const plist = await loadPlayers(ctx.tx, t.id);
        if (plist.filter((p) => p.status === 'active').length < 2) throw bad('Ajoutez au moins 2 joueurs pour démarrer.');
        if (ctx.row.clockGroupId) {
          const others = await ctx.tx
            .select({ id: tournaments.id, status: tournaments.status })
            .from(tournaments)
            .where(and(eq(tournaments.clockGroupId, ctx.row.clockGroupId), ne(tournaments.id, t.id), ne(tournaments.status, 'finished')));
          for (const o of others.filter((x) => x.status === 'prepared')) {
            const op = await loadPlayers(ctx.tx, o.id);
            if (op.filter((p) => p.status === 'active').length < 2) throw bad('Chaque tournoi lié doit avoir au moins 2 joueurs pour démarrer.');
          }
        }
        ctx.patch.status = 'running';
        ctx.patch.startedAt = new Date(now);
      }
      try {
        ctx.patch.clock = applyClockAction(t.clock, t.structure, now, body);
      } catch (e) {
        if (e instanceof ClockConflictError) throw conflict(e.message);
        throw e;
      }
      const info = clockInfo(t.structure, resolveClock(ctx.patch.clock, t.structure, now));
      if (!info.lateRegOpen && t.settings.bounty.type === 'mystery') {
        const plist = await loadPlayers(ctx.tx, t.id);
        ensureMysteryFrozen(ctx, plist.reduce((a, p) => a + p.entries, 0));
      }
    });
    return { ok: true };
  });

  app.post('/tournaments/:id/reset', async (req) => {
    const { id } = parse(idParam, req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      await ctx.tx.delete(players).where(eq(players.tournamentId, id));
      await ctx.tx.delete(tournamentTables).where(eq(tournamentTables.tournamentId, id));
      await ctx.tx.delete(playerActions).where(eq(playerActions.tournamentId, id));
      const structure = defaultStructure();
      Object.assign(ctx.patch, {
        status: 'prepared',
        structure,
        clock: initialClock(structure),
        mystery: DEFAULT_MYSTERY,
        pendingMoves: [],
        publicToken: publicToken(),
        startedAt: null,
        clockGroupId: null,
        exportedChampionshipIds: [],
      });
    });
    return { ok: true };
  });

  /** Termine le live : fige le classement et l'archive dans l'historique. */
  app.post('/tournaments/:id/finish', async (req) => {
    const { id } = parse(idParam, req.params);
    const uid = userId(req);
    const row = await getOwned(id, uid);
    const snap = await buildSnapshot(row);
    await mutateTournament(id, uid, async (ctx) => {
      for (const p of snap.players) {
        await ctx.tx
          .update(players)
          .set({ finishRank: p.finishRank, prizeAmount: p.prizeAmount, prizeLabel: p.prizeLabel })
          .where(eq(players.id, p.id));
      }
      const r = resolveClock(ctx.t.clock, ctx.t.structure, ctx.now);
      Object.assign(ctx.patch, {
        status: 'finished',
        finishedAt: new Date(ctx.now),
        clock: { levelIndex: r.levelIndex, remainingMs: r.remainingMs, running: false, anchorAt: null },
        pendingMoves: [],
        publicToken: publicToken(),
        clockGroupId: null,
      });
    });
    const others = await otherLiveTournaments(uid, id);
    const next = others[0]?.id ?? (await createTournament(uid)).id;
    return { ok: true, nextId: next };
  });

  app.delete('/tournaments/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const uid = userId(req);
    await getOwned(id, uid);
    const plist = await db.select({ id: players.id }).from(players).where(eq(players.tournamentId, id));
    if (plist.length > 0) throw bad('Ce tournoi contient des joueurs. Terminez-le au lieu de le supprimer.');
    const others = await otherLiveTournaments(uid, id);
    if (others.length === 0) throw bad('Impossible : un compte garde toujours un tournoi actif.');
    await db.delete(tournaments).where(eq(tournaments.id, id));
    return { ok: true, nextId: others[0].id };
  });

  /** Sépare ce live de l'horloge partagée (il garde son état actuel). */
  app.post('/tournaments/:id/unlink', async (req) => {
    const { id } = parse(idParam, req.params);
    const uidv = userId(req);
    const row = await getOwned(id, uidv);
    if (!row.clockGroupId) throw bad("Ce tournoi n'a pas d'horloge liée.");
    await mutateTournament(id, uidv, async (ctx) => {
      ctx.patch.clockGroupId = null;
    });
    // s'il ne reste qu'un seul tournoi dans le groupe, il redevient indépendant
    const rest = await db.select({ id: tournaments.id }).from(tournaments).where(and(eq(tournaments.clockGroupId, row.clockGroupId), ne(tournaments.status, 'finished')));
    if (rest.length === 1) await mutateTournament(rest[0].id, uidv, async (ctx) => void (ctx.patch.clockGroupId = null));
    return { ok: true };
  });

  app.post('/tournaments/:id/public-token', async (req) => {
    const { id } = parse(idParam, req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      ctx.patch.publicToken = publicToken();
    });
    return { ok: true };
  });

  app.post('/tournaments/:id/seating/ack', async (req) => {
    const { id } = parse(idParam, req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      ctx.patch.pendingMoves = [];
    });
    return { ok: true };
  });

  app.get('/tournaments/:id/stream', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const row = await getOwned(id, userId(req));
    return sse(req, reply, `t:${row.id}`);
  });

  app.get('/tournaments/:id/export.csv', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const row = await getOwned(id, userId(req));
    const snap = await buildSnapshot(row);
    return sendCsv(reply, `${snap.tournament.title}.csv`, resultsCsv(snap.players));
  });

  // ---- Mystery ----
  app.post('/tournaments/:id/mystery/:action', async (req) => {
    const { id, action } = parse(idParam.extend({ action: z.enum(['freeze', 'unfreeze', 'regenerate']) }), req.params);
    await mutateTournament(id, userId(req), async (ctx) => {
      const { t } = ctx;
      if (t.settings.bounty.type !== 'mystery') throw bad("Le Mystery Bounty n'est pas activé.");
      const plist = await loadPlayers(ctx.tx, t.id);
      const entries = plist.reduce((a, p) => a + p.entries, 0);
      const pool = entries * t.settings.bounty.amount;
      if (action === 'freeze') {
        if (t.mystery.envelopes.length > 0 && t.mystery.custom && envelopesTotal(t.mystery.envelopes) !== Math.round(pool)) {
          throw bad(`Impossible de figer : la somme doit égaler le prizepool bounty (${Math.round(pool)}).`);
        }
        ensureMysteryFrozen(ctx, entries);
      } else if (action === 'unfreeze') {
        if (t.mystery.envelopes.some((e) => e.drawn)) throw bad('Impossible de défiger : une enveloppe a déjà été tirée.');
        ctx.patch.mystery = { ...t.mystery, frozen: false };
      } else {
        if (t.mystery.frozen) throw bad('Grille figée.');
        ctx.patch.mystery = { frozen: false, custom: false, envelopes: generateEnvelopes(pool, defaultEnvelopeCount(entries)) };
      }
    });
    return { ok: true };
  });

  app.patch('/tournaments/:id/mystery', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ envelopes: z.array(z.object({ id: z.string(), group: z.string().max(40), amount: z.number().min(0), drawn: z.boolean(), drawnBy: z.string().nullish() })).max(1000) }),
      req.body,
    );
    await mutateTournament(id, userId(req), async (ctx) => {
      if (ctx.t.mystery.frozen) throw bad('Grille figée : défigez-la pour la modifier.');
      ctx.patch.mystery = { frozen: false, custom: true, envelopes: body.envelopes.map((e) => ({ ...e, drawn: false, drawnBy: null })) };
    });
    return { ok: true };
  });
}

export function resultsCsv(list: ReturnType<typeof rankPlayers>): string {
  const byId = new Map(list.map((p) => [p.id, p.pseudo]));
  const sorted = list.slice().sort((a, b) => (a.finishRank ?? 9999) - (b.finishRank ?? 9999));
  return toCsv([
    ['place', 'pseudo', 'prenom', 'nom', 'entrees', 'recaves', 'addons', 'kills', 'elimine_par', 'gain', 'lot', 'bounties'],
    ...sorted.map((p) => [
      p.finishRank,
      p.pseudo,
      p.firstName,
      p.lastName,
      p.entries,
      p.rebuys,
      p.addons,
      p.kills,
      p.eliminatedBy ? byId.get(p.eliminatedBy) : '',
      p.prizeAmount,
      p.prizeLabel,
      p.bountyWon || '',
    ]),
  ]);
}

export function sse(req: FastifyRequest, reply: FastifyReply, channel: string) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\n\n`);
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'hello', serverTime: Date.now() });
  bus.on(channel, send);
  const hb = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25000);
  req.raw.on('close', () => {
    clearInterval(hb);
    bus.off(channel, send);
  });
}

