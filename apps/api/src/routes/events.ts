import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { toCsv, uid } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { bad, idParam, notFound, parse, parsePatch, publicToken, sendCsv, userId } from '../lib';
import { mutateTournament } from '../services/tournament';
import { insertPlayers } from './players';

const { events, registrations } = schema;
export const registrationCode = () => 'R' + publicToken(10);
type EventRow = typeof events.$inferSelect;

export const eventInput = z.object({
  name: z.string().trim().min(1, "Nom de l'événement requis.").max(80),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  eventTime: z.string().max(10).nullish(),
  location: z.string().trim().max(200).nullish(),
  capacity: z.number().int().min(2).max(1000).nullish(),
  maxPerTable: z.number().int().min(2).max(10).default(10),
  startStack: z.number().int().min(1).max(100_000_000).default(10000),
  financialMode: z.enum(['money', 'lots', 'free']).default('money'),
  buyin: z.number().min(0).max(100000).default(0),
  description: z.string().max(2000).nullish(),
  options: z.array(z.object({ id: z.string().max(64).optional(), label: z.string().trim().min(1).max(120) })).max(10).default([]),
  listed: z.boolean().default(false),
});

export const registrationInput = z.object({
  pseudo: z.string().trim().min(1, 'Veuillez saisir un pseudo.').max(40),
  firstName: z.string().trim().max(60).nullish(),
  lastName: z.string().trim().max(60).nullish(),
  email: z.string().trim().email('Email invalide.').max(200).nullish().or(z.literal('')),
  answers: z.record(z.string(), z.enum(['yes', 'no', 'unknown'])).default({}),
});

async function getEvent(id: string, ownerId: string): Promise<EventRow> {
  const [e] = await db.select().from(events).where(and(eq(events.id, id), eq(events.ownerId, ownerId)));
  if (!e) throw notFound('Événement introuvable.');
  return e;
}

export async function pseudoInEvent(eventId: string, pseudo: string) {
  const [r] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), sql`lower(${registrations.pseudo}) = lower(${pseudo})`));
  return !!r;
}

export async function countTaken(eventId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), sql`${registrations.status} in ('pending','validated')`));
  return r.n;
}

export async function eventRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/events', async (req) => {
    const rows = await db.select().from(events).where(eq(events.ownerId, userId(req))).orderBy(desc(events.createdAt));
    const counts = await db
      .select({ eventId: registrations.eventId, status: registrations.status, n: sql<number>`count(*)::int` })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(eq(events.ownerId, userId(req)))
      .groupBy(registrations.eventId, registrations.status);
    return {
      items: rows.map((e) => ({
        ...e,
        counts: Object.fromEntries(counts.filter((c) => c.eventId === e.id).map((c) => [c.status, c.n])),
      })),
    };
  });

  app.post('/events', async (req) => {
    const body = parse(eventInput, req.body);
    const [row] = await db
      .insert(events)
      .values({ ...body, options: body.options.map((o) => ({ id: o.id ?? uid(), label: o.label })), ownerId: userId(req), publicToken: publicToken() })
      .returning();
    return row;
  });

  app.get('/events/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const e = await getEvent(id, userId(req));
    const regs = await db.select().from(registrations).where(eq(registrations.eventId, id)).orderBy(asc(registrations.createdAt));
    return { event: e, registrations: regs };
  });

  app.patch('/events/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parsePatch(eventInput.partial(), req.body);
    const e = await getEvent(id, userId(req));
    if (e.status === 'imported') throw bad('Action impossible : événement déjà importé.');
    if (body.options && e.status !== 'draft') {
      const same = JSON.stringify(body.options.map((o) => o.label)) === JSON.stringify(e.options.map((o) => o.label));
      if (!same) throw bad('Les options sont figées après publication.');
      delete body.options;
    }
    const set: Partial<EventRow> = { ...body } as Partial<EventRow>;
    if (body.options) set.options = body.options.map((o) => ({ id: o.id ?? uid(), label: o.label }));
    const [row] = await db.update(events).set(set).where(eq(events.id, id)).returning();
    return row;
  });

  app.delete('/events/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await getEvent(id, userId(req));
    await db.delete(events).where(eq(events.id, id));
    return { ok: true };
  });

  app.post('/events/:id/status', async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(z.object({ status: z.enum(['draft', 'open', 'closed']) }), req.body);
    const e = await getEvent(id, userId(req));
    if (e.status === 'imported') throw bad('Action impossible : événement déjà importé.');
    if (status === 'draft' && e.status !== 'draft') {
      const n = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.eventId, id));
      if (n.length > 0) throw bad('Des joueurs sont déjà inscrits : impossible de repasser en brouillon.');
    }
    const [row] = await db.update(events).set({ status }).where(eq(events.id, id)).returning();
    return row;
  });

  app.post('/events/:id/registrations', async (req) => {
    const { id } = parse(idParam, req.params);
    const { playerAccountId, ...body } = parse(registrationInput.extend({ playerAccountId: z.string().uuid().nullish() }), req.body);
    const e = await getEvent(id, userId(req));
    if (e.status === 'imported') throw bad('Action impossible : événement déjà importé.');
    if (await pseudoInEvent(id, body.pseudo)) throw bad('Ce pseudo est déjà inscrit.');
    let accountId: string | null = null;
    if (playerAccountId) {
      const [acc] = await db.select({ id: schema.playerAccounts.id }).from(schema.playerAccounts).where(eq(schema.playerAccounts.id, playerAccountId));
      if (!acc) throw bad('Compte joueur introuvable.');
      const [dup] = await db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.eventId, id), eq(registrations.playerAccountId, acc.id)));
      if (dup) throw bad('Ce joueur est déjà inscrit.');
      accountId = acc.id;
    }
    const [row] = await db
      .insert(registrations)
      .values({ eventId: id, ...body, email: body.email || null, status: 'validated', code: registrationCode(), playerAccountId: accountId })
      .returning();
    return row;
  });

  app.patch('/events/:id/registrations/:rid', async (req) => {
    const { id, rid } = parse(idParam.extend({ rid: z.string().uuid() }), req.params);
    const body = parse(
      z.object({ status: z.enum(['pending', 'validated', 'waitlist', 'refused', 'cancelled']).optional(), present: z.boolean().optional() }),
      req.body,
    );
    await getEvent(id, userId(req));
    const set: { status?: typeof body.status; present?: boolean } = { ...body };
    if (body.present === true) set.status = 'validated';
    const [row] = await db
      .update(registrations)
      .set(set)
      .where(and(eq(registrations.id, rid), eq(registrations.eventId, id)))
      .returning();
    if (!row) throw notFound();
    return row;
  });

  app.delete('/events/:id/registrations/:rid', async (req) => {
    const { id, rid } = parse(idParam.extend({ rid: z.string().uuid() }), req.params);
    await getEvent(id, userId(req));
    await db.delete(registrations).where(and(eq(registrations.id, rid), eq(registrations.eventId, id)));
    return { ok: true };
  });

  app.get('/events/:id/registrations.csv', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const e = await getEvent(id, userId(req));
    const regs = await db.select().from(registrations).where(eq(registrations.eventId, id)).orderBy(asc(registrations.createdAt));
    const label: Record<string, string> = { yes: 'Oui', no: 'Non', unknown: 'Ne sait pas' };
    const statusFr: Record<string, string> = { pending: 'À valider', validated: 'Validé', waitlist: "Liste d'attente", refused: 'Refusé', cancelled: 'Annulé' };
    const csv = toCsv([
      ['pseudo', 'prenom', 'nom', 'email', 'statut', 'present', 'inscrit_le', ...e.options.map((o) => o.label)],
      ...regs.map((r) => [
        r.pseudo,
        r.firstName,
        r.lastName,
        r.email,
        statusFr[r.status],
        r.present ? 'oui' : 'non',
        r.createdAt.toISOString(),
        ...e.options.map((o) => (r.answers[o.id] ? label[r.answers[o.id]] : '')),
      ]),
    ]);
    return sendCsv(reply, `preinscrits-${e.name}.csv`, csv);
  });

  app.post('/events/:id/import', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ tournamentId: z.string().uuid(), mode: z.enum(['present', 'validated']) }), req.body);
    const uidv = userId(req);
    const e = await getEvent(id, uidv);
    if (e.status === 'imported') throw bad('Cette page d’inscription a déjà été importée.');
    const regs = await db.select().from(registrations).where(eq(registrations.eventId, id)).orderBy(asc(registrations.createdAt));
    const chosen = regs.filter((r) => r.status === 'validated' && (body.mode === 'validated' || r.present));
    if (chosen.length === 0) throw bad('Aucun joueur validé à importer.');
    const res = await mutateTournament(body.tournamentId, uidv, (ctx) =>
      insertPlayers(
        ctx,
        chosen.map((r) => ({ pseudo: r.pseudo, firstName: r.firstName, lastName: r.lastName, registrationId: r.id, present: r.present, playerAccountId: r.playerAccountId })),
      ),
    );
    await db.update(events).set({ status: 'imported', tournamentId: body.tournamentId }).where(eq(events.id, id));
    return res;
  });
}
