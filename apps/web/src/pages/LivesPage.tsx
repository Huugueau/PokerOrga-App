import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type TournamentStats } from '@pokerorga/shared';
import { Pause, Play, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loading, PageHeader, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface LiveItem {
  id: string;
  title: string;
  status: string;
  stats: TournamentStats;
  levelIndex: number;
  running: boolean;
}

export function LivesPage() {
  const q = useQuery({ queryKey: ['lives'], queryFn: () => api.get<{ tournaments: LiveItem[] }>('/tournaments') });
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const create = async () => {
    try {
      const r = await api.post<{ id: string }>('/tournaments', {});
      qc.invalidateQueries({ queryKey: ['lives'] });
      nav(`/live/${r.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  return (
    <>
      <PageHeader
        title="Mes lives"
        subtitle="Tournois en préparation ou en cours. Plusieurs tournois peuvent tourner en même temps, chacun sur son écran."
        right={
          <button className="btn-primary" onClick={create}>
            <Plus size={16} /> Nouveau tournoi
          </button>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data?.tournaments.map((t) => (
            <Link key={t.id} to={`/live/${t.id}`} className="card block p-5 transition hover:border-gold-500/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{t.title}</h3>
                <span className="chip">
                  {t.status === 'prepared' ? 'Préparé' : t.running ? <><Play size={11} /> En cours</> : <><Pause size={11} /> En pause</>}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-stone-400">
                <div>
                  Joueurs
                  <p className="text-lg font-bold text-stone-100">
                    {t.stats.activePlayers}/{t.stats.totalEntries}
                  </p>
                </div>
                <div>
                  Prize pool
                  <p className="text-lg font-bold text-stone-100">{formatMoney(t.stats.prizePool)}</p>
                </div>
                <div>
                  Niveau
                  <p className="text-lg font-bold text-stone-100">{t.levelIndex + 1}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Redirige vers le live courant (le crée si nécessaire). */
export function CurrentLiveRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    api
      .post<{ id: string }>('/tournaments/current')
      .then((r) => nav(`/live/${r.id}`, { replace: true }))
      .catch(() => nav('/lives', { replace: true }));
  }, [nav]);
  return <Loading label="Chargement de votre tournoi" />;
}
