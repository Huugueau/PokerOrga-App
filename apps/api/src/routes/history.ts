import { and, desc, eq, ilike } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeStats } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { idParam, notFound, parse, sendCsv, userId } from '../lib';
import { buildSnapshot, toPlayer, toTournament } from '../services/tournament';
import { resultsCsv } from './tournaments';

const { tournaments, players } = schema;

export async function historyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/history', async (req) => {
    const { q } = parse(z.object({ q: z.string().max(80).optional() }), req.query);
    const conds = [eq(tournaments.ownerId, userId(req)), eq(tournaments.status, 'finished')];
    if (q) conds.push(ilike(tournaments.title, `%${q}%`));
    const rows = await db.select().from(tournaments).where(and(...conds)).orderBy(desc(tournaments.finishedAt));
    const items = [];
    for (const r of rows) {
      const plist = (await db.select().from(players).where(eq(players.tournamentId, r.id))).map(toPlayer);
      const t = toTournament(r);
      const stats = computeStats(t.settings, plist);
      const winner = plist.find((p) => p.finishRank === 1);
      items.push({
        id: r.id,
        title: r.title,
        finishedAt: r.finishedAt,
        startedAt: r.startedAt,
        entries: stats.totalEntries,
        players: plist.length,
        prizePool: stats.prizePool,
        winner: winner?.pseudo ?? null,
        exportedChampionshipIds: t.exportedChampionshipIds,
      });
    }
    return { items };
  });

  app.get('/history/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.id, id), eq(tournaments.ownerId, userId(req)), eq(tournaments.status, 'finished')));
    if (!row) throw notFound('Cette fiche n’est pas dans l’historique.');
    return buildSnapshot(row);
  });

  app.get('/history/:id/export.csv', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [row] = await db.select().from(tournaments).where(and(eq(tournaments.id, id), eq(tournaments.ownerId, userId(req))));
    if (!row) throw notFound();
    const snap = await buildSnapshot(row);
    return sendCsv(reply, `${row.title}.csv`, resultsCsv(snap.players));
  });

  app.delete('/history/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const res = await db
      .delete(tournaments)
      .where(and(eq(tournaments.id, id), eq(tournaments.ownerId, userId(req)), eq(tournaments.status, 'finished')))
      .returning({ id: tournaments.id });
    if (res.length === 0) throw notFound('Impossible de supprimer cette fiche.');
    return { ok: true };
  });
}
