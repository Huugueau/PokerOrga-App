import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { championshipPoints, DEFAULT_SETTINGS, toCsv } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema, type Tx } from '../db';
import { bad, idParam, notFound, parse, publicToken, sendCsv, userId } from '../lib';
import { buildSnapshot, createTournament, mutateTournament, toPlayer } from '../services/tournament';
import { insertPlayers } from './players';

const { flightSeries, flightDays, flightQualifiers, tournaments, players, championships, championshipImports, championshipPlayers, championshipResults } = schema;
type Series = typeof flightSeries.$inferSelect;
type Day = typeof flightDays.$inferSelect;

async function getSeries(id: string, ownerId: string): Promise<Series> {
  const [s] = await db.select().from(flightSeries).where(and(eq(flightSeries.id, id), eq(flightSeries.ownerId, ownerId)));
  if (!s) throw notFound('Dossier introuvable.');
  return s;
}

async function getDay(series: Series, dayId: string): Promise<Day> {
  const [d] = await db.select().from(flightDays).where(and(eq(flightDays.id, dayId), eq(flightDays.seriesId, series.id)));
  if (!d) throw notFound('Jour introuvable.');
  return d;
}

interface RecapRow {
  pseudo: string;
  rank: number;
  bestStage: number;
  dayLabel: string;
  kills: number;
  entries: number;
  prize: number | null;
}

/** Classement global : finale, puis éliminés des étages précédents (du plus tardif au plus précoce). */
async function recap(series: Series) {
  const days = await db.select().from(flightDays).where(eq(flightDays.seriesId, series.id)).orderBy(asc(flightDays.stage), asc(flightDays.createdAt));
  const tIds = days.map((d) => d.tournamentId).filter(Boolean) as string[];
  const plist = tIds.length ? (await db.select().from(players).where(inArray(players.tournamentId, tIds))).map((p) => ({ ...toPlayer(p), tournamentId: p.tournamentId })) : [];
  const quals = await db.select().from(flightQualifiers).where(eq(flightQualifiers.seriesId, series.id));
  const qualifiedFrom = new Set(quals.map((q) => `${q.fromDayId}:${q.pseudo.toLowerCase()}`));
  const rows: RecapRow[] = [];
  const seen = new Set<string>();
  const stages = [...new Set(days.map((d) => d.stage))].sort((a, b) => b - a);
  const kills = new Map<string, number>();
  const entries = new Map<string, number>();
  for (const p of plist) {
    const k = p.pseudo.toLowerCase();
    kills.set(k, (kills.get(k) ?? 0) + p.kills);
    const d = days.find((x) => x.tournamentId === p.tournamentId);
    if (d?.stage === 1) entries.set(k, (entries.get(k) ?? 0) + p.entries);
  }
  for (const stage of stages) {
    const sDays = days.filter((d) => d.stage === stage && d.tournamentId);
    const candidates = plist
      .filter((p) => sDays.some((d) => d.tournamentId === p.tournamentId))
      .filter((p) => !qualifiedFrom.has(`${sDays.find((d) => d.tournamentId === p.tournamentId)!.id}:${p.pseudo.toLowerCase()}`))
      .filter((p) => !seen.has(p.pseudo.toLowerCase()));
    // survivants de la finale d'abord (rang), puis éliminés du plus tardif au plus précoce
    candidates.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      if (a.finishRank != null && b.finishRank != null && a.status === 'active') return a.finishRank - b.finishRank;
      return (b.eliminatedAt ?? '').localeCompare(a.eliminatedAt ?? '') || (a.finishRank ?? 0) - (b.finishRank ?? 0);
    });
    for (const p of candidates) {
      seen.add(p.pseudo.toLowerCase());
      rows.push({
        pseudo: p.pseudo,
        rank: rows.length + 1,
        bestStage: stage,
        dayLabel: sDays.find((d) => d.tournamentId === p.tournamentId)!.label,
        kills: kills.get(p.pseudo.toLowerCase()) ?? 0,
        entries: entries.get(p.pseudo.toLowerCase()) ?? 0,
        prize: p.prizeAmount,
      });
    }
  }
  const totalEntries = plist.filter((p) => days.find((d) => d.tournamentId === p.tournamentId)?.stage === 1).reduce((a, p) => a + p.entries, 0);
  return { rows, totalEntries };
}

async function launchDay(tx: Tx | typeof db, ownerId: string, series: Series, day: Day) {
  const t = await createTournament(ownerId, { title: `${series.name} — ${day.label}`, settings: { ...DEFAULT_SETTINGS, startStack: series.day1Stack } }, tx);
  await tx.update(flightDays).set({ tournamentId: t.id, status: 'running' }).where(eq(flightDays.id, day.id));
  return t.id;
}

export async function flightRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/flights', async (req) => {
    const rows = await db.select().from(flightSeries).where(eq(flightSeries.ownerId, userId(req))).orderBy(desc(flightSeries.createdAt));
    const days = rows.length ? await db.select().from(flightDays).where(inArray(flightDays.seriesId, rows.map((r) => r.id))) : [];
    return {
      items: rows.map((r) => {
        const d = days.filter((x) => x.seriesId === r.id);
        return { ...r, days: d.length, closedDays: d.filter((x) => x.status === 'closed').length };
      }),
    };
  });

  app.post('/flights', async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1, 'Nom du tournoi requis.').max(60),
        qualifyPct: z.number().int().min(1).max(100).default(15),
        day1Stack: z.number().int().min(100).max(100_000_000).default(20000),
      }),
      req.body,
    );
    const uidv = userId(req);
    const [open] = await db.select({ id: flightSeries.id }).from(flightSeries).where(and(eq(flightSeries.ownerId, uidv), eq(flightSeries.status, 'open')));
    if (open) throw bad('Un dossier est déjà en cours. Terminez-le avant d’en créer un autre.');
    return db.transaction(async (tx) => {
      const [s] = await tx.insert(flightSeries).values({ ownerId: uidv, ...body }).returning();
      const [day2] = await tx.insert(flightDays).values({ seriesId: s.id, label: 'Day 2', stage: 2 }).returning();
      await tx.insert(flightDays).values({ seriesId: s.id, label: 'Day 1A', stage: 1, targetDayId: day2.id });
      return s;
    });
  });

  app.get('/flights/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const s = await getSeries(id, userId(req));
    const days = await db.select().from(flightDays).where(eq(flightDays.seriesId, id)).orderBy(asc(flightDays.stage), asc(flightDays.createdAt));
    const quals = await db.select().from(flightQualifiers).where(eq(flightQualifiers.seriesId, id)).orderBy(desc(flightQualifiers.stack));
    const dayInfo = [];
    for (const d of days) {
      let stats = null;
      if (d.tournamentId) {
        const [row] = await db.select().from(tournaments).where(eq(tournaments.id, d.tournamentId));
        if (row) {
          const snap = await buildSnapshot(row);
          stats = { entries: snap.stats.totalEntries, active: snap.stats.activePlayers, status: row.status, chips: snap.stats.chipsInPlay };
        }
      }
      dayInfo.push({ ...d, stats, qualifiers: quals.filter((q) => q.fromDayId === d.id), incoming: quals.filter((q) => q.toDayId === d.id).length });
    }
    return { series: s, days: dayInfo, recap: await recap(s) };
  });

  app.post('/flights/:id/days', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ label: z.string().trim().min(1).max(30), stage: z.number().int().min(1).max(10), targetDayId: z.string().uuid().nullable().default(null) }), req.body);
    const s = await getSeries(id, userId(req));
    if (s.status === 'closed') throw bad('Ce dossier est clôturé.');
    const count = await db.select({ id: flightDays.id }).from(flightDays).where(eq(flightDays.seriesId, id));
    if (count.length >= 12) throw bad('Un dossier accepte 12 jours au maximum.');
    if (body.targetDayId) {
      const target = await getDay(s, body.targetDayId);
      if (target.stage <= body.stage) throw bad('La destination doit être un jour d’un étage supérieur.');
    }
    const [d] = await db.insert(flightDays).values({ seriesId: id, ...body }).returning();
    return d;
  });

  app.patch('/flights/:id/days/:dayId', async (req) => {
    const { id, dayId } = parse(idParam.extend({ dayId: z.string().uuid() }), req.params);
    const body = parse(z.object({ label: z.string().trim().min(1).max(30).optional(), targetDayId: z.string().uuid().nullable().optional() }), req.body);
    const s = await getSeries(id, userId(req));
    const d = await getDay(s, dayId);
    if (d.status === 'closed') throw bad('Ce jour est déjà clôturé.');
    if (body.targetDayId) {
      const target = await getDay(s, body.targetDayId);
      if (target.stage <= d.stage) throw bad('La destination doit être un jour d’un étage supérieur.');
    }
    const [row] = await db.update(flightDays).set(body).where(eq(flightDays.id, dayId)).returning();
    return row;
  });

  app.delete('/flights/:id/days/:dayId', async (req) => {
    const { id, dayId } = parse(idParam.extend({ dayId: z.string().uuid() }), req.params);
    const s = await getSeries(id, userId(req));
    const d = await getDay(s, dayId);
    if (d.status !== 'pending') throw bad('Seul un jour jamais lancé peut être supprimé.');
    await db.update(flightDays).set({ targetDayId: null }).where(eq(flightDays.targetDayId, dayId));
    await db.delete(flightDays).where(eq(flightDays.id, dayId));
    return { ok: true };
  });

  /** Lance un jour : crée son live ; pour un jour 2+, importe les qualifiés avec leurs tapis. */
  app.post('/flights/:id/days/:dayId/launch', async (req) => {
    const { id, dayId } = parse(idParam.extend({ dayId: z.string().uuid() }), req.params);
    const uidv = userId(req);
    const s = await getSeries(id, uidv);
    const d = await getDay(s, dayId);
    if (d.status !== 'pending') throw bad('Ce jour a déjà son tournoi.');
    const feeders = await db.select().from(flightDays).where(eq(flightDays.targetDayId, dayId));
    if (feeders.some((f) => f.status !== 'closed')) throw bad('Tous les jours qui alimentent celui-ci doivent être clôturés avant de le lancer.');
    const tid = await launchDay(db, uidv, s, d);
    if (d.stage > 1) {
      const quals = await db.select().from(flightQualifiers).where(eq(flightQualifiers.toDayId, dayId));
      if (quals.length > 0) {
        await mutateTournament(tid, uidv, (ctx) =>
          insertPlayers(
            ctx,
            quals.map((q) => ({ pseudo: q.pseudo, firstName: q.firstName, lastName: q.lastName, memberId: q.memberId, startChips: q.stack, present: true })),
          ),
        );
      }
    }
    return { ok: true, tournamentId: tid };
  });

  /** Clôture un jour : tapis « bagués » des joueurs encore en jeu → qualifiés pour le jour suivant. */
  app.post('/flights/:id/days/:dayId/close', async (req) => {
    const { id, dayId } = parse(idParam.extend({ dayId: z.string().uuid() }), req.params);
    const body = parse(z.object({ stacks: z.record(z.string(), z.number().int().min(1)).default({}) }), req.body ?? {});
    const uidv = userId(req);
    const s = await getSeries(id, uidv);
    const d = await getDay(s, dayId);
    if (d.status === 'pending') throw bad("Ce jour n'a pas encore été lancé.");
    if (d.status === 'closed') throw bad('Ce jour est déjà clôturé.');
    const [row] = await db.select().from(tournaments).where(eq(tournaments.id, d.tournamentId!));
    const snap = row ? await buildSnapshot(row) : null;
    const active = snap?.players.filter((p) => p.status === 'active') ?? [];
    if (d.targetDayId) {
      if (active.length === 0) throw bad('Aucun joueur en jeu : ce jour ne peut pas qualifier.');
      const missing = active.filter((p) => !body.stacks[p.id]);
      if (missing.length) throw bad(`Chaque joueur encore en jeu doit avoir un tapis saisi (${missing.map((p) => p.pseudo).join(', ')}).`);
    }
    await db.transaction(async (tx) => {
      if (d.targetDayId) {
        await tx.insert(flightQualifiers).values(
          active.map((p) => ({ seriesId: s.id, fromDayId: d.id, toDayId: d.targetDayId!, pseudo: p.pseudo, firstName: p.firstName, lastName: p.lastName, memberId: p.memberId, stack: body.stacks[p.id] })),
        );
      }
      if (row && row.status !== 'finished' && snap) {
        for (const p of snap.players) await tx.update(players).set({ finishRank: p.finishRank, prizeAmount: p.prizeAmount, prizeLabel: p.prizeLabel }).where(eq(players.id, p.id));
        await tx
          .update(tournaments)
          .set({ status: 'finished', finishedAt: new Date(), clock: { ...row.clock, running: false, anchorAt: null }, publicToken: publicToken(), clockGroupId: null, version: row.version + 1 })
          .where(eq(tournaments.id, row.id));
      }
      await tx.update(flightDays).set({ status: 'closed', closedAt: new Date() }).where(eq(flightDays.id, d.id));
    });
    return { ok: true, qualified: d.targetDayId ? active.length : 0 };
  });

  app.post('/flights/:id/close', async (req) => {
    const { id } = parse(idParam, req.params);
    const s = await getSeries(id, userId(req));
    const days = await db.select().from(flightDays).where(eq(flightDays.seriesId, id));
    if (days.length === 0) throw bad('Impossible de clôturer : ce dossier n’a aucun jour.');
    if (days.some((d) => d.status !== 'closed')) throw bad('Impossible de clôturer : tous les jours doivent d’abord être clôturés (supprimez les jours jamais lancés).');
    await db.update(flightSeries).set({ status: 'closed' }).where(eq(flightSeries.id, s.id));
    return { ok: true };
  });

  app.delete('/flights/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const s = await getSeries(id, userId(req));
    const days = await db.select().from(flightDays).where(eq(flightDays.seriesId, id));
    if (days.some((d) => d.status === 'running')) throw bad('Ce dossier a des jours en cours : clôturez-les avant de le supprimer.');
    await db.delete(flightSeries).where(eq(flightSeries.id, s.id));
    return { ok: true };
  });

  app.get('/flights/:id/recap.csv', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const s = await getSeries(id, userId(req));
    const r = await recap(s);
    return sendCsv(reply, `${s.name}.csv`, toCsv([['place', 'pseudo', 'meilleur_jour', 'entrees_day1', 'kills', 'gain'], ...r.rows.map((x) => [x.rank, x.pseudo, x.dayLabel, x.entries, x.kills, x.prize])]));
  });

  app.post('/flights/:id/export', async (req) => {
    const { id } = parse(idParam, req.params);
    const { championshipId } = parse(z.object({ championshipId: z.string().uuid() }), req.body);
    const uidv = userId(req);
    const s = await getSeries(id, uidv);
    if (s.status !== 'closed') throw bad('Clôturez le dossier (tous les jours) avant de l’exporter.');
    const [c] = await db.select().from(championships).where(and(eq(championships.id, championshipId), eq(championships.ownerId, uidv)));
    if (!c) throw notFound('Championnat introuvable.');
    const [dup] = await db
      .select({ id: championshipImports.id })
      .from(championshipImports)
      .where(and(eq(championshipImports.championshipId, c.id), eq(championshipImports.tournamentId, s.id)));
    if (dup) throw bad('Ce dossier a déjà été exporté vers ce championnat.');
    const r = await recap(s);
    if (r.rows.length < 2) throw bad('Aucun joueur à exporter pour ce dossier.');
    const entries = Math.max(r.totalEntries, r.rows.length);
    await db.transaction(async (tx) => {
      const [imp] = await tx.insert(championshipImports).values({ championshipId: c.id, tournamentId: s.id, tournamentName: s.name, entries, playedAt: s.createdAt }).returning();
      for (const row of r.rows) {
        const [existing] = await tx.select({ id: championshipPlayers.id }).from(championshipPlayers).where(and(eq(championshipPlayers.championshipId, c.id), eq(championshipPlayers.name, row.pseudo)));
        const pid = existing?.id ?? (await tx.insert(championshipPlayers).values({ championshipId: c.id, name: row.pseudo }).returning({ id: championshipPlayers.id }))[0].id;
        await tx.insert(championshipResults).values({
          importId: imp.id,
          playerId: pid,
          rank: row.rank,
          points: c.pointsGrid.length > 0 ? (c.pointsGrid[row.rank - 1] ?? 0) : championshipPoints(entries, row.rank),
          kills: row.kills,
        });
      }
    });
    return { ok: true };
  });
}
