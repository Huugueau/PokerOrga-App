# Déploiement sur le VPS Ionos — poker.huugueau.com

Architecture cible :

```
Internet ──443──▶ Nginx (déjà présent sur le VPS, certificat Let's Encrypt)
                    │  proxy vers 127.0.0.1:8080
                    ▼
            conteneur app  (ghcr.io/huugueau/pokerorga-app:latest)
                    │
            conteneur db   (postgres:16, volume pgdata)
```

L'application n'est jamais exposée directement : elle n'écoute que sur `127.0.0.1`, seul Nginx la joint.
L'image est construite et testée par la CI GitHub, puis publiée sur GHCR à chaque push sur `main` ; le VPS ne fait que la télécharger.

Fichiers utilisés (dossier [`deploy/`](../deploy)) :

| Fichier | Rôle |
|---|---|
| `deploy/docker-compose.yml` | stack de production (image GHCR + PostgreSQL) |
| `deploy/.env.example` | modèle de configuration (secrets à générer) |
| `deploy/nginx/poker.huugueau.com.conf` | site Nginx (dont réglages temps réel SSE) |
| `deploy/backup.sh` | sauvegarde quotidienne de la base |

Les commandes ci-dessous sont à lancer **sur le VPS**, connecté en SSH avec un utilisateur `sudo`.

---

## 1. DNS (espace client Ionos)

Domaines & SSL → `huugueau.com` → DNS → **Ajouter un enregistrement** :

| Type | Nom d'hôte | Valeur |
|---|---|---|
| A | `poker` | adresse IPv4 du VPS |
| AAAA *(si le VPS a une IPv6)* | `poker` | adresse IPv6 du VPS |

Vérifier la propagation (quelques minutes en général) depuis ton PC :

```bash
nslookup poker.huugueau.com
```

Dans le Cloud Panel Ionos, la **stratégie de pare-feu** du VPS doit autoriser les ports 80 et 443 (normalement déjà le cas puisque Nginx sert d'autres sites).

## 2. Image Docker

La CI publie `ghcr.io/huugueau/pokerorga-app` ; le package est **public** (il hérite de la visibilité du dépôt) : aucune connexion n'est nécessaire pour le télécharger.

> Si le dépôt devient privé un jour : créer un token GitHub *classic* avec uniquement le droit `read:packages`, puis sur le VPS `docker login ghcr.io -u Huugueau` (coller le token comme mot de passe).

## 3. Docker sur le VPS

Vérifier s'il est déjà installé :

```bash
docker --version && docker compose version
```

Sinon (Ubuntu/Debian, script officiel Docker) :

```bash
curl -fsSL https://get.docker.com | sudo sh
```

```bash
sudo usermod -aG docker $USER
```

Se déconnecter / reconnecter pour que le groupe `docker` soit pris en compte.

## 4. Installation de l'instance

```bash
sudo mkdir -p /opt/pokerorga && sudo chown $USER: /opt/pokerorga && cd /opt/pokerorga
```

```bash
for f in docker-compose.yml .env.example backup.sh nginx/poker.huugueau.com.conf; do curl -fsSL --create-dirs -o "$f" "https://raw.githubusercontent.com/Huugueau/PokerOrga-App/main/deploy/$f"; done
```

```bash
cp .env.example .env && chmod 600 .env && chmod +x backup.sh
```

Générer les deux secrets et les coller dans `.env` (`JWT_SECRET=` et `POSTGRES_PASSWORD=`) :

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"; echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

```bash
nano .env
```

> Le port 8080 est déjà utilisé sur le VPS ? (`sudo ss -ltnp | grep 8080`) → mettre par exemple `APP_PORT=8091` dans `.env` **et** remplacer `8080` dans le fichier Nginx.

Démarrer :

```bash
docker compose pull && docker compose up -d
```

```bash
docker compose ps
```

Les deux services doivent être `healthy` / `running` (l'app peut mettre ~30 s à passer `healthy`). Test local :

```bash
curl -s http://127.0.0.1:8080/api/health
```

Les migrations de base s'appliquent automatiquement au démarrage.

## 5. Nginx + HTTPS

```bash
sudo cp /opt/pokerorga/nginx/poker.huugueau.com.conf /etc/nginx/sites-available/
```

```bash
sudo ln -s /etc/nginx/sites-available/poker.huugueau.com.conf /etc/nginx/sites-enabled/
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> Si ton Nginx utilise `/etc/nginx/conf.d/` au lieu de `sites-available/`, copier le fichier directement dans `conf.d/`.

Certificat Let's Encrypt (Certbot modifie le fichier pour ajouter le HTTPS et la redirection HTTP → HTTPS) :

```bash
sudo apt install -y certbot python3-certbot-nginx
```

```bash
sudo certbot --nginx -d poker.huugueau.com
```

Le renouvellement est automatique (timer systemd installé par Certbot) ; vérification : `sudo certbot renew --dry-run`.

Ouvrir **https://poker.huugueau.com** → créer ton compte organisateur.

Points déjà gérés par la config :
- cookie de session `Secure` (forcé dans `deploy/docker-compose.yml`, nécessite le HTTPS) ;
- flux temps réel `/api/.../stream` sans buffering ni coupure (timer TV, plan public) ;
- imports de logos/sons jusqu'à 2 Mo ;
- liens publics et QR codes (inscriptions, classement, club) générés avec le domaine réel.

## 6. Fermer les inscriptions (recommandé)

Une fois les comptes organisateurs créés, dans `/opt/pokerorga/.env` : `ALLOW_REGISTRATION=false`, puis :

```bash
cd /opt/pokerorga && docker compose up -d
```

Les inscriptions **joueurs** aux événements et les comptes joueurs restent possibles.

## 7. Sauvegardes

Test manuel :

```bash
/opt/pokerorga/backup.sh
```

Automatiser (tous les jours à 4 h 30, 14 jours conservés dans `/opt/pokerorga/backups`) via `crontab -e` :

```
30 4 * * * /opt/pokerorga/backup.sh >> /opt/pokerorga/backups/backup.log 2>&1
```

Idéalement, recopier régulièrement ce dossier hors du VPS (ou activer les sauvegardes Ionos du serveur).

Restauration :

```bash
cd /opt/pokerorga && gunzip -c backups/pokerorga-AAAAMMJJ-HHMM.sql.gz | docker compose exec -T db psql -U pokerorga pokerorga
```

(à faire sur une base vide : `docker compose down -v && docker compose up -d db` avant, puis `docker compose up -d` après).

## 8. Mises à jour

Chaque push sur `main` dont la CI est verte publie une nouvelle image `latest` (+ une étiquette `sha-xxxxxxx`). Sur le VPS :

```bash
cd /opt/pokerorga && docker compose pull && docker compose up -d && docker image prune -f
```

Revenir à une version précédente : `IMAGE=ghcr.io/huugueau/pokerorga-app:sha-xxxxxxx` dans `.env`, puis la même commande.

## 9. Diagnostic

| Symptôme | Vérification |
|---|---|
| 502 Bad Gateway | `docker compose ps` ; `docker compose logs app --tail 100` ; port de `proxy_pass` = `APP_PORT` |
| Impossible de se connecter (la session ne tient pas) | le site doit être ouvert en **https** (cookie `Secure`) |
| Le timer TV ne se met plus à jour | vérifier que le bloc `location ~ ^/api/.*/stream$` est bien présent après le passage de Certbot |
| `docker compose pull` refusé (denied) | package GHCR devenu privé → étape 2 |
| Upload refusé (413) | `client_max_body_size` dans le fichier Nginx |
