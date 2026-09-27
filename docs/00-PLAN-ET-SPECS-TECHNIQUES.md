# PokerOrga — Plan de réalisation & spécifications techniques

> **Document principal du projet.** Il décrit l'architecture, le modèle de données, l'API, les algorithmes métier et le découpage en phases.
> L'analyse de l'outil de référence (Poker Home Games) est dans [01-ANALYSE-FONCTIONNELLE.md](01-ANALYSE-FONCTIONNELLE.md).

---

## 1. Objectif & périmètre

Construire **PokerOrga**, un outil auto-hébergé d'organisation de tournois de poker, en français, inspiré de Poker Home Games, sans forfaits ni paiement (toutes les fonctions débloquées).

### Dans le périmètre V1
- Comptes organisateurs multiples (email + mot de passe), profil, cadre Privé / Club associatif.
- Timer de tournoi synchronisé en temps réel entre appareils (PC, TV, téléphone), mode TV, plein écran, sons, raccourcis clavier.
- Réglages du tournoi : format (freezeout / re-entry / recaves + add-on), stack, buy-in, gratuit, rake, masquer le payout, comptage des kills, tables (taille, table finale, équilibrage auto, casse décroissante), bounty (fixe, progressif, mystery), configurations favorites.
- Joueurs : ajout, import CSV/TXT, édition, suppression, élimination (éliminateur), annulation, re-entry, recave, add-on, tirage des sièges, redraw, tables, verrouillages, équilibrage, déplacement / inversion, plan des tables public.
- Éditeur de structure (niveaux, pauses, late reg, glisser-déposer), générateur, import CSV, structures favorites.
- Places payées : répartition automatique, manuelle, lots.
- Résultats : classement final, export CSV, envoi vers championnat.
- Historique des tournois terminés.
- Championnats : points automatiques, jokers, bonus, fusion, annulation d'import, classement public.
- Planning : événements avec page d'inscription publique, validation / liste d'attente / présence, import dans un tournoi.
- Personnalisation du timer : couleurs, verre, police, image de fond, logo, sons personnalisés.
- Déploiement portable : `docker compose up`.

### Hors périmètre V1 (évolutions possibles)
Multi Sit-and-Go, tournois flights, module Mon club (adhérents, cotisations, cartes QR), scan QR, connexion Google, emails transactionnels (confirmation / mot de passe oublié), forfaits & Stripe, console super-admin, avis & support.

---

## 2. Stack technique

| Couche | Choix | Justification |
|---|---|---|
| Front | **React 19 + Vite + TypeScript + Tailwind CSS 3** | Demandé ; SPA |
| Routage front | react-router-dom v7 | Standard |
| Données front | TanStack Query v5 + client `fetch` typé | Cache, invalidation |
| Glisser-déposer | @dnd-kit/core + sortable | Éditeur de structure |
| Back | **Node 22 + Fastify 5 + TypeScript** | Même langage que le front, rapide |
| Validation | zod (partagé front/back) | Schémas uniques |
| ORM / migrations | Drizzle ORM + drizzle-kit, driver `pg` | SQL explicite, migrations versionnées |
| Base | **PostgreSQL 16** | Demandé |
| Auth | JWT (@fastify/jwt) en cookie httpOnly + bcryptjs | Simple, sans service externe |
| Temps réel | **Server-Sent Events** (bus d'événements en mémoire) | Unidirectionnel suffisant, zéro dépendance |
| Fichiers | Stockés en base (`bytea`, table `assets`) | Portabilité totale : un seul volume (Postgres) |
| Tests | Vitest (logique métier partagée + API) | |
| Conteneurs | Docker multi-stage ; compose : `app` + `db` | Portable |

---

## 3. Architecture

```
PokerOrgaApp/
├─ docker-compose.yml          # app + db (production portable)
├─ docker-compose.dev.yml      # db seule pour le dev local
├─ Dockerfile                  # build multi-stage (web + api) → image unique
├─ .env.example
├─ package.json                # npm workspaces
├─ packages/
│  └─ shared/                  # logique métier pure + types + schémas zod
│     └─ src/{types,schemas,clock,payouts,prizepool,seating,balancing,generator,championship,csv,defaults}.ts
├─ apps/
│  ├─ api/                     # Fastify
│  │  ├─ src/{server,env,db/,auth/,routes/,services/,realtime/}
│  │  └─ drizzle/              # migrations SQL générées
│  └─ web/                     # React
│     └─ src/{main,App,api/,components/,features/{auth,timer,settings,players,structure,payouts,theme,history,championships,planning,account,public}/,hooks/,lib/}
└─ docs/
```

- **Une seule image** `app` : Fastify sert l'API sous `/api/*` et le build statique du front (fallback SPA vers `index.html`). Port par défaut **8080**.
- `packages/shared` est consommé en source TypeScript par Vite (front) et bundlé par **tsup** dans l'API.
- Les migrations Drizzle sont appliquées automatiquement au démarrage de l'API.

### 3.1 Temps réel
- `GET /api/tournaments/:id/stream` (SSE, authentifié) et `GET /api/public/plan/:token/stream` (public).
- Chaque mutation d'un tournoi incrémente `tournaments.version` et publie `{type:"tournament", id, version}` sur un `EventEmitter` en mémoire ; les clients SSE reçoivent l'événement et **refetch** le snapshot (`GET /api/tournaments/:id/full`).
- Heartbeat SSE toutes les 25 s. Reconnexion automatique côté navigateur (`EventSource`).
- **Horloge** : chaque réponse API porte l'en-tête `X-Server-Time` (ms epoch) ; le client calcule un offset (moyenne glissante) et affiche le timer à partir de l'état serveur + offset. Aucun tic serveur n'est nécessaire (voir §6.1).

### 3.2 Sécurité
- Cookie `po_session` : httpOnly, SameSite=Lax, `Secure` si `COOKIE_SECURE=true`, durée 30 jours.
- Toutes les ressources sont filtrées par `owner_id` = utilisateur courant.
- Les vues publiques utilisent des **jetons aléatoires** (`public_token`, 24 caractères base62) révocables (régénérés à la réinitialisation / fin du tournoi).
- Limite de taille des uploads : 2 Mo (images PNG/JPG/SVG/WebP, sons MP3/WAV/M4A).
- Inscription ouverte contrôlée par `ALLOW_REGISTRATION` (défaut `true`).

---

## 4. Modèle de données (PostgreSQL)

Toutes les clés primaires sont des `uuid` (`gen_random_uuid()`), horodatages `timestamptz`.

### 4.1 `users`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text unique | minuscule |
| password_hash | text | bcrypt |
| first_name, last_name, pseudo | text null | |
| club_name | text null | |
| usage_mode | text | `private` \| `association` |
| rake_enabled | bool | défaut false |
| created_at | timestamptz | |

### 4.2 `tournaments`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| owner_id | uuid FK users | cascade |
| title | text | défaut « Tournoi entre amis » |
| status | text | `prepared` \| `running` \| `finished` |
| settings | jsonb | `TournamentSettings` (§5.1) |
| structure | jsonb | `Level[]` (§5.2) |
| payouts | jsonb | `PayoutConfig` (§5.3) |
| theme | jsonb | `ThemeConfig` (§5.4) |
| clock | jsonb | `ClockState` (§6.1) |
| mystery | jsonb | `MysteryState` (§6.7) |
| pending_moves | jsonb | déplacements d'équilibrage appliqués, en attente d'acquittement (bannière timer) |
| public_token | text unique | plan des tables |
| version | int | incrémenté à chaque mutation |
| started_at, finished_at | timestamptz null | |
| exported_championship_ids | uuid[] | |
| created_at, updated_at | timestamptz | |

Un tournoi `finished` constitue l'**historique** (lecture seule).

### 4.3 `tournament_tables`
id, tournament_id FK (cascade), number int, locked bool, is_final bool — unique (tournament_id, number).

### 4.4 `players`
| Colonne | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tournament_id | uuid FK | cascade |
| pseudo | text | unique par tournoi (insensible à la casse) |
| first_name, last_name | text null | |
| status | text | `active` \| `eliminated` |
| table_number, seat_number | int null | |
| seat_locked | bool | |
| entries | int | 1 + nombre de re-entries |
| rebuys, addons | int | |
| kills | int | |
| bounty_value | numeric | prime actuelle sur la tête |
| bounty_won | numeric | primes encaissées |
| eliminated_by | uuid null | joueur |
| eliminated_at | timestamptz null | |
| finish_rank | int null | place finale |
| prize_amount | numeric null | gain monétaire |
| prize_label | text null | lot |
| present | bool | pointage (import planning) |
| registration_id | uuid null | lien planning |
| created_at | timestamptz | |

### 4.5 `player_actions` (journal & annulation)
id, tournament_id, player_id, type (`bust` \| `reentry` \| `rebuy` \| `addon` \| `move` \| `swap` \| `mystery_draw`), payload jsonb, created_at, undone_at. Sert à annuler la dernière recave / add-on / élimination et à produire les récaps.

### 4.6 Favoris
- `favorite_structures` : id, owner_id, name, levels jsonb, created_at.
- `favorite_configs` : id, owner_id, name, settings jsonb, created_at.

### 4.7 `assets`
id, owner_id, kind (`logo` \| `background` \| `sound`), mime, size, data bytea, created_at. Servi par `GET /api/assets/:id` (cache long, immuable).

### 4.8 Championnats
- `championships` : id, owner_id, name (≤ 30), type (`mtt` \| `sng`), best_results (int null = tous), archived bool, published bool, public_token, created_at.
- `championship_players` : id, championship_id, name — unique (championship_id, lower(name)).
- `championship_imports` : id, championship_id, tournament_id null, tournament_name, entries int, played_at, imported_at, cancelled_at null.
- `championship_results` : id, import_id, player_id (championship_players), rank, points numeric(8,1), kills int.
- `championship_bonuses` : id, championship_id, player_id, points numeric, justification text (≥ 3), created_at, cancelled_at null.

### 4.9 Planning
- `events` : id, owner_id, name, type (`classic`), event_date date null, event_time text null, location, capacity int null, max_per_table int, start_stack int, financial_mode (`money` \| `lots` \| `free`), buyin numeric, options jsonb (`{id,label}[]`), status (`draft` \| `open` \| `closed` \| `imported`), public_token, tournament_id null, created_at.
- `registrations` : id, event_id, pseudo, first_name, last_name, email, answers jsonb (`{optionId: "yes"|"no"|"unknown"}`), status (`pending` \| `validated` \| `waitlist` \| `refused` \| `cancelled`), present bool, created_at — unique (event_id, lower(pseudo)).

---

## 5. Types métier (packages/shared)

### 5.1 `TournamentSettings`
```ts
{
  entryFormat: 'freezeout' | 'reentry' | 'rebuys';
  reentryLimit: number;        // -1 = illimité
  addonsEnabled: boolean;      // uniquement avec rebuys
  addonCost: number; addonStack: number;
  rebuyCost: number | null;    // null = buy-in
  rebuyStack: number | null;   // null = stack de départ
  startStack: number;
  buyin: number;               // €
  isFree: boolean;             // aucune place payée
  rake: number;                // € prélevés par entrée (si rake activé)
  hidePayout: boolean;
  trackKills: boolean;
  maxPerTable: number;         // 2..10
  finalTableSize: number;      // 2..10
  autoBalance: boolean;
  breakTablesHighToLow: boolean;
  bounty: { type: 'none' | 'fixed' | 'progressive' | 'mystery'; amount: number; drawFrom: number | null };
  showLocalClock: boolean;
}
```
Défauts : freezeout, stack 10 000, buy-in 10 €, 10-max, table finale 10, équilibrage auto, casse décroissante, pas de bounty.

Règles : `rebuys` ⇒ bounty `none` ; bounty ≤ buy-in ; format/bounty verrouillés dès le démarrage (`status != prepared`) ; en cadre associatif : `isFree` ou payouts en lots, rake 0.

### 5.2 `Level`
```ts
{ id: string; kind: 'level' | 'break'; sb: number; bb: number; ante: number; minutes: number; lateRegEnd: boolean }
```
`lateRegEnd = true` : la late registration se termine **à la fin** de ce niveau/pause. Structure par défaut = celle de PHG (20 min, 50/100 → 6000/12000, BB ante dès 200/400, pauses de 10 min, late reg à la fin de la 2e pause).

### 5.3 `PayoutConfig`
```ts
{ mode: 'auto' | 'manual'; type: 'money' | 'lots'; amounts: number[]; lots: string[] }
```
En `auto` les montants sont recalculés à chaque changement du prize pool.

### 5.4 `ThemeConfig`
```ts
{ primary: string; secondary: string; title: string; glassOpacity: number; glassBlur: number;
  font: 'Inter'|'Oswald'|'Oxanium'|'Montserrat'|'Roboto'|'Lato';
  backgroundAssetId: string|null; logoAssetId: string|null;
  sounds: { enabled: boolean; start: string|null; warning60: string|null; levelEnd: string|null } } // asset ids
```
Volume et activation des sons sont aussi stockés localement par appareil (localStorage).

---

## 6. Algorithmes métier (packages/shared, testés unitairement)

### 6.1 Horloge (`clock.ts`)
État persistant :
```ts
ClockState = { levelIndex: number; running: boolean; remainingMs: number; anchorAt: number | null }
```
- En pause : `remainingMs` = temps restant du niveau `levelIndex`.
- En marche : `anchorAt` = instant serveur (ms) où le niveau `levelIndex` avait `remainingMs` restant.
- `resolveClock(state, levels, now)` → `{ levelIndex, remainingMs, finished }` : si en marche, on consomme `elapsed = now - anchorAt` en avançant de niveau en niveau (durées `minutes*60000`) ; au-delà du dernier niveau → `finished` (affichage « FIN »).
- Actions (serveur, après `resolveClock` au `now` serveur) : `play`, `pause`, `next`, `prev` (reset au début du niveau), `seek(remainingMs)`, `reset`.
- **Concurrence** : les actions `next/prev` portent le `levelIndex` attendu ; si le niveau résolu diffère → 409 « Le niveau a déjà changé sur un autre écran ».
- Dérivés : prochain niveau (non-pause), temps avant la prochaine pause, temps avant la fin de la late reg, late reg ouverte ?

### 6.2 Prize pool (`prizepool.ts`)
```
bountyShare = bounty.type ∈ {fixed, progressive, mystery} ? bounty.amount : 0
prizePool  = totalEntries × (buyin − bountyShare − rake)
           + totalRebuys × (rebuyCost − rake)
           + totalAddons × addonCost
bountyPool = totalEntries × bountyShare
chipsInPlay = totalEntries × startStack + totalRebuys × rebuyStack + totalAddons × addonStack
average = chipsInPlay / activePlayers
```
`isFree` ⇒ prizePool = 0.

### 6.3 Répartition automatique (`payouts.ts`)
Pourcentages par tranche d'entrées :

| Entrées | Places | Répartition % |
|---|---|---|
| 2–3 | 1 | 100 |
| 4–6 | 2 | 65 / 35 |
| 7–10 | 3 | 50 / 30 / 20 |
| 11–15 | 4 | 45 / 27 / 17 / 11 |
| 16–20 | 5 | 40 / 25 / 16 / 11 / 8 |
| 21–30 | 6 | 36 / 22 / 15 / 11 / 9 / 7 |
| 31–40 | 8 | 32 / 20 / 14 / 10 / 8 / 6.5 / 5.5 / 4 |
| 41–60 | 9 | 30 / 19 / 13 / 10 / 8 / 6.5 / 5.5 / 4.5 / 3.5 |
| > 60 | ≈ 15 % | décroissance géométrique (ratio 0,78) normalisée |

Arrondi : à l'unité (au multiple de 5 si prize pool ≥ 500) ; le reliquat est ajouté à la 1re place ; montants garantis décroissants.

### 6.4 Placement (`seating.ts`)
- **Tirage** : `nTables = ceil(n / maxPerTable)`, joueurs mélangés (Fisher-Yates, RNG injectable), répartis en round-robin, sièges aléatoires parmi `1..maxPerTable`. Les sièges verrouillés sont conservés.
- **Nouvel entrant / re-entry** : table ouverte la moins remplie (numéro le plus bas en cas d'égalité), siège libre aléatoire ; si tout est plein, ouverture d'une nouvelle table.

### 6.5 Équilibrage (`balancing.ts`)
Entrée : tables (numéro, verrouillée, finale), joueurs actifs placés, réglages. Sortie : liste ordonnée de `Move {playerId, from:{table,seat}, to:{table,seat}}`.
1. **Table finale** : si `actifs ≤ finalTableSize` et plus d'une table → tous vers la table finale (table marquée finale, sinon la plus basse non-cassée), nouveaux sièges tirés.
2. **Casse** : tant que `actifs ≤ (nbTables − 1) × maxPerTable`, casser la table au numéro le plus haut (ou le plus bas si `breakTablesHighToLow=false`) non verrouillée ; ses joueurs vont un par un vers la table la moins remplie.
3. **Égalisation** : tant que `max − min > 1`, déplacer un joueur non verrouillé de la table la plus remplie vers la moins remplie (siège libre aléatoire).
- `autoBalance=true` : les déplacements sont appliqués immédiatement et affichés sur le timer (bannière « ÉQUILIBRAGE NÉCESSAIRE », liste des déplacements, bouton « C'EST FAIT » qui acquitte).
- `autoBalance=false` : les déplacements sont proposés dans la gestion des joueurs (bouton « Équilibrer »).
- Aperçu dans les réglages : « À n joueurs restants, les tables seront à a vs b » et « fusion en table finale ».

### 6.6 Élimination, re-entry, recave, add-on
- **Élimination** : `status=eliminated`, `finish_rank = actifs avant élimination`, `eliminated_by`, `kills++` chez l'éliminateur ; bounty :
  - fixe : `bounty_won += victime.bounty_value` ;
  - progressif : `bounty_won += victime.bounty_value / 2`, `bounty_value(éliminateur) += victime.bounty_value / 2` ;
  - mystery : tirage d'enveloppe si `actifs ≤ drawFrom` (sinon bounty fixe « de base »).
  Quand il reste 1 joueur : `finish_rank = 1`, tournoi `finished`-able, le vainqueur encaisse sa propre prime.
  Attribution des gains (`prize_amount` / `prize_label`) selon `finish_rank`.
- **Re-entry** : autorisée si format `reentry`, late reg ouverte, limite non atteinte ; le joueur redevient actif, `entries++`, rang effacé, nouveau siège, bounty réinitialisée.
- **Recave** : format `rebuys` et late reg ouverte (joueur actif ou juste éliminé : il garde son siège), `rebuys++`.
- **Add-on** : `addons++` (une fois par joueur, à la pause de fin de late reg recommandée — non bloquant).
- **Annulations** : annuler la dernière élimination (le joueur retrouve son siège s'il est libre, sinon placement), annuler recave / add-on (décrément), via `player_actions`.

### 6.7 Mystery bounty (`mystery.ts`)
- `bountyPool = entrées × part enveloppes`. Grille auto : `nb enveloppes = nombre de joueurs payés au bounty` (par défaut `min(entrées, max(4, round(entrées/2)))`), répartition en groupes Top (1 × 25 %), High, Mid, Low, Min, sommes arrondies, total = bountyPool.
- **Figement** automatique à la fin de la late reg (ou manuel) ; défigement impossible après le premier tirage.
- Tirage aléatoire (sans remise) à chaque élimination quand `actifs ≤ drawFrom` ; animation à l'écran « Ouvrir l'enveloppe ».

### 6.8 Générateur de structure (`generator.ts`)
Entrées : joueurs N, stack S, durée H (h), niveau L (min), plus petit jeton c, ante (bool), pause tous les k niveaux (10 min).
1. `nLevels = floor(H×60 / (L + 10/k))`.
2. `BB0` = valeur « ronde » ≥ `2c` la plus proche de `S/100` ; `BBend = N×S / 20` (≈ 10 BB de moyenne à 2 joueurs).
3. Progression géométrique `BB_i = BB0 × (BBend/BB0)^(i/(nLevels−1))`, chaque valeur arrondie à l'échelle ronde {1, 1.5, 2, 2.5, 3, 4, 5, 6, 8} × 10ᵏ, multiple de `2c`, strictement croissante ; `SB = BB/2` (arrondi au jeton).
4. Ante = BB à partir du niveau `ceil(nLevels/3)` si activé.
5. Pause tous les k niveaux ; `lateRegEnd` sur la pause la plus proche de 40 % de la durée.
Résumé : départ (BB, profondeur S/BB0), fin estimée (BB), durée de jeu estimée, profondeur moyenne finale.

### 6.9 Championnat (`championship.ts`)
- Points d'un résultat : `round1(10 × √(entrées / rang))`.
- Total joueur : somme des `best_results` meilleurs résultats (tous si null) + bonus non annulés.
- Classement : points desc, puis kills desc, puis nom. Évolution de place = rang actuel vs rang avant le dernier import.
- Import d'un tournoi : un tournoi ne peut être importé qu'une fois par championnat ; joueurs rapprochés par pseudo (insensible à la casse) ; tous les joueurs doivent avoir un rang (tournoi terminé).
- Fusion : réaffecte résultats et bonus du joueur fusionné vers le joueur conservé, puis le supprime.

### 6.10 CSV (`csv.ts`)
- Joueurs : en-tête `pseudo;prenom;nom` (séparateur `;` ou `,` détecté), ou TXT une ligne = un pseudo ; doublons ignorés et signalés ; max 500 lignes ; `.xlsx` refusé.
- Structure : en-tête `type;sb;bb;ante;duree` (`type` ∈ `niveau|pause`), validations : valeurs ≥ 0, durée ≥ 1, max 100 lignes.
- Export résultats : `place;pseudo;prenom;nom;entrees;recaves;addons;kills;elimine_par;gain`.
- Export préinscrits : `pseudo;prenom;nom;email;statut;present;<options…>`.

---

## 7. API REST (`/api`)

Réponses JSON ; erreurs `{ error: string }` avec code HTTP ; messages en français.

### Auth & compte
| Méthode | Route | Description |
|---|---|---|
| POST | /auth/register | email, password (≥ 6), acceptTerms → crée + connecte |
| POST | /auth/login | email, password |
| POST | /auth/logout | |
| GET | /auth/me | utilisateur courant |
| PATCH | /account | profil (prénom, nom, pseudo, club, usage_mode, rake_enabled) |
| POST | /account/password | currentPassword, newPassword |

### Tournois
| Méthode | Route | Description |
|---|---|---|
| GET | /tournaments | lives en cours (non terminés) de l'utilisateur |
| POST | /tournaments | nouveau tournoi (défauts, ou `fromConfigId`) |
| GET | /tournaments/:id/full | snapshot complet : tournoi + tables + joueurs + dérivés |
| PATCH | /tournaments/:id | title, settings, structure, payouts, theme (validation zod + règles de verrouillage) |
| POST | /tournaments/:id/clock | `{action: play\|pause\|next\|prev\|seek\|reset, expectedLevel?, remainingMs?}` |
| POST | /tournaments/:id/reset | remise à zéro (joueurs, structure par défaut, chrono) |
| POST | /tournaments/:id/finish | archive (historique) + crée un tournoi vierge ; renvoie le nouvel id |
| DELETE | /tournaments/:id | uniquement si aucun joueur |
| GET | /tournaments/:id/stream | SSE |
| GET | /tournaments/:id/export.csv | CSV résultats |
| POST | /tournaments/:id/public-token | régénère le lien du plan des tables |

### Joueurs & tables
| Méthode | Route | Description |
|---|---|---|
| POST | /tournaments/:id/players | `{pseudo, firstName?, lastName?, override?}` (placement auto si tournoi placé) |
| POST | /tournaments/:id/players/import | `{rows:[{pseudo,firstName,lastName}]}` → `{added, skipped}` |
| PATCH | /tournaments/:id/players/:pid | identité, seat_locked |
| DELETE | /tournaments/:id/players/:pid | |
| POST | /tournaments/:id/players/:pid/bust | `{eliminatedBy?, reentry?:boolean}` |
| POST | /tournaments/:id/players/:pid/undo-bust | |
| POST | /tournaments/:id/players/:pid/reentry | |
| POST | /tournaments/:id/players/:pid/rebuy \| /addon \| /undo-rebuy \| /undo-addon | |
| POST | /tournaments/:id/players/:pid/move | `{table, seat}` (si occupé → inversion) |
| POST | /tournaments/:id/players/:pid/present | bascule présence |
| POST | /tournaments/:id/seating/draw | tirage / retirage |
| POST | /tournaments/:id/seating/balance | applique les déplacements proposés |
| POST | /tournaments/:id/seating/ack | acquitte la bannière d'équilibrage |
| POST | /tournaments/:id/tables | ajoute une table |
| PATCH | /tournaments/:id/tables/:n | locked, is_final |
| DELETE | /tournaments/:id/tables/:n | si vide |

### Mystery
| POST | /tournaments/:id/mystery/freeze \| /unfreeze \| /regenerate | |
|---|---|---|
| PATCH | /tournaments/:id/mystery | édition des enveloppes |

### Favoris, assets
- `GET/POST/PATCH/DELETE /favorites/structures[/:id]`, `GET/POST/PATCH/DELETE /favorites/configs[/:id]`.
- `POST /assets` (multipart, kind) → `{id}` ; `GET /assets/:id` (public, cache immuable) ; `DELETE /assets/:id`.

### Historique
- `GET /history?q=` (tournois terminés), `GET /history/:id` (récap), `DELETE /history/:id`.

### Championnats
- `GET/POST /championships`, `GET/PATCH/DELETE /championships/:id` (name, best_results, archived, published).
- `POST /championships/:id/import` `{tournamentId}` ; `DELETE /championships/:id/imports/:importId` (annule).
- `POST /championships/:id/bonuses` ; `DELETE /championships/:id/bonuses/:bid`.
- `POST /championships/:id/merge` `{keepId, mergeId}` ; `POST /championships/:id/reset-scores`.
- `GET /championships/:id/players/:pid` (détail des scores).

### Planning
- `GET/POST /events`, `GET/PATCH/DELETE /events/:id`, `POST /events/:id/status` `{status}`.
- `PATCH /events/:id/registrations/:rid` `{status?, present?}` ; `GET /events/:id/registrations.csv`.
- `POST /events/:id/import` `{tournamentId, mode: 'present'|'validated'}` → joueurs créés, événement `imported`.

### Public (sans authentification)
- `GET /public/plan/:token` (+ `/stream`) : titre, logo, tables et joueurs actifs.
- `GET /public/ranking/:token` : classement publié.
- `GET /public/events/:token` ; `POST /public/events/:token/register` `{pseudo, firstName?, lastName?, email?, answers}` → statut `pending`, ou `waitlist` si capacité atteinte.

### Divers
- `GET /health` → `{ok:true}` ; en-tête `X-Server-Time` sur toutes les réponses.

---

## 8. Front-end

### 8.1 Routes
| Route | Écran |
|---|---|
| /login, /register | Authentification |
| / | Redirige vers le live en cours (le crée si aucun) |
| /live/:id | **Timer** (+ panneau Réglages en surcouche) ; `?tv=1` mode TV |
| /lives | Mes lives en cours (tournois simultanés) |
| /planning, /planning/:id | Mon planning |
| /championships, /championships/:id | Championnats |
| /history, /history/:id | Historique |
| /account | Mon compte |
| /p/plan/:token | Plan des tables public |
| /p/ranking/:token | Classement public |
| /p/register/:token | Page d'inscription publique |

### 8.2 Écran Timer
- Grille 3 colonnes (≥ 1024 px) : stats | horloge | pause/late reg/places payées ; en-tête (titre, Réglages, TV, plein écran, logo).
- Mobile (< 768 px) : titre, bouton Sortant, liste des actions (Ajouter joueur, Recave, Add-on, Déplacer), mini-contrôles.
- Raccourcis : Espace = play/pause, → niveau suivant, ← niveau précédent (avec confirmation), F = plein écran, T = mode TV, Échap = fermer.
- Sons : Web Audio (bips synthétisés par défaut) ou fichiers personnalisés ; déclenchement au démarrage, à 60 s et à la fin de chaque niveau ; activation/volume par appareil.
- Bannière d'équilibrage, modales « Qui est éliminé ? » (recherche), « Faire un re-entry ? », « Éliminé par ? », « Nouveau siège attribué à ».
- Le thème s'applique via variables CSS (`--c-primary`, `--c-secondary`, `--c-title`, `--glass-opacity`, `--glass-blur`, `--font-timer`).

### 8.3 Panneau Réglages (surcouche plein écran)
Navigation latérale : **Réglages** (sous-onglets Général / Personnalisation du timer), **Gestion des joueurs**, **Éditeur de structure**, **Places payées**, puis liens vers Mon planning, Championnats, Historique, Mes lives, Mon compte, Déconnexion.
Chaque modification est enregistrée automatiquement (debounce 500 ms, indicateur « Enregistrement… / Enregistré »).

### 8.4 Design
Thème sombre bleu nuit (`#0a1828`), accent or (`#c9a449`), cartes en verre (backdrop-blur), police Inter ; icônes lucide-react ; toasts ; modales accessibles (focus trap, Échap).

---

## 9. Docker & exploitation

- `Dockerfile` multi-stage : `deps` (npm ci) → `build` (vite build + tsup) → `runtime` (node:22-alpine, utilisateur non-root, `node apps/api/dist/server.js`).
- `docker-compose.yml` :
  - `db` : `postgres:16-alpine`, volume `pgdata`, healthcheck `pg_isready`.
  - `app` : build local, `depends_on: db (healthy)`, port `${APP_PORT:-8080}:8080`, variables `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECURE`, `ALLOW_REGISTRATION`.
- Démarrage : `cp .env.example .env && docker compose up -d --build` → http://localhost:8080.
- Sauvegarde : `docker compose exec db pg_dump -U pokerorga pokerorga > backup.sql` (fichiers inclus, car stockés en base).
- Dev local : `docker compose -f docker-compose.dev.yml up -d` (Postgres seul) puis `npm run dev` (API :3000 + Vite :5173 avec proxy `/api`).

---

## 10. Phases de réalisation

Chaque phase se termine par : compilation TypeScript sans erreur, tests verts, vérification manuelle dans le navigateur.

### Phase 0 — Socle
- [x] Monorepo npm workspaces, TypeScript strict, ESLint/Prettier minimal.
- [x] `packages/shared`, `apps/api` (Fastify, env zod, `/api/health`, en-tête `X-Server-Time`), `apps/web` (Vite + React + Tailwind + router + Query).
- [x] Drizzle : schéma complet (§4), migration initiale, migration auto au démarrage.
- [x] Dockerfile, docker-compose(.dev).yml, `.env.example`, README.

### Phase 1 — Authentification & compte
- [x] register / login / logout / me, cookie JWT, garde d'authentification (API + routes front).
- [x] Écrans Connexion / Inscription (onglets, CGU), Mon compte (profil, cadre, rake, mot de passe).

### Phase 2 — Domaine partagé
- [x] Types & schémas zod (§5), défauts, structure par défaut.
- [x] `clock`, `prizepool`, `payouts`, `seating`, `balancing`, `generator`, `championship`, `csv`, `mystery`.
- [x] Tests unitaires Vitest pour chaque module.

### Phase 3 — Tournoi & timer temps réel
- [x] CRUD tournoi, snapshot `/full` avec dérivés, bus SSE, hook `useLiveTournament` (SSE + Query + offset horloge).
- [x] Écran Timer desktop, mode TV, plein écran, mobile ; contrôles & confirmations ; raccourcis ; sons ; heure locale.
- [x] Gestion des lives : `/`, `/lives`, terminer, réinitialiser, supprimer.

### Phase 4 — Réglages généraux
- [x] Formulaire Général : format, économie (aperçu), championnat (kills), tables (aperçu fusion), bounty ; règles de verrouillage et d'incompatibilité.
- [x] Configurations favorites (enregistrer, renommer, charger, supprimer).
- [x] Résumé de la configuration (badges : format, 10-max · TF 10, stack, buy-in).

### Phase 5 — Joueurs & tables
- [x] Ajout, import CSV/TXT (+ modèle), édition, suppression, recherche.
- [x] Élimination (éliminateur, re-entry), annulation, recave, add-on, annulations.
- [x] Tirage/retirage, tables (ajout, suppression, verrouillage, table finale), verrouillage de siège, déplacement/inversion.
- [x] Équilibrage auto/manuel + bannière timer + acquittement.
- [x] Plan des tables public (vue tables/liste, pagination auto, plein écran, impression) + temps réel.

### Phase 6 — Structure
- [x] Éditeur (niveaux/pauses, late reg, suppression, glisser-déposer), sauvegarde.
- [x] Générateur avec résumé, import CSV avec aperçu, structures favorites.

### Phase 7 — Places payées & résultats
- [x] Gestion des places payées (auto/manuel, monétaire/lots, contrôle de somme).
- [x] Affichage ITM sur le timer, attribution des gains aux éliminés.
- [x] Fin de tournoi : modale Classement final, export CSV, envoi vers championnat.

### Phase 8 — Personnalisation du timer
- [x] Assets (upload/serve/delete), couleurs, verre, police, fond, logo, sons personnalisés, aperçu en direct, réinitialisation.

### Phase 9 — Historique
- [x] Liste + recherche, récap (classement, stats, bounties), export CSV, export championnat, suppression.

### Phase 10 — Championnats
- [x] CRUD, archivage, import de tournoi, classement (jokers, évolution), détail joueur, bonus, fusion, annulation d'import, reset scores.
- [x] Publication & page publique du classement.

### Phase 11 — Planning & inscriptions
- [x] CRUD événement (brouillon, options), statuts, lien public.
- [x] Page publique d'inscription (liste d'attente si complet).
- [x] Suivi (onglets par statut, actions, présence), export CSV, import dans un live (présents / validés).

### Phase 12 — Mystery bounty & finitions
- [x] Grille d'enveloppes, figement, tirage à l'élimination, animation.
- [x] Revue UX mobile, accessibilité de base, états vides, messages d'erreur, README final.

---

## 11. Critères d'acceptation globaux
1. `docker compose up -d --build` démarre l'application sur un poste vierge ; données persistantes dans le volume `pgdata`.
2. Deux navigateurs ouverts sur le même live voient le timer et les joueurs se mettre à jour en < 1 s.
3. Un tournoi complet (inscription 12 joueurs, tirage, éliminations, re-entry, équilibrage, fusion en table finale, vainqueur) se déroule sans incohérence ; le classement final et les gains correspondent au prize pool.
4. Le tournoi terminé apparaît dans l'historique et peut être envoyé dans un championnat ; les points respectent `10 × √(N/rang)`.
5. Un joueur externe peut s'inscrire via la page publique ; l'organisateur l'importe dans le live.

---

## 12. État de réalisation (27/09/2026)

Toutes les phases 0 à 12 sont implémentées.

| Vérification | Résultat |
|---|---|
| Tests unitaires `packages/shared` (horloge, prize pool, répartition, tirage, équilibrage, générateur, championnat, CSV, mystery) | 17/17 ✅ |
| Test de bout en bout API `apps/api/scripts/smoke.mjs` (inscription, import CSV, tirage, re-entry, bounty progressif, fusion table finale, gains = prize pool, annulation, fin → historique, championnat, planning + liste d'attente + import) | 22/22 ✅ (en dev et en build de production) |
| `tsc --noEmit` sur shared / api / web | 0 erreur ✅ |
| Parcours navigateur : connexion, timer desktop, mode mobile, sortant + re-entry + éliminateur, tous les panneaux Réglages, vue tables, plan public, planning, page d'inscription publique, championnats | ✅ |
| Build production (API servant le front) | ✅ |
| `docker compose up --build` | ⚠️ non exécuté : Docker n'est pas installé sur le poste de développement. Le Dockerfile utilise `npm ci` (lockfile contenant les binaires linux-musl) et la même commande de build que celle validée localement. |

### Écarts par rapport à la spécification
- Horloge : action supplémentaire `goto` (aller à un niveau précis).
- Championnats SnG : même formule de points que les MTT (pas de grille dédiée, faute de Multi Sit-and-Go en V1).
- Mot de passe oublié par email : non implémenté (pas de serveur SMTP) ; changement de mot de passe depuis « Mon compte ».
- Mystery bounty : grille auto (groupes Top/High/Mid/Low/Min), figement manuel ou automatique en fin de late reg, tirage à l'élimination avec affichage de l'enveloppe ; l'édition fine enveloppe par enveloppe n'a pas d'interface (API `PATCH /tournaments/:id/mystery` disponible).

### Pistes V2
Multi Sit-and-Go, tournois flights, module « Mon club », scan QR des joueurs, connexion Google, emails transactionnels, tests E2E Playwright.
