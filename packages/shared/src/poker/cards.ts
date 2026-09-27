/**
 * Cartes et évaluation des mains de Texas Hold'em.
 * Une carte s'écrit rang + couleur : `As`, `Td`, `9c` (rangs 23456789TJQKA, couleurs s h d c).
 */
export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';
export const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const FULL_DECK: Card[] = [...RANKS].reverse().flatMap((r) => [...SUITS].map((s) => r + s));

export const isCard = (c: unknown): c is Card => typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);
export const rankOf = (c: Card) => RANKS.indexOf(c[0]) + 2;
export const suitOf = (c: Card) => c[1];

/** Libellé court : `A♠`, `10♥`. */
export function cardLabel(c: Card): string {
  return (c[0] === 'T' ? '10' : c[0]) + SUIT_SYMBOL[c[1]];
}

/** Lit « As Kd », « AsKd », « 10h 9h »… ; renvoie null si la saisie est invalide. */
export function parseCards(input: string): Card[] | null {
  const s = input.replace(/10/g, 'T').replace(/[\s,;]+/g, '');
  if (s.length % 2) return null;
  const out: Card[] = [];
  for (let i = 0; i < s.length; i += 2) {
    const c = s[i].toUpperCase() + s[i + 1].toLowerCase();
    if (!isCard(c)) return null;
    out.push(c);
  }
  return out;
}

/** Première carte dupliquée d'une liste (null si aucune). */
export function duplicateCard(cards: Card[]): Card | null {
  const seen = new Set<Card>();
  for (const c of cards) {
    if (seen.has(c)) return c;
    seen.add(c);
  }
  return null;
}

// ---------------- Évaluation ----------------

export const HAND_CATEGORIES = [
  'Hauteur',
  'Paire',
  'Double paire',
  'Brelan',
  'Quinte',
  'Couleur',
  'Full',
  'Carré',
  'Quinte flush',
] as const;

export interface HandValue {
  /** 0 = hauteur … 8 = quinte flush. */
  category: number;
  /** Rangs de départage, dans l'ordre d'importance (2..14). */
  ranks: number[];
  /** Score comparable directement (plus grand = meilleur). */
  score: number;
  /** Les 5 cartes retenues, dans l'ordre de lecture. */
  cards: Card[];
}

function scoreOf(category: number, ranks: number[]): number {
  let s = category;
  for (let i = 0; i < 5; i++) s = s * 15 + (ranks[i] ?? 0);
  return s;
}

/** Évalue exactement 5 cartes. */
export function evaluate5(cards: Card[]): HandValue {
  const rs = cards.map(rankOf);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  // groupes triés par effectif puis par rang
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // roue A-2-3-4-5
  }
  let category: number;
  let ranks: number[];
  if (straightHigh && flush) [category, ranks] = [8, [straightHigh]];
  else if (groups[0][1] === 4) [category, ranks] = [7, [groups[0][0], groups[1][0]]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) [category, ranks] = [6, [groups[0][0], groups[1][0]]];
  else if (flush) [category, ranks] = [5, uniq];
  else if (straightHigh) [category, ranks] = [4, [straightHigh]];
  else if (groups[0][1] === 3) [category, ranks] = [3, groups.map((g) => g[0])];
  else if (groups[0][1] === 2 && groups[1][1] === 2) [category, ranks] = [2, groups.map((g) => g[0])];
  else if (groups[0][1] === 2) [category, ranks] = [1, groups.map((g) => g[0])];
  else [category, ranks] = [0, uniq];

  // ordre d'affichage : par groupe, et la roue se lit 5-4-3-2-A
  const order = (c: Card) => {
    const r = rankOf(c);
    const eff = straightHigh === 5 && r === 14 ? 1 : r;
    return (counts.get(r) ?? 0) * 100 + eff;
  };
  const sorted = cards.slice().sort((a, b) => order(b) - order(a) || SUITS.indexOf(a[1]) - SUITS.indexOf(b[1]));
  return { category, ranks, score: scoreOf(category, ranks), cards: sorted };
}

const COMBOS: Record<number, number[][]> = {};
function combos(n: number, k = 5): number[][] {
  if (COMBOS[n]) return COMBOS[n];
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push(acc.slice());
    for (let i = start; i < n; i++) {
      acc.push(i);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return (COMBOS[n] = out);
}

/** Meilleure main de 5 cartes parmi 5 à 7 cartes. */
export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('Il faut entre 5 et 7 cartes.');
  let best: HandValue | null = null;
  for (const idx of combos(cards.length)) {
    const v = evaluate5(idx.map((i) => cards[i]));
    if (!best || v.score > best.score) best = v;
  }
  return best!;
}

export const compareHands = (a: HandValue, b: HandValue) => a.score - b.score;

// ---------------- Libellés (français) ----------------

const NAMES: Record<number, [string, string]> = {
  14: ['As', 'As'],
  13: ['Roi', 'Rois'],
  12: ['Dame', 'Dames'],
  11: ['Valet', 'Valets'],
};
export const rankName = (r: number, plural = false) => (NAMES[r] ? NAMES[r][plural ? 1 : 0] : String(r));
/** « d'As », « de Rois », « de 8 ». */
const de = (r: number) => (r === 14 ? "d'As" : `de ${rankName(r, true)}`);
const list = (rs: number[]) => rs.map((r) => (r === 14 ? 'A' : r === 13 ? 'R' : r === 12 ? 'D' : r === 11 ? 'V' : String(r))).join('-');

/** Nom complet d'une main : « Full aux Rois par les 8 », « Paire d'As, kickers R-9-5 ». */
export function describeHand(v: HandValue, withKickers = true): string {
  const [a, b] = v.ranks;
  const kick = (rs: number[]) => (withKickers && rs.length ? `, ${rs.length > 1 ? 'kickers' : 'kicker'} ${list(rs)}` : '');
  switch (v.category) {
    case 8:
      return a === 14 ? 'Quinte flush royale' : `Quinte flush hauteur ${rankName(a)}`;
    case 7:
      return `Carré ${de(a)}${kick([b])}`;
    case 6:
      return `Full aux ${rankName(a, true)} par les ${rankName(b, true)}`;
    case 5:
      return `Couleur hauteur ${rankName(a)}${withKickers ? ` (${list(v.ranks)})` : ''}`;
    case 4:
      return `Quinte hauteur ${rankName(a)}`;
    case 3:
      return `Brelan ${de(a)}${kick(v.ranks.slice(1))}`;
    case 2:
      return `Double paire ${rankName(a, true)} et ${rankName(b, true)}${kick(v.ranks.slice(2))}`;
    case 1:
      return `Paire ${de(a)}${kick(v.ranks.slice(1))}`;
    default:
      return `Hauteur ${rankName(a)}${kick(v.ranks.slice(1))}`;
  }
}

const nth = (n: number) => (n === 1 ? '1re' : `${n}e`);

/** Explique pourquoi `w` bat `l` (ou le partage si égalité). */
export function explainWin(w: HandValue, l: HandValue): string {
  if (w.score === l.score) return `Égalité parfaite (${list(w.ranks)}) : partage du pot.`;
  if (w.category !== l.category) return `${HAND_CATEGORIES[w.category]} bat ${HAND_CATEGORIES[l.category].toLowerCase()}.`;
  const i = w.ranks.findIndex((r, k) => r !== l.ranks[k]);
  const vs = `${rankName(w.ranks[i])} contre ${rankName(l.ranks[i])}`;
  const kicker = (made: number) => {
    const k = i - made + 1;
    return `Départage au ${k === 1 ? '' : `${k}e `}kicker : ${vs}.`;
  };
  switch (w.category) {
    case 8:
    case 4:
      return `Quinte plus haute : ${vs}.`;
    case 7:
      return i === 0 ? `Carré supérieur : ${vs}.` : kicker(1);
    case 6:
      return i === 0 ? `Brelan du full supérieur : ${vs}.` : `Paire du full supérieure : ${vs}.`;
    case 5:
      return `Couleur supérieure à la ${nth(i + 1)} carte : ${vs}.`;
    case 3:
      return i === 0 ? `Brelan supérieur : ${vs}.` : kicker(1);
    case 2:
      return i === 0 ? `Paire haute supérieure : ${vs}.` : i === 1 ? `Seconde paire supérieure : ${vs}.` : kicker(2);
    case 1:
      return i === 0 ? `Paire supérieure : ${vs}.` : kicker(1);
    default:
      return `Départage à la ${nth(i + 1)} carte : ${vs}.`;
  }
}

// ---------------- Showdown & équité ----------------

export interface ShowdownEntry {
  cards: Card[];
}

/** Classe des mains (2 cartes chacune) sur un board de 5 cartes. Renvoie les index gagnants. */
export function showdownWinners(holes: Card[][], board: Card[]): { values: HandValue[]; winners: number[] } {
  const values = holes.map((h) => bestHand([...h, ...board]));
  const top = Math.max(...values.map((v) => v.score));
  return { values, winners: values.flatMap((v, i) => (v.score === top ? [i] : [])) };
}

export interface EquityResult {
  /** Part du pot espérée (0..1), égalités comprises. */
  equity: number[];
  win: number[];
  tie: number[];
  exact: boolean;
  samples: number;
}

/**
 * Équité de chaque main sur un board incomplet (0, 3 ou 4 cartes).
 * Énumération exacte s'il manque ≤ 2 cartes, Monte-Carlo sinon.
 */
export function computeEquity(holes: Card[][], board: Card[], opts: { iterations?: number; dead?: Card[]; rng?: () => number } = {}): EquityResult {
  const n = holes.length;
  const used = new Set([...holes.flat(), ...board, ...(opts.dead ?? [])]);
  const deck = FULL_DECK.filter((c) => !used.has(c));
  const missing = 5 - board.length;
  const eq = new Array(n).fill(0);
  const win = new Array(n).fill(0);
  const tie = new Array(n).fill(0);
  let samples = 0;
  const run = (extra: Card[]) => {
    const { winners } = showdownWinners(holes, [...board, ...extra]);
    samples++;
    for (const w of winners) {
      eq[w] += 1 / winners.length;
      if (winners.length === 1) win[w]++;
      else tie[w]++;
    }
  };
  const exact = missing <= 2;
  if (missing === 0) run([]);
  else if (exact) {
    for (const idx of combosOf(deck.length, missing)) run(idx.map((i) => deck[i]));
  } else {
    const rng = opts.rng ?? Math.random;
    const iters = opts.iterations ?? 10000;
    const d = deck.slice();
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < missing; k++) {
        const j = k + Math.floor(rng() * (d.length - k));
        [d[k], d[j]] = [d[j], d[k]];
      }
      run(d.slice(0, missing));
    }
  }
  const s = samples || 1;
  return { equity: eq.map((x) => x / s), win: win.map((x) => x / s), tie: tie.map((x) => x / s), exact, samples };
}

function combosOf(n: number, k: number): number[][] {
  if (k === 1) return Array.from({ length: n }, (_, i) => [i]);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}
