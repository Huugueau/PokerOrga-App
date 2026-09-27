import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type TournamentSnapshot } from '@pokerorga/shared';
import { Download, Send, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cx, Modal, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface ChampItem {
  id: string;
  name: string;
  type: string;
  archived: boolean;
}

export function RankingTable({ snap, compact }: { snap: TournamentSnapshot; compact?: boolean }) {
  const byId = new Map(snap.players.map((p) => [p.id, p.pseudo]));
  const list = snap.players.slice().sort((a, b) => (a.finishRank ?? 999) - (b.finishRank ?? 999));
  const showBounty = snap.tournament.settings.bounty.type !== 'none';
  const pts = snap.tournament.settings.isFree || snap.tournament.payouts.type === 'lots';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-stone-400">
            <th className="py-2 pr-2">Place</th>
            <th className="py-2 pr-2">Joueur</th>
            {!compact && <th className="py-2 pr-2">Entrées</th>}
            <th className="py-2 pr-2">Kills</th>
            {!compact && <th className="py-2 pr-2">Éliminé par</th>}
            {showBounty && <th className="py-2 pr-2">Bounties</th>}
            <th className="py-2 text-right">Gain</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className={cx('border-t border-white/5', p.finishRank === 1 && 'text-gold-300')}>
              <td className="py-2 pr-2 font-bold tabular">{p.finishRank ?? '—'}</td>
              <td className="py-2 pr-2 font-semibold">
                {p.finishRank === 1 && <Trophy size={14} className="mr-1 inline text-gold-400" />}
                {p.pseudo}
              </td>
              {!compact && <td className="py-2 pr-2 tabular">{p.entries + p.rebuys}</td>}
              <td className="py-2 pr-2 tabular">{p.kills}</td>
              {!compact && <td className="py-2 pr-2 text-stone-400">{p.eliminatedBy ? byId.get(p.eliminatedBy) : ''}</td>}
              {showBounty && <td className="py-2 pr-2 tabular">{p.bountyWon ? (pts ? `${p.bountyWon} pts` : formatMoney(p.bountyWon)) : ''}</td>}
              <td className="py-2 text-right font-semibold tabular">{p.prizeLabel ?? (p.prizeAmount ? formatMoney(p.prizeAmount) : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SendToChampionship({ tournamentId, exported, disabled }: { tournamentId: string; exported: string[]; disabled?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const champs = useQuery({ queryKey: ['championships'], queryFn: () => api.get<{ items: ChampItem[] }>('/championships') });
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const available = (champs.data?.items ?? []).filter((c) => !c.archived && !exported.includes(c.id));
  const send = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      await api.post(`/championships/${pick}/import`, { tournamentId });
      toast('Résultats envoyés au championnat !');
      setPick('');
      qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Une erreur est survenue lors de l'envoi des résultats.", 'error');
    } finally {
      setBusy(false);
    }
  };
  if (champs.data && champs.data.items.length === 0) {
    return (
      <p className="text-sm text-stone-400">
        Aucun championnat. <Link className="text-gold-400 underline" to="/championships">Créez-en un</Link> pour y envoyer ce tournoi.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto min-w-52" value={pick} onChange={(e) => setPick(e.target.value)} disabled={disabled || available.length === 0}>
        <option value="">{available.length ? '-- Choisissez un championnat --' : 'Déjà envoyé vers tous vos championnats.'}</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.type.toUpperCase()})
          </option>
        ))}
      </select>
      <button className="btn-ghost" disabled={!pick || busy || disabled} onClick={send}>
        <Send size={16} /> Envoyer vers le championnat
      </button>
      {exported.length > 0 && <span className="chip">Envoyé vers {exported.length} championnat(s) ✅</span>}
    </div>
  );
}

export function ResultsModal({ snap, onClose, onFinish }: { snap: TournamentSnapshot; onClose: () => void; onFinish?: () => void }) {
  const done = snap.players.length >= 2 && snap.players.every((p) => p.finishRank != null);
  return (
    <Modal
      open
      onClose={onClose}
      title={done ? 'Tournoi terminé ! — Classement final' : 'Classement provisoire'}
      size="xl"
      footer={
        <>
          <a className="btn-ghost" href={`/api/tournaments/${snap.tournament.id}/export.csv`}>
            <Download size={16} /> Exporter (CSV)
          </a>
          {onFinish && done && (
            <button className="btn-primary" onClick={onFinish}>
              Terminer et archiver
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {done && <p className="text-sm text-stone-300">Vous pouvez maintenant envoyer les résultats vers un de vos championnats.</p>}
        {done && <SendToChampionship tournamentId={snap.tournament.id} exported={snap.tournament.exportedChampionshipIds} />}
        <RankingTable snap={snap} />
      </div>
    </Modal>
  );
}
