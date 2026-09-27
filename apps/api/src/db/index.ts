import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env';
import * as schema from './schema';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export { schema };

function migrationsFolder(): string {
  if (env.MIGRATIONS_DIR) return env.MIGRATIONS_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const c of [resolve(here, '../drizzle'), resolve(here, '../../drizzle'), resolve(process.cwd(), 'drizzle')]) {
    if (existsSync(c)) return c;
  }
  throw new Error('Dossier des migrations introuvable');
}

export async function runMigrations(retries = 20): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await migrate(db, { migrationsFolder: migrationsFolder() });
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (i < retries && (code === 'ECONNREFUSED' || code === '57P03' || code === 'ENOTFOUND')) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw e;
    }
  }
}
