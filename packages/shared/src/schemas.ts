import { z } from 'zod';

const money = z.number().min(0).max(1_000_000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const bountySchema = z.object({
  type: z.enum(['none', 'fixed', 'progressive', 'mystery']),
  amount: money,
  drawFrom: z.number().int().min(1).max(10000).nullable(),
});

export const settingsSchema = z.object({
  entryFormat: z.enum(['freezeout', 'reentry', 'rebuys']),
  reentryLimit: z.number().int().min(-1).max(100),
  rebuyLimit: z.number().int().min(-1).max(100).default(-1),
  addonsEnabled: z.boolean(),
  addonCost: money,
  addonStack: z.number().int().min(0).max(100_000_000),
  rebuyCost: money.nullable(),
  rebuyStack: z.number().int().min(0).max(100_000_000).nullable(),
  startStack: z.number().int().min(1).max(100_000_000),
  buyin: money,
  isFree: z.boolean(),
  rake: money,
  hidePayout: z.boolean(),
  trackKills: z.boolean(),
  maxPerTable: z.number().int().min(2).max(10),
  finalTableSize: z.number().int().min(2).max(10),
  autoBalance: z.boolean(),
  breakTablesHighToLow: z.boolean(),
  bounty: bountySchema,
  showLocalClock: z.boolean(),
  multiSng: z.boolean().default(false),
});

export const levelSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['level', 'break']),
  sb: z.number().min(0).max(1e10),
  bb: z.number().min(0).max(1e10),
  ante: z.number().min(0).max(1e10),
  minutes: z.number().int().min(1).max(600),
  lateRegEnd: z.boolean(),
});

export const structureSchema = z.array(levelSchema).min(1).max(200);

export const payoutsSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  type: z.enum(['money', 'lots']),
  amounts: z.array(money).max(200),
  lots: z.array(z.string().max(200)).max(200),
});

export const themeSchema = z.object({
  primary: color,
  secondary: color,
  title: color,
  glassOpacity: z.number().min(0).max(1),
  glassBlur: z.number().min(0).max(40),
  font: z.enum(['Inter', 'Oswald', 'Oxanium', 'Montserrat', 'Roboto', 'Lato']),
  backgroundAssetId: z.string().uuid().nullable(),
  logoAssetId: z.string().uuid().nullable(),
  sounds: z.object({
    start: z.string().uuid().nullable(),
    warning60: z.string().uuid().nullable(),
    levelEnd: z.string().uuid().nullable(),
  }),
});

export const tournamentPatchSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  settings: settingsSchema.partial().optional(),
  structure: structureSchema.optional(),
  payouts: payoutsSchema.optional(),
  theme: themeSchema.partial().optional(),
});

export const playerInputSchema = z.object({
  sngGroup: z.number().int().min(1).max(100).optional(),
  pseudo: z.string().trim().min(1, 'Le pseudo est obligatoire.').max(40),
  firstName: z.string().trim().max(60).nullish(),
  lastName: z.string().trim().max(60).nullish(),
  /** Lien vers un adhérent du club / un compte joueur (choisi via la recherche). */
  memberId: z.string().uuid().nullish(),
  playerAccountId: z.string().uuid().nullish(),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide.'),
  password: z.string().min(6, 'Mot de passe trop court (min 6 car.)').max(200),
  acceptTerms: z.literal(true, { message: 'Vous devez accepter les CGU pour vous inscrire.' }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide.'),
  password: z.string().min(1).max(200),
});
