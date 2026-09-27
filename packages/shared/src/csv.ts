import { makeBreak, makeLevel } from './defaults';
import type { Level } from './types';

export interface PlayerRow {
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
}

function detectSep(line: string): string {
  const semi = (line.match(/;/g) ?? []).length;
  const comma = (line.match(/,/g) ?? []).length;
  const tab = (line.match(/\t/g) ?? []).length;
  if (tab > semi && tab > comma) return '\t';
  return semi >= comma ? ';' : ',';
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

export const PLAYER_CSV_TEMPLATE = 'pseudo;prenom;nom\nMaxou;Maxime;Durand\nLa Fouine;;\n';

/** Parse une liste de joueurs CSV (pseudo;prenom;nom) ou TXT (un pseudo par ligne). */
export function parsePlayersFile(text: string, max = 500): { rows: PlayerRow[]; error?: string } {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], error: 'Aucun joueur détecté dans le fichier.' };
  const sep = detectSep(lines[0]);
  let start = 0;
  let idx = { pseudo: 0, first: 1, last: 2 };
  const header = splitLine(lines[0], sep).map(norm);
  if (header.some((h) => ['pseudo', 'prenom', 'nom', 'name', 'joueur'].includes(h))) {
    start = 1;
    const f = (names: string[]) => header.findIndex((h) => names.includes(h));
    idx = { pseudo: f(['pseudo', 'joueur', 'name']), first: f(['prenom', 'firstname']), last: f(['nom', 'lastname']) };
    if (idx.pseudo < 0) idx.pseudo = 0;
  }
  const rows: PlayerRow[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(start)) {
    const cols = splitLine(line, sep);
    const pseudo = (cols[idx.pseudo] ?? '').trim();
    if (!pseudo) continue;
    const key = norm(pseudo);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      pseudo: pseudo.slice(0, 40),
      firstName: idx.first >= 0 ? cols[idx.first]?.trim() || null : null,
      lastName: idx.last >= 0 ? cols[idx.last]?.trim() || null : null,
    });
  }
  if (rows.length === 0) return { rows, error: 'Aucun joueur détecté dans le fichier.' };
  if (rows.length > max) return { rows: rows.slice(0, max), error: `Import limité à ${max} joueurs.` };
  return { rows };
}

export const STRUCTURE_CSV_TEMPLATE = 'type;sb;bb;ante;duree\nniveau;50;100;0;20\nniveau;100;200;0;20\npause;0;0;0;10\nniveau;200;400;400;20\n';

export function parseStructureCsv(text: string, max = 100): { levels: Level[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { levels: [], errors: ['Fichier vide.'] };
  const sep = detectSep(lines[0]);
  const header = splitLine(lines[0], sep).map(norm);
  const expected = ['type', 'sb', 'bb', 'ante', 'duree'];
  if (header.join(',') !== expected.join(',')) {
    return { levels: [], errors: [`En-tête invalide. Attendu : ${expected.join(sep)}`] };
  }
  const body = lines.slice(1);
  if (body.length === 0) return { levels: [], errors: ['Aucune ligne de données dans le fichier.'] };
  if (body.length > max) return { levels: [], errors: [`Trop de lignes (${body.length}), maximum ${max}.`] };
  const levels: Level[] = [];
  body.forEach((line, i) => {
    const n = i + 2;
    const c = splitLine(line, sep);
    if (c.length !== 5) {
      errors.push(`Ligne ${n} : nombre de colonnes incorrect (attendu 5).`);
      return;
    }
    const type = norm(c[0]);
    const [sb, bb, ante, dur] = c.slice(1).map((v) => Number(v.replace(/\s/g, '').replace(',', '.')));
    if (!['niveau', 'pause', 'level', 'break'].includes(type)) return void errors.push(`Ligne ${n} : type invalide « ${c[0]} ».`);
    if (![sb, bb, ante].every((v) => Number.isFinite(v) && v >= 0)) return void errors.push(`Ligne ${n} : SB, BB et Ante doivent être ≥ 0.`);
    if (!Number.isFinite(dur) || dur < 1) return void errors.push(`Ligne ${n} : la durée (minutes) doit être ≥ 1.`);
    if (type === 'pause' || type === 'break') levels.push(makeBreak(Math.round(dur)));
    else levels.push(makeLevel({ sb, bb, ante, minutes: Math.round(dur) }));
  });
  if (levels.length === 0 && errors.length === 0) errors.push('Aucune ligne exploitable après analyse.');
  return { levels, errors };
}

export function toCsv(rows: (string | number | null | undefined)[][], sep = ';'): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(sep)).join('\r\n');
}
