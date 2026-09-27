import { uid } from './defaults';
import type { MysteryEnvelope } from './types';

const GROUPS: { name: string; share: number }[] = [
  { name: 'Top Bounty', share: 0.25 },
  { name: 'High Bounty', share: 0.2 },
  { name: 'Mid Bounty', share: 0.2 },
  { name: 'Low Bounty', share: 0.2 },
  { name: 'Min Bounty', share: 0.15 },
];

export function defaultEnvelopeCount(entries: number): number {
  return Math.min(entries, Math.max(4, Math.round(entries / 2)));
}

/** Génère une grille d'enveloppes dont la somme = pool (arrondi à l'unité). */
export function generateEnvelopes(pool: number, count: number): MysteryEnvelope[] {
  const total = Math.round(pool);
  if (count <= 0 || total <= 0) return [];
  // nombre d'enveloppes par groupe : 1 top, puis réparties
  const counts = [1, 0, 0, 0, 0];
  let left = count - 1;
  const weights = [0, 0.15, 0.25, 0.3, 0.3];
  for (let g = 1; g < 5 && left > 0; g++) {
    const n = g === 4 ? left : Math.max(left > 0 ? 1 : 0, Math.round((count - 1) * weights[g]));
    const take = Math.min(left, n);
    counts[g] = take;
    left -= take;
  }
  // montants : share du groupe réparti sur ses enveloppes ; groupes vides → report sur Min
  const envelopes: MysteryEnvelope[] = [];
  let carry = 0;
  const active = counts.map((c, i) => ({ c, i })).filter((x) => x.c > 0);
  const shareSum = active.reduce((a, x) => a + GROUPS[x.i].share, 0);
  let allocated = 0;
  active.forEach((x, k) => {
    const groupTotal = k === active.length - 1 ? total - allocated : Math.floor((total * GROUPS[x.i].share) / shareSum);
    allocated += groupTotal;
    const each = Math.floor(groupTotal / x.c);
    let rest = groupTotal - each * x.c;
    for (let j = 0; j < x.c; j++) {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      envelopes.push({ id: uid(), group: GROUPS[x.i].name, amount: each + extra + carry, drawn: false, drawnBy: null });
      carry = 0;
    }
  });
  return envelopes;
}

export function envelopesTotal(env: MysteryEnvelope[]): number {
  return env.reduce((a, e) => a + e.amount, 0);
}

export function drawEnvelope(env: MysteryEnvelope[], rng: () => number = Math.random): MysteryEnvelope | null {
  const left = env.filter((e) => !e.drawn);
  if (left.length === 0) return null;
  return left[Math.floor(rng() * left.length)];
}
