import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type TournamentStats } from '@pokerorga/shared';
import { Link2, Pause, Play, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loading, Modal, PageHeader, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface LiveItem {
  id: string;
  title: string;
  status: string;
  stats: TournamentStats;
  levelIndex: number;
  running: boolean;
  clockGroupId: string | null;
}

export function LivesPage() {
  const q = useQuery({ queryKey: ['lives'], queryFn: () => api.get<{ tournaments: LiveItem[] }>('/tournaments') });
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [linking, setLinking] = useState(false);
  const create = async (body: { title?: string; linkTo?: string } = {}) => {
    try {
      const r = await api.post<{ id: string }>('/tournaments', body);
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
          <>
            <button className="btn-ghost" onClick={() => setLinking(true)} disabled={!q.data?.tournaments.length}>
              <Link2 size={16} /> Tournoi simultané (horloge liée)
            </button>
            <button className="btn-primary" onClick={() => create()}>
              <Plus size={16} /> Nouveau tournoi
            </button>
          </>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data?.tournaments.map((t) => (
            <Link key={t.id} to={`/live/${t.id}`} className="card block p-5 transition hover:border-accent-500/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">
                  {t.title}
                  {t.clockGroupId && (
                    <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-semibold text-accent-300" title="Horloge liée">
                      <Link2 size={12} /> liée
                    </span>
                  )}
                </h3>
                <span className="chip">
                  {t.status === 'prepared' ? 'Préparé' : t.running ? <><Play size={11} /> En cours</> : <><Pause size={11} /> En pause</>}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-zinc-400">
                <div>
                  Joueurs
                  <p className="text-lg font-bold text-zinc-100">
                    {t.stats.activePlayers}/{t.stats.totalEntries}
                  </p>
                </div>
                <div>
                  Prize pool
                  <p className="text-lg font-bold text-zinc-100">{formatMoney(t.stats.prizePool)}</p>
                </div>
                <div>
                  Niveau
                  <p className="text-lg font-bold text-zinc-100">{t.levelIndex + 1}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {linking && <LinkModal lives={q.data?.tournaments ?? []} onClose={() => setLinking(false)} onCreate={(b) => create(b)} />}
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

function LinkModal({ lives, onClose, onCreate }: { lives: LiveItem[]; onClose: () => void; onCreate: (b: { title?: string; linkTo: string }) => void }) {
  const [title, setTitle] = useState('');
  const [linkTo, setLinkTo] = useState(lives[0]?.id ?? '');
  return (
    <Modal
      open
      onClose={onClose}
      title="Ajouter un tournoi simultané"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" disabled={!linkTo} onClick={() => onCreate({ title: title.trim() || undefined, linkTo })}>
            Créer le tournoi lié
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">Le nouveau tournoi partage le timer et la structure du tournoi choisi : ils avancent ensemble (play, pause, niveaux). Joueurs, tables et classements restent séparés, chacun sur son écran.</p>
        <div>
          <label className="label">Titre du tournoi</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Side event" maxLength={80} data-autofocus />
        </div>
        <div>
          <label className="label">Partager le timer et la structure de</label>
          <select className="input" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
            {lives.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}
