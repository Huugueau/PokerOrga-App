import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { clockInfo, resolveClock } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { bad, idParam, notFound, parse, userId } from '../lib';
import { mutateTournament } from '../services/tournament';
import { insertPlayers } from './players';

const { clubs, clubMembers, registrations, events, players, playerAccounts } = schema;

/**
 * Pointage par QR code dans un live :
 * - carte membre (code « M… ») : ajoute l'adhérent au tournoi, ou pointe sa présence ;
 * - préinscription (code « R… ») : pointe la présence, et ajoute le joueur si demandé.
 */
export async function checkinRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/tournaments/:id/checkin', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ code: z.string().trim().min(3).max(200), add: z.boolean().optional(), override: z.boolean().optional() }), req.body);
    const uidv = userId(req);
    // accepte l'URL complète encodée dans le QR ou le code seul
    let code = body.code.split(/[/?#=]/).filter(Boolean).pop()!.trim();

    // QR du compte joueur : on le rattache à sa carte membre ou à sa préinscription chez cet organisateur
    if (code.startsWith('P')) {
      const [acc] = await db.select().from(playerAccounts).where(eq(playerAccounts.qrCode, code));
      if (!acc) throw notFound('QR non reconnu : le joueur a peut-être régénéré son QR.');
      const [mem] = await db
        .select({ code: clubMembers.code })
        .from(clubMembers)
        .innerJoin(clubs, eq(clubs.id, clubMembers.clubId))
        .where(and(eq(clubMembers.playerAccountId, acc.id), eq(clubs.ownerId, uidv)));
      const regs = await db
        .select({ code: registrations.code, status: registrations.status, eventStatus: events.status })
        .from(registrations)
        .innerJoin(events, eq(events.id, registrations.eventId))
        .where(and(eq(registrations.playerAccountId, acc.id), eq(events.ownerId, uidv)));
      const reg = regs.find((r) => r.code && r.eventStatus !== 'imported' && (r.status === 'validated' || r.status === 'pending')) ?? regs.find((r) => r.code && r.status === 'validated');
      if (mem) code = mem.code;
      else if (reg?.code) code = reg.code;
      else {
        return mutateTournament(id, uidv, async (ctx) => {
          const [existing] = await ctx.tx
            .select()
            .from(players)
            .where(and(eq(players.tournamentId, id), sql`(${players.playerAccountId} = ${acc.id} or lower(${players.pseudo}) = lower(${acc.pseudo}))`));
          if (existing) {
            if (!existing.present) await ctx.tx.update(players).set({ present: true, playerAccountId: acc.id }).where(eq(players.id, existing.id));
            return { kind: 'player', pseudo: acc.pseudo, state: existing.present ? 'already' : 'present' };
          }
          if (!body.add) return { kind: 'player', pseudo: acc.pseudo, state: 'checked', event: 'aucun événement de votre planning' };
          await insertPlayers(ctx, [{ pseudo: acc.pseudo, firstName: acc.firstName, lastName: acc.lastName, playerAccountId: acc.id, present: true }]);
          return { kind: 'player', pseudo: acc.pseudo, state: 'added' };
        });
      }
    }

    if (code.startsWith('M')) {
      const [m] = await db
        .select({ m: clubMembers })
        .from(clubMembers)
        .innerJoin(clubs, eq(clubs.id, clubMembers.clubId))
        .where(and(eq(clubMembers.code, code), eq(clubs.ownerId, uidv)));
      if (!m) throw notFound('QR non reconnu : carte inconnue ou régénérée.');
      const member = m.m;
      return mutateTournament(id, uidv, async (ctx) => {
        const [existing] = await ctx.tx
          .select()
          .from(players)
          .where(and(eq(players.tournamentId, id), sql`(${players.memberId} = ${member.id} or lower(${players.pseudo}) = lower(${member.pseudo}))`));
        if (existing) {
          if (!existing.present) await ctx.tx.update(players).set({ present: true, memberId: member.id }).where(eq(players.id, existing.id));
          return { kind: 'member', pseudo: member.pseudo, state: existing.present ? 'already' : 'present', status: existing.status };
        }
        const open = clockInfo(ctx.t.structure, resolveClock(ctx.t.clock, ctx.t.structure, ctx.now)).lateRegOpen;
        if (ctx.t.status === 'running' && !open && !body.override) return { kind: 'member', pseudo: member.pseudo, state: 'needs-override' };
        await insertPlayers(ctx, [{ pseudo: member.pseudo, firstName: member.firstName, lastName: member.lastName, memberId: member.id, present: true, playerAccountId: member.playerAccountId }]);
        return { kind: 'member', pseudo: member.pseudo, state: 'added' };
      });
    }

    if (code.startsWith('R')) {
      const [r] = await db
        .select({ r: registrations, e: events })
        .from(registrations)
        .innerJoin(events, eq(events.id, registrations.eventId))
        .where(and(eq(registrations.code, code), eq(events.ownerId, uidv)));
      if (!r) throw notFound('QR non reconnu. Vérifiez qu’il s’agit d’un QR de préinscription.');
      const reg = r.r;
      if (reg.status === 'refused' || reg.status === 'cancelled') throw bad('Inscription non éligible au pointage.');
      if (reg.status === 'waitlist' && !body.add) return { kind: 'registration', pseudo: reg.pseudo, state: 'waitlist', event: r.e.name };
      await db.update(registrations).set({ present: true, status: 'validated' }).where(eq(registrations.id, reg.id));
      return mutateTournament(id, uidv, async (ctx) => {
        const [existing] = await ctx.tx
          .select()
          .from(players)
          .where(and(eq(players.tournamentId, id), sql`(${players.registrationId} = ${reg.id} or lower(${players.pseudo}) = lower(${reg.pseudo}))`));
        if (existing) {
          await ctx.tx.update(players).set({ present: true, registrationId: reg.id }).where(eq(players.id, existing.id));
          return { kind: 'registration', pseudo: reg.pseudo, state: existing.present ? 'already' : 'present', event: r.e.name };
        }
        if (!body.add) return { kind: 'registration', pseudo: reg.pseudo, state: 'checked', event: r.e.name };
        await insertPlayers(ctx, [{ pseudo: reg.pseudo, firstName: reg.firstName, lastName: reg.lastName, registrationId: reg.id, present: true, playerAccountId: reg.playerAccountId }]);
        return { kind: 'registration', pseudo: reg.pseudo, state: 'added', event: r.e.name };
      });
    }
    throw bad('QR non reconnu. Vérifiez qu’il s’agit d’un QR PokerOrga.');
  });
}
