import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { championshipPoints, computeRanking, type RankingRow } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema, type Tx } from '../db';
import { bad, idParam, notFound, parse, publicToken, userId } from '../lib';
import { buildSnapshot } from '../services/tournament';

const { championships, championshipPlayers, championshipImports, championshipResults, championshipBonuses, tournaments } = schema;
type ChampRow = typeof championships.$inferSelect;

async function getChamp(id: string, ownerId: string): Promise<ChampRow> {
  const [c] = await db.select().from(championships).where(and(eq(championships.id, id), eq(championships.ownerId, ownerId)));
  if (!c) throw notFound('Championnat introuvable.');
  return c;
}

/** Vue complète d'un championnat : classement (avec évolution), imports, bonus. */
export async function championshipView(c: ChampRow) {
  const [plist, imports, results, bonuses] = await Promise.all([
    db.select().from(championshipPlayers).where(eq(championshipPlayers.championshipId, c.id)),
    db.select().from(championshipImports).where(eq(championshipImports.championshipId, c.id)).orderBy(desc(championshipImports.importedAt)),
    db
      .select({ r: championshipResults })
      .from(championshipResults)
      .innerJoin(championshipImports, eq(championshipResults.importId, championshipImports.id))
      .where(eq(championshipImports.championshipId, c.id)),
    db.select().from(championshipBonuses).where(eq(championshipBonuses.championshipId, c.id)).orderBy(desc(championshipBonuses.createdAt)),
  ]);
  const cancelled = new Set(imports.filter((i) => i.cancelledAt).map((i) => i.id));
  const build = (excludeImport?: string) =>
    computeRanking(
      plist.map((p) => ({
        id: p.id,
        name: p.name,
        results: results
          .filter((x) => x.r.playerId === p.id && x.r.importId !== excludeImport)
          .map((x) => ({ importId: x.r.importId, points: x.r.points, kills: x.r.kills, cancelled: cancelled.has(x.r.importId) })),
        bonuses: bonuses.filter((b) => b.playerId === p.id).map((b) => ({ points: b.points, cancelled: !!b.cancelledAt })),
      })),
      c.bestResults,
    );
  const ranking = build();
  const lastImport = imports.find((i) => !i.cancelledAt);
  let previous: Map<string, number> | null = null;
  if (lastImport && imports.filter((i) => !i.cancelledAt).length > 1) {
    previous = new Map(build(lastImport.id).map((r) => [r.id, r.position]));
  }
  const rows = ranking.map((r: RankingRow) => ({
    ...r,
    delta: previous ? (previous.has(r.id) ? previous.get(r.id)! - r.position : null) : null,
  }));
  const details = Object.fromEntries(
    plist.map((p) => [
      p.id,
      {
        results: results
          .filter((x) => x.r.playerId === p.id)
          .map((x) => {
            const imp = imports.find((i) => i.id === x.r.importId)!;
            return {
              importId: imp.id,
              tournamentName: imp.tournamentName,
              playedAt: imp.playedAt ?? imp.importedAt,
              entries: imp.entries,
              rank: x.r.rank,
              points: x.r.points,
              kills: x.r.kills,
              cancelled: !!imp.cancelledAt,
              retained: ranking.find((r) => r.id === p.id)?.retainedImportIds.includes(imp.id) ?? false,
            };
          })
          .sort((a, b) => +new Date(b.playedAt) - +new Date(a.playedAt)),
        bonuses: bonuses.filter((b) => b.playerId === p.id),
      },
    ]),
  );
  return {
    championship: c,
    ranking: rows,
    players: plist.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    imports: imports.map((i) => ({ ...i, players: results.filter((x) => x.r.importId === i.id).length })),
    bonuses: bonuses.map((b) => ({ ...b, playerName: plist.find((p) => p.id === b.playerId)?.name ?? '?' })),
    details,
  };
}

async function upsertChampPlayer(tx: Tx, championshipId: string, name: string): Promise<string> {
  const [existing] = await tx
    .select({ id: championshipPlayers.id })
    .from(championshipPlayers)
    .where(and(eq(championshipPlayers.championshipId, championshipId), sql`lower(${championshipPlayers.name}) = lower(${name})`));
  if (existing) return existing.id;
  const [row] = await tx.insert(championshipPlayers).values({ championshipId, name }).returning({ id: championshipPlayers.id });
  return row.id;
}

export async function championshipRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/championships', async (req) => {
    const rows = await db.select().from(championships).where(eq(championships.ownerId, userId(req))).orderBy(desc(championships.createdAt));
    const counts = rows.length
      ? await db
          .select({ id: championshipImports.championshipId, n: sql<number>`count(*)::int` })
          .from(championshipImports)
          .where(and(inArray(championshipImports.championshipId, rows.map((r) => r.id)), isNull(championshipImports.cancelledAt)))
          .groupBy(championshipImports.championshipId)
      : [];
    return { items: rows.map((r) => ({ ...r, imports: counts.find((c) => c.id === r.id)?.n ?? 0 })) };
  });

  app.post('/championships', async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1, 'Le nom du championnat est requis.').max(30, '30 caractères maximum.'),
        type: z.enum(['mtt', 'sng']).default('mtt'),
        bestResults: z.number().int().min(1).max(200).nullable().default(8),
        pointsGrid: z.array(z.number().min(0).max(10000)).max(100).default([]),
      }),
      req.body,
    );
    const [row] = await db.insert(championships).values({ ownerId: userId(req), ...body, publicToken: publicToken() }).returning();
    return row;
  });

  app.get('/championships/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return championshipView(await getChamp(id, userId(req)));
  });

  app.patch('/championships/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        name: z.string().trim().min(1, 'Le nom du championnat est requis.').max(30, '30 caractères maximum.').optional(),
        bestResults: z.number().int().min(1).max(200).nullable().optional(),
        pointsGrid: z.array(z.number().min(0).max(10000)).max(100).optional(),
        archived: z.boolean().optional(),
        published: z.boolean().optional(),
      }),
      req.body,
    );
    await getChamp(id, userId(req));
    const [row] = await db.update(championships).set(body).where(eq(championships.id, id)).returning();
    return row;
  });

  app.delete('/championships/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await getChamp(id, userId(req));
    await db.delete(championships).where(eq(championships.id, id));
    await removeExportedId(id);
    return { ok: true };
  });

  app.post('/championships/:id/import', async (req) => {
    const { id } = parse(idParam, req.params);
    const { tournamentId } = parse(z.object({ tournamentId: z.string().uuid() }), req.body);
    const uid = userId(req);
    const c = await getChamp(id, uid);
    if (c.archived) throw bad('Championnat archivé — réactivez-le pour y envoyer des tournois.');
    const [trow] = await db.select().from(tournaments).where(and(eq(tournaments.id, tournamentId), eq(tournaments.ownerId, uid)));
    if (!trow) throw notFound('Tournoi introuvable.');
    const [dup] = await db
      .select({ id: championshipImports.id })
      .from(championshipImports)
      .where(and(eq(championshipImports.championshipId, id), eq(championshipImports.tournamentId, tournamentId), isNull(championshipImports.cancelledAt)));
    if (dup) throw bad('Ce tournoi a déjà été exporté vers ce championnat.');
    const snap = await buildSnapshot(trow);
    if (snap.players.length < 2 || snap.players.some((p) => p.finishRank == null)) {
      if (snap.tournament.settings.multiSng) throw bad("Tous les SnG doivent être terminés avant l'export.");
      throw bad("Le tournoi n'est pas terminé. Éliminez tous les joueurs avant d'exporter.");
    }
    if (snap.tournament.settings.multiSng) {
      const groups = [...new Set(snap.players.map((p) => p.sngGroup ?? 0))].sort((a, b) => a - b);
      await db.transaction(async (tx) => {
        for (const g of groups) {
          const gp = snap.players.filter((p) => (p.sngGroup ?? 0) === g);
          const [imp] = await tx
            .insert(championshipImports)
            .values({ championshipId: id, tournamentId, tournamentName: `${trow.title} · SnG ${g}`, entries: gp.length, playedAt: trow.startedAt ?? trow.createdAt })
            .returning();
          for (const p of gp) {
            const cpId = await upsertChampPlayer(tx, id, p.pseudo);
            await tx.insert(championshipResults).values({
              importId: imp.id,
              playerId: cpId,
              rank: p.finishRank!,
              points: c.pointsGrid.length > 0 ? (c.pointsGrid[p.finishRank! - 1] ?? 0) : championshipPoints(gp.length, p.finishRank!),
              kills: p.kills,
            });
          }
        }
        const ids = new Set([...(trow.exportedChampionshipIds ?? []), id]);
        await tx.update(tournaments).set({ exportedChampionshipIds: [...ids] }).where(eq(tournaments.id, tournamentId));
      });
      return { ok: true };
    }
    const entries = snap.stats.totalEntries;
    await db.transaction(async (tx) => {
      const [imp] = await tx
        .insert(championshipImports)
        .values({ championshipId: id, tournamentId, tournamentName: trow.title, entries, playedAt: trow.startedAt ?? trow.createdAt })
        .returning();
      for (const p of snap.players) {
        const cpId = await upsertChampPlayer(tx, id, p.pseudo);
        await tx.insert(championshipResults).values({
          importId: imp.id,
          playerId: cpId,
          rank: p.finishRank!,
          points: c.pointsGrid.length > 0 ? (c.pointsGrid[p.finishRank! - 1] ?? 0) : championshipPoints(entries, p.finishRank!),
          kills: p.kills,
        });
      }
      const ids = new Set([...(trow.exportedChampionshipIds ?? []), id]);
      await tx.update(tournaments).set({ exportedChampionshipIds: [...ids] }).where(eq(tournaments.id, tournamentId));
    });
    return { ok: true };
  });

  app.delete('/championships/:id/imports/:importId', async (req) => {
    const { id, importId } = parse(idParam.extend({ importId: z.string().uuid() }), req.params);
    await getChamp(id, userId(req));
    const [imp] = await db
      .update(championshipImports)
      .set({ cancelledAt: new Date() })
      .where(and(eq(championshipImports.id, importId), eq(championshipImports.championshipId, id)))
      .returning();
    if (!imp) throw notFound();
    if (imp.tournamentId) {
      const [t] = await db.select().from(tournaments).where(eq(tournaments.id, imp.tournamentId));
      if (t) await db.update(tournaments).set({ exportedChampionshipIds: (t.exportedChampionshipIds ?? []).filter((x) => x !== id) }).where(eq(tournaments.id, t.id));
    }
    return { ok: true };
  });

  app.post('/championships/:id/bonuses', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ playerId: z.string().uuid(), points: z.number().positive().max(10000), justification: z.string().trim().min(3, 'Justification : 3 caractères minimum.').max(200) }),
      req.body,
    );
    await getChamp(id, userId(req));
    const [p] = await db.select().from(championshipPlayers).where(and(eq(championshipPlayers.id, body.playerId), eq(championshipPlayers.championshipId, id)));
    if (!p) throw notFound('Joueur introuvable.');
    await db.insert(championshipBonuses).values({ championshipId: id, ...body });
    return { ok: true };
  });

  app.delete('/championships/:id/bonuses/:bid', async (req) => {
    const { id, bid } = parse(idParam.extend({ bid: z.string().uuid() }), req.params);
    await getChamp(id, userId(req));
    await db
      .update(championshipBonuses)
      .set({ cancelledAt: new Date() })
      .where(and(eq(championshipBonuses.id, bid), eq(championshipBonuses.championshipId, id)));
    return { ok: true };
  });

  app.post('/championships/:id/merge', async (req) => {
    const { id } = parse(idParam, req.params);
    const { keepId, mergeId } = parse(z.object({ keepId: z.string().uuid(), mergeId: z.string().uuid() }), req.body);
    if (keepId === mergeId) throw bad('Choisissez deux joueurs différents.');
    await getChamp(id, userId(req));
    await db.transaction(async (tx) => {
      const both = await tx
        .select()
        .from(championshipPlayers)
        .where(and(eq(championshipPlayers.championshipId, id), inArray(championshipPlayers.id, [keepId, mergeId])));
      if (both.length !== 2) throw notFound('Joueur introuvable.');
      await tx.update(championshipResults).set({ playerId: keepId }).where(eq(championshipResults.playerId, mergeId));
      await tx.update(championshipBonuses).set({ playerId: keepId }).where(eq(championshipBonuses.playerId, mergeId));
      await tx.delete(championshipPlayers).where(eq(championshipPlayers.id, mergeId));
    });
    return { ok: true };
  });

  app.post('/championships/:id/reset-scores', async (req) => {
    const { id } = parse(idParam, req.params);
    await getChamp(id, userId(req));
    await db.delete(championshipImports).where(eq(championshipImports.championshipId, id));
    await db.delete(championshipBonuses).where(eq(championshipBonuses.championshipId, id));
    await db.delete(championshipPlayers).where(eq(championshipPlayers.championshipId, id));
    await removeExportedId(id);
    return { ok: true };
  });

  app.post('/championships/:id/public-token', async (req) => {
    const { id } = parse(idParam, req.params);
    await getChamp(id, userId(req));
    await db.update(championships).set({ publicToken: publicToken() }).where(eq(championships.id, id));
    return { ok: true };
  });
}

async function removeExportedId(champId: string) {
  const rows = await db
    .select({ id: tournaments.id, ids: tournaments.exportedChampionshipIds })
    .from(tournaments)
    .where(sql`${tournaments.exportedChampionshipIds} @> ${JSON.stringify([champId])}::jsonb`);
  for (const r of rows) {
    await db.update(tournaments).set({ exportedChampionshipIds: r.ids.filter((x) => x !== champId) }).where(eq(tournaments.id, r.id));
  }
}

