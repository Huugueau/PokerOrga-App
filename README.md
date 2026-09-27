# PokerOrga

Outil auto-hébergé d'organisation de tournois de poker : timer synchronisé multi-écrans (PC, TV, téléphone), gestion des joueurs et des tables, structures, places payées, sessions Multi Sit-and-Go, championnats, planning avec inscriptions en ligne et pointage QR, tournois flights multi-jours, horloge liée entre lives, module « Mon club » (adhérents, cotisations, cartes membres), compte joueur avec QR personnel, outils publics (générateur de structure, calculateur de payout).

- Documentation fonctionnelle : [docs/01-ANALYSE-FONCTIONNELLE.md](docs/01-ANALYSE-FONCTIONNELLE.md)
- Plan & spécifications techniques (document principal) : [docs/00-PLAN-ET-SPECS-TECHNIQUES.md](docs/00-PLAN-ET-SPECS-TECHNIQUES.md)

Stack : React 19 + Vite + Tailwind · Node 22 + Fastify 5 + Drizzle · PostgreSQL 16 · Docker.

---

## Démarrage rapide (Docker)

```bash
cp .env.example .env        # puis définir JWT_SECRET
docker compose up -d --build
```

Ouvrir http://localhost:8080, créer un compte organisateur, puis « Ouvrir mon timer ».

- Les données (y compris logos, fonds et sons importés) sont dans le volume `pgdata`.
- Sauvegarde : `docker compose exec db pg_dump -U pokerorga pokerorga > sauvegarde.sql`
- Restauration : `docker compose exec -T db psql -U pokerorga pokerorga < sauvegarde.sql`
- Mise à jour : `git pull && docker compose up -d --build` (les migrations s'appliquent au démarrage).
- Fermer les inscriptions d'organisateurs : `ALLOW_REGISTRATION=false` dans `.env`.
- Derrière un reverse proxy HTTPS : `COOKIE_SECURE=true`. Pensez à désactiver le buffering pour `/api/*/stream` (Server-Sent Events).

## Développement

Prérequis : Node 22+.

```bash
npm install
npm run dev:db     # PostgreSQL embarqué (sans Docker) sur :5432 — ou : docker compose -f docker-compose.dev.yml up -d
npm run dev        # API :3000 + front Vite :5173 (proxy /api)
```

Données de démo (compte organisateur `demo@pokerorga.test`, compte joueur `demo-joueur@pokerorga.test`, voir `scripts/seed-demo.mjs`) :

```bash
node scripts/seed-demo.mjs
```

Tests :

```bash
npm test                                  # tests unitaires de la logique métier (horloge, gains, placement, équilibrage…)
npm run smoke -w @pokerorga/api           # test de bout en bout de l'API (serveur lancé sur :3000)
npm run typecheck
```

Tests E2E navigateur (Playwright, Chromium) — la base PostgreSQL de dev doit tourner :

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

La commande builde l'application puis la lance sur le port 8090 (`E2E_SKIP_BUILD=1` pour réutiliser le build existant, `npm run test:e2e:ui` pour le mode interactif). Les scénarios (`e2e/`) couvrent : authentification, timer (play/pause, niveaux, sortant, re-entry, mode TV), synchronisation multi-écrans et horloge liée, réglages (titre, format, import CSV, tirage des sièges, plan public, structure), fin de tournoi → championnat → historique, planning (inscriptions publiques, liste d'attente, import), Mon club (création, adhérent, demande publique, pointage QR), flights, pages publiques, compte joueur et vue mobile.

La CI GitHub Actions (`.github/workflows/ci.yml`) enchaîne typecheck, tests unitaires, tests E2E et test de fumée de l'API sur une base PostgreSQL de service. Un second job construit l'image Docker, démarre la stack `docker compose` et rejoue le test de fumée sur le conteneur (:8080).

## Structure

```
packages/shared   logique métier pure (horloge, prize pool, répartition, tirage, équilibrage, générateur, championnat, CSV) + schémas zod
apps/api          Fastify : auth, tournois, joueurs, tables, favoris, assets, historique, championnats, planning, vues publiques, SSE
apps/web          React : timer (desktop / TV / mobile), panneau Réglages, pages de gestion, vues publiques
```

## Raccourcis du timer

| Touche | Action |
|---|---|
| Espace | Pause / reprise |
| ← / → | Niveau précédent / suivant (avec confirmation) |
| S | Sortant |
| T | Mode TV / projecteur |
| F | Plein écran |
