import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { settingsSchema, structureSchema } from '@pokerorga/shared';
import { z } from 'zod';
import { db, schema } from '../db';
import { idParam, notFound, parse, userId } from '../lib';

const { favoriteStructures, favoriteConfigs, assets } = schema;
const name = z.string().trim().min(1).max(60);

export async function favoriteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // structures
  app.get('/favorites/structures', async (req) => ({
    items: await db.select().from(favoriteStructures).where(eq(favoriteStructures.ownerId, userId(req))).orderBy(desc(favoriteStructures.createdAt)),
  }));
  app.post('/favorites/structures', async (req) => {
    const body = parse(z.object({ name, levels: structureSchema }), req.body);
    const [row] = await db.insert(favoriteStructures).values({ ownerId: userId(req), ...body }).returning();
    return row;
  });
  app.patch('/favorites/structures/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name: name.optional(), levels: structureSchema.optional() }), req.body);
    const [row] = await db
      .update(favoriteStructures)
      .set(body)
      .where(and(eq(favoriteStructures.id, id), eq(favoriteStructures.ownerId, userId(req))))
      .returning();
    if (!row) throw notFound();
    return row;
  });
  app.delete('/favorites/structures/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await db.delete(favoriteStructures).where(and(eq(favoriteStructures.id, id), eq(favoriteStructures.ownerId, userId(req))));
    return { ok: true };
  });

  // configurations
  app.get('/favorites/configs', async (req) => ({
    items: await db.select().from(favoriteConfigs).where(eq(favoriteConfigs.ownerId, userId(req))).orderBy(desc(favoriteConfigs.createdAt)),
  }));
  app.post('/favorites/configs', async (req) => {
    const body = parse(z.object({ name, settings: settingsSchema }), req.body);
    const [row] = await db.insert(favoriteConfigs).values({ ownerId: userId(req), ...body }).returning();
    return row;
  });
  app.patch('/favorites/configs/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name }), req.body);
    const [row] = await db
      .update(favoriteConfigs)
      .set(body)
      .where(and(eq(favoriteConfigs.id, id), eq(favoriteConfigs.ownerId, userId(req))))
      .returning();
    if (!row) throw notFound();
    return row;
  });
  app.delete('/favorites/configs/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await db.delete(favoriteConfigs).where(and(eq(favoriteConfigs.id, id), eq(favoriteConfigs.ownerId, userId(req))));
    return { ok: true };
  });

  // assets (upload)
  app.post('/assets', async (req) => {
    const file = await req.file();
    if (!file) throw notFound('Aucun fichier.');
    const kind = z.enum(['logo', 'background', 'sound']).parse((file.fields.kind as { value?: string } | undefined)?.value);
    const buf = await file.toBuffer();
    const okMime =
      kind === 'sound'
        ? /^audio\/(mpeg|mp3|wav|x-wav|wave|mp4|x-m4a|m4a|aac)$/.test(file.mimetype)
        : /^image\/(png|jpeg|jpg|svg\+xml|webp|gif)$/.test(file.mimetype);
    if (!okMime) throw Object.assign(new Error('Format non pris en charge.'), { statusCode: 400 });
    const [row] = await db
      .insert(assets)
      .values({ ownerId: userId(req), kind, mime: file.mimetype, size: buf.length, data: buf })
      .returning({ id: assets.id });
    return { id: row.id };
  });
  app.delete('/assets/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    await db.delete(assets).where(and(eq(assets.id, id), eq(assets.ownerId, userId(req))));
    return { ok: true };
  });
}
