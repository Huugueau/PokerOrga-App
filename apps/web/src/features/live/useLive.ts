import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clockInfo,
  formatDuration,
  levelMs,
  resolveClock,
  type TournamentSnapshot,
} from '@pokerorga/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useServerNow } from '../../lib/serverClock';

export const liveKey = (id: string) => ['live', id] as const;

/** Snapshot temps réel d'un tournoi (requête + abonnement SSE). */
export function useLive(id: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: liveKey(id ?? ''),
    queryFn: () => api.get<TournamentSnapshot>(`/tournaments/${id}/full`),
    enabled: !!id,
    refetchInterval: 60_000,
  });
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`/api/tournaments/${id}/stream`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { type: string; version?: number };
        if (d.type === 'hello') qc.invalidateQueries({ queryKey: liveKey(id) });
        if (d.type === 'tournament') {
          const cur = qc.getQueryData<TournamentSnapshot>(liveKey(id));
          if (!cur || (d.version ?? 0) > cur.tournament.version) qc.invalidateQueries({ queryKey: liveKey(id) });
        }
        setConnected(true);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [id, qc]);
  return { ...q, connected };
}

/** Exécute une action serveur sur le live avec gestion d'erreur + rafraîchissement. */
export function useLiveAction(id: string | undefined) {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (id) await qc.invalidateQueries({ queryKey: liveKey(id) });
        if (success) toast(success);
        return r;
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'Une erreur est survenue.', 'error');
        if (id) qc.invalidateQueries({ queryKey: liveKey(id) });
        return undefined;
      }
    },
    [id, qc, toast],
  );
}

export function patchTournament(id: string, body: unknown) {
  return api.patch(`/tournaments/${id}`, body);
}

/** Vue calculée de l'horloge, rafraîchie 4 fois par seconde. */
export function useClockView(snap: TournamentSnapshot | undefined) {
  const now = useServerNow(250);
  return useMemo(() => {
    if (!snap) return null;
    const levels = snap.tournament.structure;
    const r = resolveClock(snap.tournament.clock, levels, now);
    const info = clockInfo(levels, r);
    const total = levelMs(levels[r.levelIndex]);
    return {
      ...r,
      ...info,
      now,
      total,
      progress: total > 0 ? 1 - r.remainingMs / total : 0,
      breakIn: info.msToNextBreak != null ? formatDuration(info.msToNextBreak) : null,
      lateRegIn: info.msToLateRegEnd != null ? formatDuration(info.msToLateRegEnd) : null,
    };
  }, [snap, now]);
}
export type ClockView = NonNullable<ReturnType<typeof useClockView>>;
