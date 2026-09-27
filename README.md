# PokerOrga

Outil auto-hébergé d'organisation de tournois de poker : timer synchronisé multi-écrans (PC, TV, téléphone), gestion des joueurs et des tables, structures, places payées, championnats, planning avec inscriptions en ligne.

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

Données de démo (compte `demo@pokerorga.test`, voir `scripts/seed-demo.mjs`) :

```bash
node scripts/seed-demo.mjs
```

Tests :

```bash
npm test                                  # tests unitaires de la logique métier (horloge, gains, placement, équilibrage…)
npm run smoke -w @pokerorga/api           # test de bout en bout de l'API (serveur lancé sur :3000)
npm run typecheck
```

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
