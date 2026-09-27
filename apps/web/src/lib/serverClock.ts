import { useEffect, useState } from 'react';

/** Décalage estimé entre l'horloge serveur et l'horloge locale (ms). */
let offset = 0;
let samples: { offset: number; rtt: number }[] = [];

export function recordServerTime(serverMs: number, sentAt: number, receivedAt: number) {
  if (!Number.isFinite(serverMs)) return;
  const rtt = receivedAt - sentAt;
  const est = serverMs + rtt / 2 - receivedAt;
  samples.push({ offset: est, rtt });
  samples = samples.slice(-12);
  // on privilégie les mesures avec le plus faible aller-retour
  const best = samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 4);
  offset = best.reduce((a, s) => a + s.offset, 0) / best.length;
}

export const serverNow = () => Date.now() + offset;

/** Re-rend le composant toutes les `ms` et renvoie l'heure serveur estimée. */
export function useServerNow(ms = 250) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
