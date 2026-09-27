import { useQueryClient } from '@tanstack/react-query';
import type { TournamentSettings } from '@pokerorga/shared';
import { useCallback } from 'react';
import { useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { liveKey } from '../live/useLive';
import { setSaveState } from './SettingsOverlay';

type Patch = {
  title?: string;
  settings?: Partial<TournamentSettings>;
  structure?: unknown;
  payouts?: unknown;
  theme?: unknown;
};

export function useSave(id: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (body: Patch) => {
      setSaveState('saving');
      try {
        await api.patch(`/tournaments/${id}`, body);
        await qc.invalidateQueries({ queryKey: liveKey(id) });
        setSaveState('saved');
        return true;
      } catch (e) {
        setSaveState('idle');
        toast(e instanceof ApiError ? e.message : "Impossible d'enregistrer.", 'error');
        await qc.invalidateQueries({ queryKey: liveKey(id) });
        return false;
      }
    },
    [id, qc, toast],
  );
}
