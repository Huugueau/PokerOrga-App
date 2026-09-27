import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { runMigrations, pool } from './db';
import { env, isProd } from './env';
import { HttpError, zodMessage } from './lib';
import { authRoutes, COOKIE } from './routes/auth';
import { championshipRoutes } from './routes/championships';
import { checkinRoutes } from './routes/checkin';
import { clubRoutes } from './routes/club';
import { flightRoutes } from './routes/flights';
import { playerAccountRoutes } from './routes/playerAccount';
import { eventRoutes } from './routes/events';
import { favoriteRoutes } from './routes/favorites';
import { historyRoutes } from './routes/history';
import { playerRoutes } from './routes/players';
import { publicRoutes } from './routes/public';
import { tournamentRoutes } from './routes/tournaments';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: isProd ? { level: 'info' } : { level: 'warn' },
    bodyLimit: 3 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: COOKIE, signed: false } });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Session expirée. Veuillez vous reconnecter.');
    }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Server-Time', String(Date.now()));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: zodMessage(err) });
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ error: 'Fichier trop volumineux (> 2 Mo).' });
    if (e.code === '23505') return reply.status(409).send({ error: 'Cette valeur existe déjà.' });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Une erreur est survenue.' });
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, time: Date.now() }));
      await api.register(authRoutes);
      await api.register(publicRoutes);
      await api.register(tournamentRoutes);
      await api.register(playerRoutes);
      await api.register(favoriteRoutes);
      await api.register(historyRoutes);
      await api.register(championshipRoutes);
      await api.register(eventRoutes);
      await api.register(clubRoutes);
      await api.register(checkinRoutes);
      await api.register(flightRoutes);
      await api.register(playerAccountRoutes);
    },
    { prefix: '/api' },
  );

  // Front statique (production)
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = env.WEB_DIST ?? [resolve(here, '../../web/dist'), resolve(here, '../web/dist')].find((p) => existsSync(p));
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Route introuvable.' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runMigrations();
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  console.log(`PokerOrga API démarrée sur http://localhost:${env.PORT}`);
  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
