import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { computeStats } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { bad, notFound, parse } from '../lib';
import { toPlayer, toTournament } from '../services/tournament';
import { championshipView } from './championships';
import { countTaken, pseudoInEvent, registrationCode, registrationInput } from './events';
import { sse } from './tournaments';

const { tournaments, players, tournamentTables, championships, events, registrations, assets, users, clubs, clubSeasons, clubMembers, clubMemberships, clubRequests } = schema;
const tokenParam = z.object({ token: z.string().min(10).max(64) });

async function tournamentByToken(token: string) {
  const [row] = await db
    .select()
    .from(tournaments)
    .where(and(eq(tournaments.publicToken, token), ne(tournaments.status, 'finished')));
  if (!row) throw notFound('Ce lien n’est plus valable : le live a été terminé ou réinitialisé.');
  return row;
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/assets/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [a] = await db.select().from(assets).where(eq(assets.id, id));
    if (!a) throw notFound();
    return reply.header('Content-Type', a.mime).header('Cache-Control', 'public, max-age=31536000, immutable').send(a.data);
  });

  app.get('/public/plan/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const row = await tournamentByToken(token);
    const t = toTournament(row);
    const plist = (await db.select().from(players).where(eq(players.tournamentId, row.id))).map(toPlayer);
    const tables = await db.select().from(tournamentTables).where(eq(tournamentTables.tournamentId, row.id)).orderBy(asc(tournamentTables.number));
    const stats = computeStats(t.settings, plist);
    return {
      title: t.title,
      logoAssetId: t.theme.logoAssetId,
      maxPerTable: t.settings.maxPerTable,
      finalTableSize: t.settings.finalTableSize,
      version: t.version,
      stats: { activePlayers: stats.activePlayers, totalEntries: stats.totalEntries },
      tables: tables.map((tb) => ({
        number: tb.number,
        isFinal: tb.isFinal,
        seats: plist
          .filter((p) => p.status === 'active' && p.tableNumber === tb.number)
          .map((p) => ({ seat: p.seatNumber, pseudo: p.pseudo, locked: p.seatLocked, member: !!p.memberId, guest: !p.memberId && !!p.registrationId }))
          .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0)),
      })),
    };
  });

  app.get('/public/plan/:token/stream', async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const row = await tournamentByToken(token);
    return sse(req, reply, `t:${row.id}`);
  });

  app.get('/public/ranking/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const [c] = await db.select().from(championships).where(eq(championships.publicToken, token));
    if (!c || !c.published) throw notFound('Ce championnat n’est pas publié, ou le lien n’est plus valide.');
    const view = await championshipView(c);
    const [owner] = await db.select({ clubName: users.clubName }).from(users).where(eq(users.id, c.ownerId));
    return {
      name: c.name,
      type: c.type,
      bestResults: c.bestResults,
      organizer: owner?.clubName ?? null,
      ranking: view.ranking,
      imports: view.imports.filter((i) => !i.cancelledAt).length,
      details: view.details,
    };
  });

  app.get('/public/events/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const [e] = await db.select().from(events).where(eq(events.publicToken, token));
    if (!e || e.status === 'draft') throw notFound('Page d’inscription introuvable.');
    const [owner] = await db.select({ clubName: users.clubName, pseudo: users.pseudo }).from(users).where(eq(users.id, e.ownerId));
    const regs = await db
      .select({ pseudo: registrations.pseudo, status: registrations.status })
      .from(registrations)
      .where(eq(registrations.eventId, e.id))
      .orderBy(asc(registrations.createdAt));
    return {
      name: e.name,
      eventDate: e.eventDate,
      eventTime: e.eventTime,
      location: e.location,
      capacity: e.capacity,
      maxPerTable: e.maxPerTable,
      startStack: e.startStack,
      financialMode: e.financialMode,
      buyin: e.buyin,
      description: e.description,
      options: e.options,
      status: e.status,
      organizer: owner?.clubName || owner?.pseudo || null,
      taken: regs.filter((r) => r.status === 'pending' || r.status === 'validated').length,
      participants: regs.filter((r) => r.status === 'validated').map((r) => r.pseudo),
      waitlist: regs.filter((r) => r.status === 'waitlist').length,
    };
  });

  app.post('/public/events/:token/register', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(registrationInput, req.body);
    const [e] = await db.select().from(events).where(eq(events.publicToken, token));
    if (!e || e.status === 'draft') throw notFound('Page d’inscription introuvable.');
    if (e.status !== 'open') throw bad('Les inscriptions sont closes.');
    for (const o of e.options) if (!body.answers[o.id]) throw bad('Le joueur doit répondre à toutes les options.');
    if (await pseudoInEvent(e.id, body.pseudo)) throw bad('Ce pseudo est déjà inscrit à cet événement.');
    const full = e.capacity != null && (await countTaken(e.id)) >= e.capacity;
    const [r] = await db
      .insert(registrations)
      .values({ eventId: e.id, ...body, email: body.email || null, status: full ? 'waitlist' : 'pending', code: registrationCode() })
      .returning({ status: registrations.status, code: registrations.code });
    let position: number | null = null;
    if (r.status === 'waitlist') {
      const wl = await db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.eventId, e.id), eq(registrations.status, 'waitlist')));
      position = wl.length;
    }
    return { ok: true, status: r.status, position, code: r.code };
  });

  // ---- Page publique du club ----
  app.get('/public/club/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const [c] = await db.select().from(clubs).where(eq(clubs.publicToken, token));
    if (!c || !c.published) throw notFound('Page club introuvable.');
    const [season] = await db.select().from(clubSeasons).where(and(eq(clubSeasons.clubId, c.id), eq(clubSeasons.open, true)));
    const members = season
      ? await db.select({ id: clubMemberships.id }).from(clubMemberships).where(eq(clubMemberships.seasonId, season.id))
      : await db.select({ id: clubMembers.id }).from(clubMembers).where(eq(clubMembers.clubId, c.id));
    const now = new Date().toISOString().slice(0, 10);
    const upcoming = await db
      .select({ name: events.name, eventDate: events.eventDate, eventTime: events.eventTime, location: events.location, publicToken: events.publicToken, status: events.status })
      .from(events)
      .where(and(eq(events.ownerId, c.ownerId), eq(events.status, 'open')));
    return {
      name: c.name,
      city: c.city,
      description: c.description,
      logoAssetId: c.logoAssetId,
      season: season ? { name: season.name, startsOn: season.startsOn, endsOn: season.endsOn, duesAmount: season.duesAmount } : null,
      members: members.length,
      events: upcoming.filter((e) => !e.eventDate || e.eventDate >= now),
    };
  });

  app.post('/public/club/:token/request', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(
      z.object({
        pseudo: z.string().trim().min(1, 'Veuillez saisir un pseudo.').max(40),
        firstName: z.string().trim().max(60).nullish(),
        lastName: z.string().trim().max(60).nullish(),
        email: z.string().trim().email('Email invalide.').max(200),
        phone: z.string().trim().max(40).nullish(),
        message: z.string().trim().max(1000).nullish(),
        membershipType: z.enum(['live', 'online', 'both']).default('live'),
      }),
      req.body,
    );
    const [c] = await db.select().from(clubs).where(eq(clubs.publicToken, token));
    if (!c || !c.published) throw notFound('Page club introuvable.');
    const [taken] = await db
      .select({ id: clubMembers.id })
      .from(clubMembers)
      .where(and(eq(clubMembers.clubId, c.id), sql`lower(${clubMembers.pseudo}) = lower(${body.pseudo})`));
    const [pending] = await db
      .select({ id: clubRequests.id })
      .from(clubRequests)
      .where(and(eq(clubRequests.clubId, c.id), eq(clubRequests.status, 'pending'), sql`lower(${clubRequests.pseudo}) = lower(${body.pseudo})`));
    if (taken || pending) throw bad('Ce pseudo est déjà utilisé dans le club.');
    const [season] = await db.select().from(clubSeasons).where(and(eq(clubSeasons.clubId, c.id), eq(clubSeasons.open, true)));
    await db.insert(clubRequests).values({ clubId: c.id, seasonId: season?.id ?? null, ...body, firstName: body.firstName || null, lastName: body.lastName || null, phone: body.phone || null, message: body.message || null });
    return { ok: true };
  });

  // ---- Suivi d'une préinscription par le joueur (code du QR) ----
  const codeParam = z.object({ code: z.string().regex(/^R[A-Za-z0-9]{6,20}$/) });
  app.get('/public/registrations/:code', async (req) => {
    const { code } = parse(codeParam, req.params);
    const [r] = await db.select({ r: registrations, e: events }).from(registrations).innerJoin(events, eq(events.id, registrations.eventId)).where(eq(registrations.code, code));
    if (!r) throw notFound('Inscription introuvable.');
    let position: number | null = null;
    if (r.r.status === 'waitlist') {
      const wl = await db.select({ id: registrations.id, createdAt: registrations.createdAt }).from(registrations).where(and(eq(registrations.eventId, r.e.id), eq(registrations.status, 'waitlist'))).orderBy(asc(registrations.createdAt));
      position = wl.findIndex((x) => x.id === r.r.id) + 1;
    }
    return { pseudo: r.r.pseudo, status: r.r.status, present: r.r.present, position, code, event: { name: r.e.name, eventDate: r.e.eventDate, eventTime: r.e.eventTime, location: r.e.location, status: r.e.status, publicToken: r.e.publicToken } };
  });

  app.post('/public/registrations/:code/cancel', async (req) => {
    const { code } = parse(codeParam, req.params);
    const [r] = await db.select({ r: registrations, e: events }).from(registrations).innerJoin(events, eq(events.id, registrations.eventId)).where(eq(registrations.code, code));
    if (!r) throw notFound('Inscription introuvable.');
    if (r.e.status === 'imported') throw bad('Le tournoi a déjà commencé : contactez l’organisateur.');
    await db.update(registrations).set({ status: 'cancelled', present: false }).where(eq(registrations.id, r.r.id));
    return { ok: true };
  });
}
