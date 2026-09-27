import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db';
import { parse, userId } from '../lib';
import { currentPlayer } from './playerAccount';

const { clubs, clubMembers, players, tournaments, playerAccounts, events, registrations, users } = schema;

export type Suggestion = {
  key: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  memberId: string | null;
  playerAccountId: string | null;
  sources: ('member' | 'past' | 'account')[];
  tournaments: number;
};

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/**
 * Suggestions de joueurs pour un organisateur : ses adhérents, les joueurs de ses tournois passés
 * et les comptes joueurs « trouvables » (pseudo + prénom + initiale du nom, jamais l'email).
 */
export async function searchPlayers(ownerId: string, q: string): Promise<Suggestion[]> {
  const term = q.trim();
  const pat = like(term);
  const [club] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.ownerId, ownerId));

  const members = club
    ? await db
        .select()
        .from(clubMembers)
        .where(
          and(
            eq(clubMembers.clubId, club.id),
            term ? or(ilike(clubMembers.pseudo, pat), ilike(clubMembers.firstName, pat), ilike(clubMembers.lastName, pat)) : undefined,
          ),
        )
        .orderBy(asc(clubMembers.pseudo))
        .limit(15)
    : [];

  const past = await db
    .select({
      pseudo: sql<string>`min(${players.pseudo})`,
      firstName: sql<string | null>`(array_agg(${players.firstName}) filter (where ${players.firstName} is not null))[1]`,
      lastName: sql<string | null>`(array_agg(${players.lastName}) filter (where ${players.lastName} is not null))[1]`,
      memberId: sql<string | null>`(array_agg(${players.memberId}::text) filter (where ${players.memberId} is not null))[1]`,
      playerAccountId: sql<string | null>`(array_agg(${players.playerAccountId}::text) filter (where ${players.playerAccountId} is not null))[1]`,
      n: sql<number>`count(distinct ${players.tournamentId})::int`,
    })
    .from(players)
    .innerJoin(tournaments, eq(tournaments.id, players.tournamentId))
    .where(and(eq(tournaments.ownerId, ownerId), term ? ilike(players.pseudo, pat) : undefined))
    .groupBy(sql`lower(${players.pseudo})`)
    .orderBy(desc(sql`count(distinct ${players.tournamentId})`))
    .limit(15);

  const accounts =
    term.length >= 2
      ? await db
          .select({ id: playerAccounts.id, pseudo: playerAccounts.pseudo, firstName: playerAccounts.firstName, lastName: playerAccounts.lastName })
          .from(playerAccounts)
          .where(and(eq(playerAccounts.discoverable, true), or(ilike(playerAccounts.pseudo, pat), ilike(playerAccounts.firstName, pat))))
          .orderBy(asc(playerAccounts.pseudo))
          .limit(10)
      : [];

  const out: Suggestion[] = members.map((m) => ({
    key: 'm:' + m.id,
    pseudo: m.pseudo,
    firstName: m.firstName,
    lastName: m.lastName,
    memberId: m.id,
    playerAccountId: m.playerAccountId,
    sources: ['member'],
    tournaments: 0,
  }));
  const byPseudo = (p: string) => out.find((s) => s.pseudo.toLowerCase() === p.toLowerCase());
  for (const p of past) {
    const hit =
      (p.memberId && out.find((s) => s.memberId === p.memberId)) ||
      (p.playerAccountId && out.find((s) => s.playerAccountId === p.playerAccountId)) ||
      byPseudo(p.pseudo);
    if (hit) {
      hit.sources.push('past');
      hit.tournaments = p.n;
      hit.playerAccountId ??= p.playerAccountId;
      continue;
    }
    out.push({ key: 'p:' + p.pseudo.toLowerCase(), pseudo: p.pseudo, firstName: p.firstName, lastName: p.lastName, memberId: p.memberId, playerAccountId: p.playerAccountId, sources: ['past'], tournaments: p.n });
  }
  for (const a of accounts) {
    const hit = out.find((s) => s.playerAccountId === a.id);
    if (hit) {
      if (!hit.sources.includes('account')) hit.sources.push('account');
      continue;
    }
    out.push({
      key: 'a:' + a.id,
      pseudo: a.pseudo,
      firstName: a.firstName,
      lastName: a.lastName ? a.lastName.charAt(0).toUpperCase() + '.' : null,
      memberId: null,
      playerAccountId: a.id,
      sources: ['account'],
      tournaments: 0,
    });
  }
  return out.slice(0, 25);
}

/** Ne garde que des liens valides : adhérent du club de l'organisateur, compte joueur existant. */
export async function sanitizeLinks<T extends { memberId?: string | null; playerAccountId?: string | null }>(ownerId: string, rows: T[]): Promise<T[]> {
  const memberIds = [...new Set(rows.map((r) => r.memberId).filter((x): x is string => !!x))];
  const accountIds = [...new Set(rows.map((r) => r.playerAccountId).filter((x): x is string => !!x))];
  const okMembers = memberIds.length
    ? await db
        .select({ id: clubMembers.id, acc: clubMembers.playerAccountId })
        .from(clubMembers)
        .innerJoin(clubs, eq(clubs.id, clubMembers.clubId))
        .where(and(eq(clubs.ownerId, ownerId), inArray(clubMembers.id, memberIds)))
    : [];
  const okAccounts = accountIds.length ? await db.select({ id: playerAccounts.id }).from(playerAccounts).where(inArray(playerAccounts.id, accountIds)) : [];
  return rows.map((r) => {
    const m = r.memberId ? okMembers.find((x) => x.id === r.memberId) : undefined;
    const accountId = r.playerAccountId && okAccounts.some((x) => x.id === r.playerAccountId) ? r.playerAccountId : (m?.acc ?? null);
    return { ...r, memberId: m ? m.id : null, playerAccountId: accountId };
  });
}

export async function directoryRoutes(app: FastifyInstance) {
  // ---- Annuaire public : tournois et clubs que les organisateurs ont choisi d'afficher ----
  app.get('/public/directory', async (req) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select({ e: events, clubName: users.clubName, ownerPseudo: users.pseudo })
      .from(events)
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(and(eq(events.listed, true), inArray(events.status, ['open', 'closed']), or(isNull(events.eventDate), sql`${events.eventDate} >= ${today}`)))
      .orderBy(sql`${events.eventDate} asc nulls last`, asc(events.eventTime));
    const ids = rows.map((r) => r.e.id);
    const taken = ids.length
      ? await db
          .select({ id: registrations.eventId, n: sql<number>`count(*)::int` })
          .from(registrations)
          .where(and(inArray(registrations.eventId, ids), inArray(registrations.status, ['pending', 'validated'])))
          .groupBy(registrations.eventId)
      : [];
    const account = await currentPlayer(app, req);
    const mine = account && ids.length
      ? await db
          .select({ id: registrations.eventId, code: registrations.code, status: registrations.status })
          .from(registrations)
          .where(and(inArray(registrations.eventId, ids), eq(registrations.playerAccountId, account.id)))
      : [];
    const clubRows = await db
      .select({ c: clubs })
      .from(clubs)
      .where(and(eq(clubs.listed, true), eq(clubs.published, true)))
      .orderBy(asc(clubs.name));
    const clubByOwner = new Map(clubRows.map(({ c }) => [c.ownerId, c]));
    return {
      events: rows.map(({ e, clubName, ownerPseudo }) => {
        const my = mine.find((m) => m.id === e.id && m.status !== 'cancelled');
        const club = clubByOwner.get(e.ownerId);
        return {
          name: e.name,
          eventDate: e.eventDate,
          eventTime: e.eventTime,
          location: e.location,
          description: e.description,
          financialMode: e.financialMode,
          buyin: e.buyin,
          capacity: e.capacity,
          taken: taken.find((t) => t.id === e.id)?.n ?? 0,
          status: e.status,
          publicToken: e.publicToken,
          organizer: club?.name || clubName || ownerPseudo || null,
          clubToken: club?.publicToken ?? null,
          mine: my ? { code: my.code, status: my.status } : null,
        };
      }),
      clubs: clubRows.map(({ c }) => ({
        name: c.name,
        city: c.city,
        description: c.description,
        logoAssetId: c.logoAssetId,
        publicToken: c.publicToken,
        upcoming: rows.filter((r) => r.e.ownerId === c.ownerId).length,
      })),
    };
  });

  // ---- Recherche de joueurs (organisateur) ----
  await app.register(async (auth) => {
    auth.addHook('preHandler', app.authenticate);
    auth.get('/directory/players', async (req) => {
      const { q } = parse(z.object({ q: z.string().max(60).default('') }), req.query);
      return { players: await searchPlayers(userId(req), q) };
    });
  });
}
