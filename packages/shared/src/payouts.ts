const TIERS: { max: number; pct: number[] }[] = [
  { max: 3, pct: [100] },
  { max: 6, pct: [65, 35] },
  { max: 10, pct: [50, 30, 20] },
  { max: 15, pct: [45, 27, 17, 11] },
  { max: 20, pct: [40, 25, 16, 11, 8] },
  { max: 30, pct: [36, 22, 15, 11, 9, 7] },
  { max: 40, pct: [32, 20, 14, 10, 8, 6.5, 5.5, 4] },
  { max: 60, pct: [30, 19, 13, 10, 8, 6.5, 5.5, 4.5, 3.5] },
];

/** Pourcentages de répartition selon le nombre d'entrées. */
export function payoutPercentages(entries: number): number[] {
  if (entries <= 1) return entries === 1 ? [100] : [];
  const tier = TIERS.find((t) => entries <= t.max);
  if (tier) return tier.pct;
  const places = Math.max(10, Math.round(entries * 0.15));
  const raw = Array.from({ length: places }, (_, i) => Math.pow(0.78, i));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => (r / sum) * 100);
}

/** Montants arrondis, décroissants, dont la somme vaut exactement le prize pool (arrondi à l'unité). */
export function autoPayouts(entries: number, prizePool: number): number[] {
  const pct = payoutPercentages(entries);
  if (pct.length === 0 || prizePool <= 0) return [];
  const total = Math.round(prizePool);
  const unit = total >= 500 ? 5 : 1;
  const amounts = pct.map((p) => Math.floor((total * p) / 100 / unit) * unit);
  // on retire les places à 0
  while (amounts.length > 1 && amounts[amounts.length - 1] <= 0) amounts.pop();
  const diff = total - amounts.reduce((a, b) => a + b, 0);
  amounts[0] += diff;
  // garantir la décroissance
  for (let i = 1; i < amounts.length; i++) {
    if (amounts[i] > amounts[i - 1]) {
      const d = amounts[i] - amounts[i - 1];
      amounts[i] -= d;
      amounts[0] += d;
    }
  }
  return amounts;
}

export function ordinalPrize(rank: number): string {
  return rank === 1 ? '1er Prix' : `${rank}e Prix`;
}

export function ordinal(rank: number): string {
  return rank === 1 ? '1er' : `${rank}e`;
}
