import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://pokerorga:pokerorga@localhost:5432/pokerorga'),
  JWT_SECRET: z.string().min(16).default('dev-secret-change-me-please-0123456789'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  ALLOW_REGISTRATION: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  WEB_DIST: z.string().optional(),
  MIGRATIONS_DIR: z.string().optional(),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
