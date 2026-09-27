// Lance un PostgreSQL local embarqué (sans Docker) pour le développement.
// Usage : npm run dev:db  → postgres://pokerorga:pokerorga@localhost:5432/pokerorga
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.cwd(), '.dev-pgdata');
const port = Number(process.env.DEV_DB_PORT ?? 5432);
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'pokerorga',
  password: 'pokerorga',
  port,
  persistent: true,
});

const fresh = !existsSync(dir);
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('pokerorga');
console.log(`PostgreSQL prêt : postgres://pokerorga:pokerorga@localhost:${port}/pokerorga`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
