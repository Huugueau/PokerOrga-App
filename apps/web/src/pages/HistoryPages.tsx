import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatChips, formatMoney, type TournamentSnapshot } from '@pokerorga/shared';
import { ArrowLeft, Download, History, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, fmtDate, Loading, PageHeader, Section, useConfirm, useToast } from '../components/ui';
import { RankingTable, SendToChampionship } from '../features/live/ResultsModal';
import { configSummary } from '../features/settings/GeneralPanel';
import { api } from '../lib/api';

interface HistoryItem {
  id: string;
  title: string;
  finishedAt: string;
  startedAt: string | null;
  entries: number;
  players: number;
  prizePool: number;
  winner: string | null;
  exportedChampionshipIds: string[];
}

export function HistoryPage() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['history', q], queryFn: () => api.get<{ items: HistoryItem[] }>(`/history${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  return (
    <>
      <PageHeader title="Historique" subtitle="Retrouvez les tournois terminés : classement, joueurs, export CSV ou championnat, et suppression." />
      <input className="input mb-5 max-w-sm" placeholder="Rechercher un tournoi" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isLoading ? (
        <Loading />
      ) : list.data?.items.length === 0 ? (
        <Empty icon={<History size={32} />} title={q ? 'Aucun résultat.' : 'Aucun tournoi archivé.'}>
          Terminez un live pour le retrouver ici.
        </Empty>
      ) : (
        <div className="card divide-y divide-white/5">
          {list.data?.items.map((h) => (
            <Link key={h.id} to={`/history/${h.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-white/5">
              <div className="min-w-48 flex-1">
                <p className="font-bold">{h.title}</p>
                <p className="text-xs text-stone-400">{fmtDate(h.startedAt ?? h.finishedAt, true)}</p>
              </div>
              <span className="text-sm text-stone-300">{h.entries} entrées</span>
              <span className="text-sm text-stone-300">{formatMoney(h.prizePool)}</span>
              <span className="flex items-center gap-1 text-sm text-gold-300">
                <Trophy size={14} /> {h.winner ?? '—'}
              </span>
              {h.exportedChampionshipIds.length > 0 && <span className="chip">Exporté</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function HistoryDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['history-item', id], queryFn: () => api.get<TournamentSnapshot>(`/history/${id}`) });
  const confirm = useConfirm();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  if (q.isLoading) return <Loading label="Chargement du récap…" />;
  if (!q.data) return <Empty title="Impossible de charger ce récap." />;
  const snap = q.data;
  const t = snap.tournament;
  const winner = snap.players.find((p) => p.finishRank === 1);
  const durationMin = t.startedAt && t.finishedAt ? Math.round((+new Date(t.finishedAt) - +new Date(t.startedAt)) / 60000) : null;
  return (
    <>
      <Link to="/history" className="mb-4 inline-flex items-center gap-1 text-sm text-stone-400 hover:text-white">
        <ArrowLeft size={14} /> Historique
      </Link>
      <PageHeader
        title={t.title}
        subtitle={`${fmtDate(t.startedAt ?? t.createdAt, true)}${durationMin ? ` · ${Math.floor(durationMin / 60)}h${String(durationMin % 60).padStart(2, '0')} de jeu` : ''}`}
        right={
          <>
            <a className="btn-ghost" href={`/api/history/${t.id}/export.csv`}>
              <Download size={16} /> CSV
            </a>
            <button
              className="btn-danger"
              onClick={async () => {
                if (await confirm({ title: 'Supprimer ce tournoi ?', lines: ['Disparaît de l’historique', 'Les copies déjà envoyées dans un championnat restent'], confirmLabel: 'Supprimer', danger: true })) {
                  await api.del(`/history/${t.id}`);
                  toast('Fiche retirée de l’historique.');
                  qc.invalidateQueries({ queryKey: ['history'] });
                  nav('/history');
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Vainqueur', winner?.pseudo ?? '—'],
          ['Joueurs', String(snap.players.length)],
          ['Entrées', String(snap.stats.totalEntries + snap.stats.totalRebuys)],
          ['Prize pool', formatMoney(snap.stats.prizePool)],
          ['Jetons en jeu', formatChips(snap.stats.chipsInPlay)],
        ].map(([l, v]) => (
          <div key={l} className="card p-4 text-center">
            <p className="eyebrow">{l}</p>
            <p className="mt-1 text-lg font-bold">{v}</p>
          </div>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {configSummary(t.settings).map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>
      <Section title="Exporter vers un championnat" className="mb-5">
        <SendToChampionship tournamentId={t.id} exported={t.exportedChampionshipIds} />
      </Section>
      <Section title="Classement">
        <RankingTable snap={snap} />
      </Section>
    </>
  );
}
