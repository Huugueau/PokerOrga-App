import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Ressource introuvable.') => new HttpError(404, what);
export const bad = (msg: string) => new HttpError(400, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Ne garde que les clés réellement envoyées ; `nested` : sous-objets eux-mêmes partiels à filtrer aussi. */
function onlySent<T>(parsed: T, raw: unknown, nested: string[] = []): T {
  if (!isPlain(parsed) || !isPlain(raw)) return parsed;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) if (k in raw) out[k] = nested.includes(k) ? onlySent(v, raw[k]) : v;
  return out as T;
}

/**
 * Parse d'une modification partielle : zod 4 applique les `.default()` même dans un `.partial()`,
 * ce qui écraserait les champs non envoyés. On ne conserve donc que les clés présentes dans la requête.
 */
export function parsePatch<T extends ZodType>(schema: T, data: unknown, nested: string[] = []): z.infer<T> {
  return onlySent(schema.parse(data), data, nested);
}

export function zodMessage(e: ZodError): string {
  const issue = e.issues[0];
  if (!issue) return 'Données invalides.';
  if (issue.message && !issue.message.startsWith('Invalid') && !issue.message.startsWith('Too')) return issue.message;
  return `Champ invalide : ${issue.path.join('.') || 'données'}.`;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function publicToken(len = 24): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function userId(req: FastifyRequest): string {
  return (req.user as { id: string }).id;
}

export function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]+/g, '_')}"`)
    .send(csv);
}

/** Bus d'événements temps réel (instance unique). */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishTournament(id: string, version: number) {
  bus.emit(`t:${id}`, { type: 'tournament', id, version });
}

export const idParam = z.object({ id: z.string().uuid() });
