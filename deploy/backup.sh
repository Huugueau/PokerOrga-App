#!/bin/sh
# Sauvegarde quotidienne de la base PokerOrga (logos, fonds et sons inclus : ils sont en base).
# Usage (crontab -e) : 30 4 * * * /opt/pokerorga/backup.sh >> /opt/pokerorga/backups/backup.log 2>&1
set -eu
cd "$(dirname "$0")"
. ./.env
mkdir -p backups
FILE="backups/pokerorga-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-pokerorga}" "${POSTGRES_DB:-pokerorga}" | gzip > "$FILE"
# conserve 14 jours
find backups -name 'pokerorga-*.sql.gz' -mtime +14 -delete
echo "$(date -Iseconds) sauvegarde OK : $FILE"
