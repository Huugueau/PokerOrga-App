import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginSchema, registerSchema, type User } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { env } from '../env';
import { bad, HttpError, parse, userId } from '../lib';

const { users } = schema;
export const COOKIE = 'po_session';

export function toUser(u: typeof users.$inferSelect): User {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    pseudo: u.pseudo,
    clubName: u.clubName,
    usageMode: u.usageMode,
    rakeEnabled: u.rakeEnabled,
  };
}

async function setSession(app: FastifyInstance, reply: FastifyReply, id: string) {
  const token = await reply.jwtSign({ id }, { expiresIn: '30d' });
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/config', async () => ({ allowRegistration: env.ALLOW_REGISTRATION }));

  app.post('/auth/register', async (req, reply) => {
    if (!env.ALLOW_REGISTRATION) throw new HttpError(403, 'Les inscriptions sont fermées sur cette instance.');
    const body = parse(registerSchema, req.body);
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (exists) throw new HttpError(409, 'Un compte existe déjà pour cet email. Connectez-vous.');
    const passwordHash = await bcrypt.hash(body.password, 10);
    const [u] = await db.insert(users).values({ email: body.email, passwordHash }).returning();
    await setSession(app, reply, u.id);
    return { user: toUser(u) };
  });

  app.post('/auth/login', async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const [u] = await db.select().from(users).where(eq(users.email, body.email));
    if (!u || !(await bcrypt.compare(body.password, u.passwordHash))) {
      throw new HttpError(401, 'Email ou mot de passe incorrect.');
    }
    await setSession(app, reply, u.id);
    return { user: toUser(u) };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const [u] = await db.select().from(users).where(eq(users.id, userId(req)));
    if (!u) throw new HttpError(401, 'Session expirée. Veuillez vous reconnecter.');
    return { user: toUser(u) };
  });

  app.patch('/account', { preHandler: app.authenticate }, async (req) => {
    const body = parse(
      z.object({
        firstName: z.string().trim().max(60).nullish(),
        lastName: z.string().trim().max(60).nullish(),
        pseudo: z.string().trim().max(40).nullish(),
        clubName: z.string().trim().max(120).nullish(),
        usageMode: z.enum(['private', 'association']).optional(),
        rakeEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    const clean = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));
    const [u] = await db.update(users).set(clean).where(eq(users.id, userId(req))).returning();
    return { user: toUser(u) };
  });

  app.post('/account/password', { preHandler: app.authenticate }, async (req) => {
    const body = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(6, 'Mot de passe trop court (min 6 car.)').max(200) }), req.body);
    const [u] = await db.select().from(users).where(eq(users.id, userId(req)));
    if (!(await bcrypt.compare(body.currentPassword, u.passwordHash))) throw bad('Mot de passe actuel incorrect.');
    await db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(body.newPassword, 10) })
      .where(eq(users.id, u.id));
    return { ok: true };
  });
}
