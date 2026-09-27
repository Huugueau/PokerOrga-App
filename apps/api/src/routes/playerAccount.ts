import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db';
import { env } from '../env';
import { bad, HttpError, notFound, parse, publicToken } from '../lib';

const { playerAccounts, registrations, events, players, tournaments, users } = schema;
export const PLAYER_COOKIE = 'po_player';
export const playerQr = () => 'P' + publicToken(12);

type Account = typeof playerAccounts.$inferSelect;
const view = (a: Account) => ({ id: a.id, email: a.email, pseudo: a.pseudo, firstName: a.firstName, lastName: a.lastName, qrCode: a.qrCode });

/** Compte joueur connecté (cookie séparé de celui des organisateurs), ou null. */
export async function currentPlayer(app: FastifyInstance, req: FastifyRequest): Promise<Account | null> {
  const token = req.cookies[PLAYER_COOKIE];
  if (!token) return null;
  try {
    const payload = app.jwt.verify<{ pid: string; kind: string }>(token);
    if (payload.kind !== 'player') return null;
    const [a] = await db.select().from(playerAccounts).where(eq(playerAccounts.id, payload.pid));
    return a ?? null;
  } catch {
    return null;
  }
}

async function requirePlayer(app: FastifyInstance, req: FastifyRequest) {
  const a = await currentPlayer(app, req);
  if (!a) throw new HttpError(401, 'Connectez-vous à votre compte joueur.');
  return a;
}

function setSession(app: FastifyInstance, reply: FastifyReply, pid: string) {
  const token = app.jwt.sign({ pid, kind: 'player' }, { expiresIn: '90d' });
  reply.setCookie(PLAYER_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, maxAge: 60 * 60 * 24 * 90 });
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide.'),
  password: z.string().min(6, 'Mot de passe trop court (min 6 car.)').max(200),
});

export async function playerAccountRoutes(app: FastifyInstance) {
  app.post('/player/register', async (req, reply) => {
    const body = parse(credentials.extend({ pseudo: z.string().trim().min(1, 'Le pseudo est obligatoire.').max(40), firstName: z.string().trim().max(60).nullish(), lastName: z.string().trim().max(60).nullish() }), req.body);
    const [exists] = await db.select({ id: playerAccounts.id }).from(playerAccounts).where(eq(playerAccounts.email, body.email));
    if (exists) throw new HttpError(409, 'Un compte joueur existe déjà pour cet email.');
    const [a] = await db
      .insert(playerAccounts)
      .values({ email: body.email, passwordHash: await bcrypt.hash(body.password, 10), pseudo: body.pseudo, firstName: body.firstName || null, lastName: body.lastName || null, qrCode: playerQr() })
      .returning();
    setSession(app, reply, a.id);
    return { player: view(a) };
  });

  app.post('/player/login', async (req, reply) => {
    const body = parse(credentials.pick({ email: true }).extend({ password: z.string().min(1) }), req.body);
    const [a] = await db.select().from(playerAccounts).where(eq(playerAccounts.email, body.email));
    if (!a || !(await bcrypt.compare(body.password, a.passwordHash))) throw new HttpError(401, 'Email ou mot de passe incorrect.');
    setSession(app, reply, a.id);
    return { player: view(a) };
  });

  app.post('/player/logout', async (_req, reply) => {
    reply.clearCookie(PLAYER_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/player/me', async (req) => {
    const a = await currentPlayer(app, req);
    return { player: a ? view(a) : null };
  });

  app.patch('/player/me', async (req) => {
    const a = await requirePlayer(app, req);
    const body = parse(z.object({ pseudo: z.string().trim().min(1).max(40).optional(), firstName: z.string().trim().max(60).nullish(), lastName: z.string().trim().max(60).nullish() }), req.body);
    const [row] = await db.update(playerAccounts).set(body).where(eq(playerAccounts.id, a.id)).returning();
    return { player: view(row) };
  });

  app.post('/player/me/regenerate-qr', async (req) => {
    const a = await requirePlayer(app, req);
    const [row] = await db.update(playerAccounts).set({ qrCode: playerQr() }).where(eq(playerAccounts.id, a.id)).returning();
    return { player: view(row) };
  });

  /** Mes préinscriptions et mes résultats. */
  app.get('/player/me/tournaments', async (req) => {
    const a = await requirePlayer(app, req);
    const regs = await db
      .select({ r: registrations, e: events, organizer: users.clubName })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .innerJoin(users, eq(users.id, events.ownerId))
      .where(eq(registrations.playerAccountId, a.id))
      .orderBy(desc(registrations.createdAt));
    const played = await db
      .select({ p: players, t: tournaments })
      .from(players)
      .innerJoin(tournaments, eq(tournaments.id, players.tournamentId))
      .where(and(eq(players.playerAccountId, a.id), isNotNull(players.finishRank), eq(tournaments.status, 'finished')))
      .orderBy(desc(tournaments.finishedAt));
    const counts = played.length
      ? await db.select({ tid: players.tournamentId }).from(players).where(inArray(players.tournamentId, played.map((x) => x.t.id)))
      : [];
    return {
      registrations: regs.map(({ r, e, organizer }) => ({
        code: r.code,
        status: r.status,
        present: r.present,
        eventName: e.name,
        eventDate: e.eventDate,
        eventTime: e.eventTime,
        location: e.location,
        eventStatus: e.status,
        organizer,
      })),
      results: played.map(({ p, t }) => ({
        tournament: t.title,
        date: t.startedAt ?? t.finishedAt,
        rank: p.finishRank,
        players: counts.filter((c) => c.tid === t.id).length,
        prize: p.prizeAmount,
        prizeLabel: p.prizeLabel,
        kills: p.kills,
      })),
    };
  });

  app.post('/player/me/registrations/:code/cancel', async (req) => {
    const a = await requirePlayer(app, req);
    const { code } = parse(z.object({ code: z.string().min(3).max(40) }), req.params);
    const [r] = await db
      .select({ r: registrations, e: events })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(and(eq(registrations.code, code), eq(registrations.playerAccountId, a.id)));
    if (!r) throw notFound('Inscription introuvable.');
    if (r.e.status === 'imported') throw bad('Le tournoi a déjà commencé : contactez l’organisateur.');
    await db.update(registrations).set({ status: 'cancelled', present: false }).where(eq(registrations.id, r.r.id));
    return { ok: true };
  });
}
