import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ClockState,
  Level,
  Move,
  MysteryState,
  PayoutConfig,
  ThemeConfig,
  TournamentSettings,
} from '@pokerorga/shared';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const num = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  pseudo: text('pseudo'),
  clubName: text('club_name'),
  usageMode: text('usage_mode').$type<'private' | 'association'>().notNull().default('private'),
  rakeEnabled: boolean('rake_enabled').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tournaments = pgTable(
  'tournaments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').$type<'prepared' | 'running' | 'finished'>().notNull().default('prepared'),
    settings: jsonb('settings').$type<TournamentSettings>().notNull(),
    structure: jsonb('structure').$type<Level[]>().notNull(),
    payouts: jsonb('payouts').$type<PayoutConfig>().notNull(),
    theme: jsonb('theme').$type<ThemeConfig>().notNull(),
    clock: jsonb('clock').$type<ClockState>().notNull(),
    mystery: jsonb('mystery').$type<MysteryState>().notNull(),
    pendingMoves: jsonb('pending_moves').$type<Move[]>().notNull().default([]),
    /** Tournois partageant le même timer et la même structure. */
    clockGroupId: uuid('clock_group_id'),
    publicToken: text('public_token').notNull().unique(),
    version: integer('version').notNull().default(1),
    exportedChampionshipIds: jsonb('exported_championship_ids').$type<string[]>().notNull().default([]),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('tournaments_owner_idx').on(t.ownerId, t.status)],
);

export const tournamentTables = pgTable(
  'tournament_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    locked: boolean('locked').notNull().default(false),
    isFinal: boolean('is_final').notNull().default(false),
  },
  (t) => [uniqueIndex('tables_tournament_number_uq').on(t.tournamentId, t.number)],
);

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    pseudo: text('pseudo').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    status: text('status').$type<'active' | 'eliminated'>().notNull().default('active'),
    tableNumber: integer('table_number'),
    seatNumber: integer('seat_number'),
    seatLocked: boolean('seat_locked').notNull().default(false),
    entries: integer('entries').notNull().default(1),
    rebuys: integer('rebuys').notNull().default(0),
    addons: integer('addons').notNull().default(0),
    kills: integer('kills').notNull().default(0),
    bountyValue: num('bounty_value').notNull().default(0),
    bountyWon: num('bounty_won').notNull().default(0),
    eliminatedBy: uuid('eliminated_by'),
    eliminatedAt: ts('eliminated_at'),
    finishRank: integer('finish_rank'),
    prizeAmount: num('prize_amount'),
    prizeLabel: text('prize_label'),
    present: boolean('present').notNull().default(false),
    registrationId: uuid('registration_id'),
    memberId: uuid('member_id'),
    sngGroup: integer('sng_group'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('players_tournament_idx').on(t.tournamentId),
    uniqueIndex('players_tournament_pseudo_uq').on(t.tournamentId, sql`lower(${t.pseudo})`),
  ],
);

export const playerActions = pgTable(
  'player_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    undoneAt: ts('undone_at'),
  },
  (t) => [index('actions_tournament_idx').on(t.tournamentId, t.playerId)],
);

export const favoriteStructures = pgTable('favorite_structures', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  levels: jsonb('levels').$type<Level[]>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const favoriteConfigs = pgTable('favorite_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<TournamentSettings>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'logo' | 'background' | 'sound'>().notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const championships = pgTable('championships', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').$type<'mtt' | 'sng'>().notNull().default('mtt'),
  bestResults: integer('best_results'),
  /** Championnat SnG : points par place (index 0 = 1er). Vide = formule standard. */
  pointsGrid: jsonb('points_grid').$type<number[]>().notNull().default([]),
  archived: boolean('archived').notNull().default(false),
  published: boolean('published').notNull().default(false),
  publicToken: text('public_token').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const championshipPlayers = pgTable(
  'championship_players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    championshipId: uuid('championship_id')
      .notNull()
      .references(() => championships.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('champ_players_name_uq').on(t.championshipId, sql`lower(${t.name})`)],
);

export const championshipImports = pgTable('championship_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  championshipId: uuid('championship_id')
    .notNull()
    .references(() => championships.id, { onDelete: 'cascade' }),
  tournamentId: uuid('tournament_id'),
  tournamentName: text('tournament_name').notNull(),
  entries: integer('entries').notNull(),
  playedAt: ts('played_at'),
  importedAt: ts('imported_at').notNull().defaultNow(),
  cancelledAt: ts('cancelled_at'),
});

export const championshipResults = pgTable('championship_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id')
    .notNull()
    .references(() => championshipImports.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id')
    .notNull()
    .references(() => championshipPlayers.id, { onDelete: 'cascade' }),
  rank: integer('rank').notNull(),
  points: numeric('points', { precision: 8, scale: 1, mode: 'number' }).notNull(),
  kills: integer('kills').notNull().default(0),
});

export const championshipBonuses = pgTable('championship_bonuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  championshipId: uuid('championship_id')
    .notNull()
    .references(() => championships.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id')
    .notNull()
    .references(() => championshipPlayers.id, { onDelete: 'cascade' }),
  points: numeric('points', { precision: 8, scale: 1, mode: 'number' }).notNull(),
  justification: text('justification').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  cancelledAt: ts('cancelled_at'),
});

export interface EventOption {
  id: string;
  label: string;
}

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').$type<'classic'>().notNull().default('classic'),
  eventDate: date('event_date', { mode: 'string' }),
  eventTime: text('event_time'),
  location: text('location'),
  capacity: integer('capacity'),
  maxPerTable: integer('max_per_table').notNull().default(10),
  startStack: integer('start_stack').notNull().default(10000),
  financialMode: text('financial_mode').$type<'money' | 'lots' | 'free'>().notNull().default('money'),
  buyin: num('buyin').notNull().default(0),
  description: text('description'),
  options: jsonb('options').$type<EventOption[]>().notNull().default([]),
  status: text('status').$type<'draft' | 'open' | 'closed' | 'imported'>().notNull().default('draft'),
  publicToken: text('public_token').notNull().unique(),
  tournamentId: uuid('tournament_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    pseudo: text('pseudo').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    answers: jsonb('answers').$type<Record<string, 'yes' | 'no' | 'unknown'>>().notNull().default({}),
    status: text('status').$type<'pending' | 'validated' | 'waitlist' | 'refused' | 'cancelled'>().notNull().default('pending'),
    present: boolean('present').notNull().default(false),
    code: text('code').unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('registrations_event_pseudo_uq').on(t.eventId, sql`lower(${t.pseudo})`)],
);

// ---------------- Mon club ----------------
export interface ClubRole {
  id: string;
  name: string;
  color: string;
}

export const clubs = pgTable('clubs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  city: text('city'),
  description: text('description'),
  logoAssetId: uuid('logo_asset_id'),
  roles: jsonb('roles').$type<ClubRole[]>().notNull().default([]),
  published: boolean('published').notNull().default(false),
  publicToken: text('public_token').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const clubSeasons = pgTable('club_seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startsOn: date('starts_on', { mode: 'string' }),
  endsOn: date('ends_on', { mode: 'string' }),
  open: boolean('open').notNull().default(true),
  duesAmount: num('dues_amount').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const clubMembers = pgTable(
  'club_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    pseudo: text('pseudo').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    note: text('note'),
    membershipType: text('membership_type').$type<'live' | 'online' | 'both'>().notNull().default('live'),
    roleIds: jsonb('role_ids').$type<string[]>().notNull().default([]),
    code: text('code').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('club_members_pseudo_uq').on(t.clubId, sql`lower(${t.pseudo})`)],
);

export const clubMemberships = pgTable(
  'club_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => clubMembers.id, { onDelete: 'cascade' }),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => clubSeasons.id, { onDelete: 'cascade' }),
    exempt: boolean('exempt').notNull().default(false),
    duesExpected: num('dues_expected').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('club_memberships_uq').on(t.memberId, t.seasonId)],
);

export const clubPayments = pgTable('club_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => clubMembers.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id')
    .notNull()
    .references(() => clubSeasons.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'dues' | 'donation'>().notNull(),
  amount: num('amount').notNull(),
  method: text('method').$type<'cash' | 'check' | 'transfer' | 'helloasso' | 'other'>().notNull().default('cash'),
  paidOn: date('paid_on', { mode: 'string' }).notNull(),
  note: text('note'),
  cancelledAt: ts('cancelled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const clubRequests = pgTable('club_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  seasonId: uuid('season_id').references(() => clubSeasons.id, { onDelete: 'set null' }),
  pseudo: text('pseudo').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  phone: text('phone'),
  message: text('message'),
  membershipType: text('membership_type').$type<'live' | 'online' | 'both'>().notNull().default('live'),
  status: text('status').$type<'pending' | 'accepted' | 'refused'>().notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
