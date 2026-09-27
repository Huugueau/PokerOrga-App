import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { toCsv, uid } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { bad, conflict, idParam, notFound, parse, publicToken, sendCsv, userId } from '../lib';
import { mutateTournament } from '../services/tournament';
import { insertPlayers } from './players';

const { clubs, clubSeasons, clubMembers, clubMemberships, clubPayments, clubRequests, players } = schema;
type Club = typeof clubs.$inferSelect;

export const memberCode = () => 'M' + publicToken(10);

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const memberInput = z.object({
  pseudo: z.string().trim().min(1, 'Le pseudo est obligatoire.').max(40),
  firstName: optText(60),
  lastName: optText(60),
  email: optText(200),
  phone: optText(40),
  address: optText(300),
  note: optText(1000),
  membershipType: z.enum(['live', 'online', 'both']).default('live'),
  roleIds: z.array(z.string().max(64)).max(20).default([]),
});
const seasonInput = z.object({
  name: z.string().trim().min(1, 'Nom de la saison requis.').max(60),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  duesAmount: z.number().min(0).max(100000).default(0),
});

async function getClub(ownerId: string): Promise<Club> {
  const [c] = await db.select().from(clubs).where(eq(clubs.ownerId, ownerId));
  if (!c) throw notFound("Créez d'abord la fiche de votre club.");
  return c;
}

async function memberOf(clubId: string, id: string) {
  const [m] = await db.select().from(clubMembers).where(and(eq(clubMembers.id, id), eq(clubMembers.clubId, clubId)));
  if (!m) throw notFound('Adhérent introuvable.');
  return m;
}

async function pseudoTaken(clubId: string, pseudo: string, exceptId?: string) {
  const rows = await db
    .select({ id: clubMembers.id })
    .from(clubMembers)
    .where(and(eq(clubMembers.clubId, clubId), sql`lower(${clubMembers.pseudo}) = lower(${pseudo})`));
  return rows.some((r) => r.id !== exceptId);
}

export async function clubRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/club', async (req) => {
    const [c] = await db.select().from(clubs).where(eq(clubs.ownerId, userId(req)));
    if (!c) return { club: null, seasons: [] };
    const seasons = await db.select().from(clubSeasons).where(eq(clubSeasons.clubId, c.id)).orderBy(desc(clubSeasons.createdAt));
    const [pending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(clubRequests)
      .where(and(eq(clubRequests.clubId, c.id), eq(clubRequests.status, 'pending')));
    return { club: c, seasons, pendingRequests: pending.n };
  });

  app.post('/club', async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2, 'Le nom du club doit contenir entre 2 et 120 caractères.').max(120),
        city: optText(80),
        description: optText(3000),
        season: seasonInput,
      }),
      req.body,
    );
    const uidv = userId(req);
    const [exists] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.ownerId, uidv));
    if (exists) throw conflict('Votre club existe déjà.');
    const c = await db.transaction(async (tx) => {
      const [club] = await tx
        .insert(clubs)
        .values({
          ownerId: uidv,
          name: body.name,
          city: body.city,
          description: body.description,
          publicToken: publicToken(),
          roles: [
            { id: uid(), name: 'Président', color: '#4ea486' },
            { id: uid(), name: 'Trésorier', color: '#6b8fd6' },
            { id: uid(), name: 'Bénévole', color: '#a78bfa' },
          ],
        })
        .returning();
      await tx.insert(clubSeasons).values({ clubId: club.id, ...body.season, open: true });
      return club;
    });
    return c;
  });

  app.patch('/club', async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        city: optText(80).optional(),
        description: optText(3000).optional(),
        logoAssetId: z.string().uuid().nullable().optional(),
        published: z.boolean().optional(),
        roles: z.array(z.object({ id: z.string().max(64), name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(20).optional(),
      }),
      req.body,
    );
    const c = await getClub(userId(req));
    const next = { ...c, ...body };
    if (body.published && (next.description ?? '').length < 20) throw bad('Ajoutez une description d’au moins 20 caractères avant de publier.');
    const [row] = await db.update(clubs).set(body).where(eq(clubs.id, c.id)).returning();
    return row;
  });

  // ---- Saisons ----
  app.post('/club/seasons', async (req) => {
    const body = parse(seasonInput, req.body);
    const c = await getClub(userId(req));
    const [open] = await db.select({ id: clubSeasons.id }).from(clubSeasons).where(and(eq(clubSeasons.clubId, c.id), eq(clubSeasons.open, true)));
    if (open) throw bad("Clôturez la saison ouverte avant d'en créer une autre.");
    const [row] = await db.insert(clubSeasons).values({ clubId: c.id, ...body, open: true }).returning();
    return row;
  });

  app.patch('/club/seasons/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(seasonInput.partial().extend({ open: z.boolean().optional() }), req.body);
    const c = await getClub(userId(req));
    if (body.open) {
      const [open] = await db
        .select({ id: clubSeasons.id })
        .from(clubSeasons)
        .where(and(eq(clubSeasons.clubId, c.id), eq(clubSeasons.open, true)));
      if (open && open.id !== id) throw bad("Clôturez d'abord la saison actuellement ouverte.");
    }
    const [row] = await db
      .update(clubSeasons)
      .set(body)
      .where(and(eq(clubSeasons.id, id), eq(clubSeasons.clubId, c.id)))
      .returning();
    if (!row) throw notFound('Saison introuvable.');
    return row;
  });

  // ---- Adhérents ----
  app.get('/club/members', async (req) => {
    const { seasonId } = parse(z.object({ seasonId: z.string().uuid().optional() }), req.query);
    const c = await getClub(userId(req));
    const members = await db.select().from(clubMembers).where(eq(clubMembers.clubId, c.id)).orderBy(asc(clubMembers.pseudo));
    const ids = members.map((m) => m.id);
    const [ms, pays] = ids.length
      ? await Promise.all([
          seasonId ? db.select().from(clubMemberships).where(and(inArray(clubMemberships.memberId, ids), eq(clubMemberships.seasonId, seasonId))) : Promise.resolve([]),
          seasonId
            ? db
                .select()
                .from(clubPayments)
                .where(and(inArray(clubPayments.memberId, ids), eq(clubPayments.seasonId, seasonId)))
                .orderBy(desc(clubPayments.paidOn))
            : Promise.resolve([]),
        ])
      : [[], []];
    const played = ids.length
      ? await db
          .select({ memberId: players.memberId, n: sql<number>`count(distinct ${players.tournamentId})::int` })
          .from(players)
          .where(inArray(players.memberId, ids))
          .groupBy(players.memberId)
      : [];
    return {
      members: members.map((m) => {
        const membership = ms.find((x) => x.memberId === m.id) ?? null;
        const payments = pays.filter((p) => p.memberId === m.id);
        const paidDues = payments.filter((p) => p.kind === 'dues' && !p.cancelledAt).reduce((a, p) => a + p.amount, 0);
        const donations = payments.filter((p) => p.kind === 'donation' && !p.cancelledAt).reduce((a, p) => a + p.amount, 0);
        let duesStatus: 'none' | 'exempt' | 'paid' | 'partial' | 'unpaid' = 'none';
        if (membership) {
          if (membership.exempt) duesStatus = 'exempt';
          else if (membership.duesExpected <= 0 || paidDues >= membership.duesExpected) duesStatus = 'paid';
          else if (paidDues > 0) duesStatus = 'partial';
          else duesStatus = 'unpaid';
        }
        return { ...m, membership, payments, paidDues, donations, duesStatus, tournaments: played.find((p) => p.memberId === m.id)?.n ?? 0 };
      }),
    };
  });

  app.post('/club/members', async (req) => {
    const body = parse(memberInput.extend({ seasonId: z.string().uuid().optional() }), req.body);
    const c = await getClub(userId(req));
    if (await pseudoTaken(c.id, body.pseudo)) throw bad('Ce pseudo est déjà utilisé dans le club.');
    const { seasonId, ...data } = body;
    const [m] = await db.insert(clubMembers).values({ ...data, clubId: c.id, code: memberCode() }).returning();
    if (seasonId) {
      const [s] = await db.select().from(clubSeasons).where(and(eq(clubSeasons.id, seasonId), eq(clubSeasons.clubId, c.id)));
      if (s) await db.insert(clubMemberships).values({ memberId: m.id, seasonId, duesExpected: s.duesAmount });
    }
    return m;
  });

  app.patch('/club/members/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(memberInput.partial(), req.body);
    const c = await getClub(userId(req));
    await memberOf(c.id, id);
    if (body.pseudo && (await pseudoTaken(c.id, body.pseudo, id))) throw bad('Ce pseudo est déjà utilisé dans le club.');
    const [m] = await db.update(clubMembers).set(body).where(eq(clubMembers.id, id)).returning();
    return m;
  });

  app.delete('/club/members/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await getClub(userId(req));
    await memberOf(c.id, id);
    await db.delete(clubMembers).where(eq(clubMembers.id, id));
    return { ok: true };
  });

  app.post('/club/members/:id/regenerate-code', async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await getClub(userId(req));
    await memberOf(c.id, id);
    const [m] = await db.update(clubMembers).set({ code: memberCode() }).where(eq(clubMembers.id, id)).returning();
    return m;
  });

  /** Adhésion d'un membre à une saison (création / renouvellement / exonération). */
  app.put('/club/members/:id/membership', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ seasonId: z.string().uuid(), active: z.boolean(), exempt: z.boolean().optional(), duesExpected: z.number().min(0).max(100000).optional() }), req.body);
    const c = await getClub(userId(req));
    await memberOf(c.id, id);
    const [s] = await db.select().from(clubSeasons).where(and(eq(clubSeasons.id, body.seasonId), eq(clubSeasons.clubId, c.id)));
    if (!s) throw notFound('Saison introuvable.');
    if (!body.active) {
      await db.delete(clubMemberships).where(and(eq(clubMemberships.memberId, id), eq(clubMemberships.seasonId, s.id)));
      return { ok: true };
    }
    await db
      .insert(clubMemberships)
      .values({ memberId: id, seasonId: s.id, exempt: body.exempt ?? false, duesExpected: body.duesExpected ?? s.duesAmount })
      .onConflictDoUpdate({
        target: [clubMemberships.memberId, clubMemberships.seasonId],
        set: { ...(body.exempt !== undefined ? { exempt: body.exempt } : {}), ...(body.duesExpected !== undefined ? { duesExpected: body.duesExpected } : {}) },
      });
    return { ok: true };
  });

  /** Renouvellement groupé vers la saison ouverte. */
  app.post('/club/renew', async (req) => {
    const body = parse(z.object({ memberIds: z.array(z.string().uuid()).min(1).max(500), seasonId: z.string().uuid() }), req.body);
    const c = await getClub(userId(req));
    const [s] = await db.select().from(clubSeasons).where(and(eq(clubSeasons.id, body.seasonId), eq(clubSeasons.clubId, c.id)));
    if (!s || !s.open) throw bad('La saison cible est clôturée et ne peut plus recevoir de renouvellement.');
    const members = await db.select({ id: clubMembers.id }).from(clubMembers).where(and(eq(clubMembers.clubId, c.id), inArray(clubMembers.id, body.memberIds)));
    if (members.length === 0) throw bad('Aucun renouvellement à créer.');
    await db
      .insert(clubMemberships)
      .values(members.map((m) => ({ memberId: m.id, seasonId: s.id, duesExpected: s.duesAmount })))
      .onConflictDoNothing();
    return { ok: true, count: members.length };
  });

  app.post('/club/members/:id/payments', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        seasonId: z.string().uuid(),
        kind: z.enum(['dues', 'donation']),
        amount: z.number().positive().max(100000),
        method: z.enum(['cash', 'check', 'transfer', 'helloasso', 'other']).default('cash'),
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: optText(200),
      }),
      req.body,
    );
    const c = await getClub(userId(req));
    await memberOf(c.id, id);
    const [row] = await db.insert(clubPayments).values({ memberId: id, ...body }).returning();
    return row;
  });

  app.delete('/club/payments/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await getClub(userId(req));
    const [p] = await db
      .select({ id: clubPayments.id })
      .from(clubPayments)
      .innerJoin(clubMembers, eq(clubMembers.id, clubPayments.memberId))
      .where(and(eq(clubPayments.id, id), eq(clubMembers.clubId, c.id), isNull(clubPayments.cancelledAt)));
    if (!p) throw notFound('Ce paiement est introuvable ou déjà annulé.');
    await db.update(clubPayments).set({ cancelledAt: new Date() }).where(eq(clubPayments.id, id));
    return { ok: true };
  });

  app.get('/club/members.csv', async (req, reply) => {
    const { seasonId } = parse(z.object({ seasonId: z.string().uuid().optional() }), req.query);
    const c = await getClub(userId(req));
    const members = await db.select().from(clubMembers).where(eq(clubMembers.clubId, c.id)).orderBy(asc(clubMembers.pseudo));
    const ms = seasonId ? await db.select().from(clubMemberships).where(eq(clubMemberships.seasonId, seasonId)) : [];
    const pays = seasonId ? await db.select().from(clubPayments).where(and(eq(clubPayments.seasonId, seasonId), isNull(clubPayments.cancelledAt))) : [];
    const roleName = new Map(c.roles.map((r) => [r.id, r.name]));
    const type = { live: 'Live', online: 'Online', both: 'Online + Live' };
    const csv = toCsv([
      ['pseudo', 'prenom', 'nom', 'email', 'telephone', 'adresse', 'type', 'roles', 'adherent_saison', 'cotisation_attendue', 'cotisation_payee', 'dons', 'exonere', 'inscrit_le'],
      ...members.map((m) => {
        const mm = ms.find((x) => x.memberId === m.id);
        const p = pays.filter((x) => x.memberId === m.id);
        return [
          m.pseudo,
          m.firstName,
          m.lastName,
          m.email,
          m.phone,
          m.address,
          type[m.membershipType],
          m.roleIds.map((r) => roleName.get(r)).filter(Boolean).join(', '),
          mm ? 'oui' : 'non',
          mm?.duesExpected ?? '',
          p.filter((x) => x.kind === 'dues').reduce((a, x) => a + x.amount, 0),
          p.filter((x) => x.kind === 'donation').reduce((a, x) => a + x.amount, 0),
          mm?.exempt ? 'oui' : '',
          m.createdAt.toISOString().slice(0, 10),
        ];
      }),
    ]);
    return sendCsv(reply, `adherents-${c.name}.csv`, csv);
  });

  /** Inscrit des adhérents dans un live ouvert. */
  app.post('/club/enroll', async (req) => {
    const body = parse(z.object({ tournamentId: z.string().uuid(), memberIds: z.array(z.string().uuid()).min(1).max(500) }), req.body);
    const uidv = userId(req);
    const c = await getClub(uidv);
    const members = await db.select().from(clubMembers).where(and(eq(clubMembers.clubId, c.id), inArray(clubMembers.id, body.memberIds)));
    return mutateTournament(body.tournamentId, uidv, (ctx) =>
      insertPlayers(
        ctx,
        members.map((m) => ({ pseudo: m.pseudo, firstName: m.firstName, lastName: m.lastName, memberId: m.id, present: true })),
      ),
    );
  });

  // ---- Demandes d'adhésion ----
  app.get('/club/requests', async (req) => {
    const c = await getClub(userId(req));
    const rows = await db.select().from(clubRequests).where(eq(clubRequests.clubId, c.id)).orderBy(desc(clubRequests.createdAt));
    return { items: rows };
  });

  app.post('/club/requests/:id/:action', async (req) => {
    const { id, action } = parse(idParam.extend({ action: z.enum(['accept', 'refuse']) }), req.params);
    const c = await getClub(userId(req));
    const [r] = await db.select().from(clubRequests).where(and(eq(clubRequests.id, id), eq(clubRequests.clubId, c.id)));
    if (!r) throw notFound('Demande introuvable.');
    if (r.status !== 'pending') throw bad('Cette demande a déjà été traitée.');
    if (action === 'refuse') {
      await db.update(clubRequests).set({ status: 'refused' }).where(eq(clubRequests.id, id));
      return { ok: true };
    }
    if (await pseudoTaken(c.id, r.pseudo)) throw bad('Ce pseudo est déjà utilisé dans le club. Modifiez la fiche existante.');
    const [open] = await db.select().from(clubSeasons).where(and(eq(clubSeasons.clubId, c.id), eq(clubSeasons.open, true)));
    await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(clubMembers)
        .values({ clubId: c.id, pseudo: r.pseudo, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, membershipType: r.membershipType, code: memberCode() })
        .returning();
      const season = open ?? null;
      if (season) await tx.insert(clubMemberships).values({ memberId: m.id, seasonId: season.id, duesExpected: season.duesAmount });
      await tx.update(clubRequests).set({ status: 'accepted' }).where(eq(clubRequests.id, id));
    });
    return { ok: true };
  });
}
