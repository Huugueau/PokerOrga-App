import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, Copy, ExternalLink, GitMerge, Plus, RotateCcw, Trash2, Trophy, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cx, Empty, fmtDate, Loading, Modal, NumberField, PageHeader, Section, Segmented, Toggle, useConfirm, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface Champ {
  id: string;
  name: string;
  type: 'mtt' | 'sng';
  bestResults: number | null;
  archived: boolean;
  published: boolean;
  publicToken: string;
  createdAt: string;
  imports?: number;
}
export interface RankRow {
  id: string;
  name: string;
  points: number;
  bonus: number;
  kills: number;
  played: number;
  retained: number;
  position: number;
  delta: number | null;
}
export interface Detail {
  results: { importId: string; tournamentName: string; playedAt: string; entries: number; rank: number; points: number; kills: number; cancelled: boolean; retained: boolean }[];
  bonuses: { id: string; points: number; justification: string; createdAt: string; cancelledAt: string | null }[];
}
interface View {
  championship: Champ;
  ranking: RankRow[];
  players: { id: string; name: string }[];
  imports: { id: string; tournamentName: string; entries: number; importedAt: string; playedAt: string | null; cancelledAt: string | null; players: number }[];
  bonuses: { id: string; playerName: string; points: number; justification: string; createdAt: string; cancelledAt: string | null }[];
  details: Record<string, Detail>;
}

export function ChampionshipsPage() {
  const q = useQuery({ queryKey: ['championships'], queryFn: () => api.get<{ items: Champ[] }>('/championships') });
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const items = (q.data?.items ?? []).filter((c) => (filter === 'active' ? !c.archived : c.archived));
  return (
    <>
      <PageHeader
        title="Championnats"
        subtitle="Envoyez chaque tournoi terminé vers le championnat : les points et le classement général se calculent automatiquement."
        right={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Ajouter un championnat
          </button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Actifs' },
            { value: 'archived', label: 'Archivés' },
          ]}
        />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty icon={<Trophy size={32} />} title={filter === 'active' ? 'Aucun championnat en cours.' : 'Aucun championnat archivé.'}>
          {filter === 'active' ? 'Créez un championnat pour commencer.' : 'Les championnats archivés apparaîtront ici.'}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link key={c.id} to={`/championships/${c.id}`} className="card block p-5 hover:border-accent-500/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{c.name}</h3>
                <span className="chip">{c.type.toUpperCase()}</span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                {c.imports ?? 0} tournoi(s) · {c.bestResults ? `${c.bestResults} meilleurs résultats` : 'Tous les résultats'}
              </p>
              {c.published && <span className="chip mt-3 border-emerald-400/30 text-emerald-300">Publié</span>}
            </Link>
          ))}
        </div>
      )}
      {creating && <CreateChampionship onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateChampionship({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<'mtt' | 'sng'>('mtt');
  const [best, setBest] = useState<number | null>(null);
  const submit = async () => {
    try {
      const c = await api.post<Champ>('/championships', { name, type, bestResults: best });
      qc.invalidateQueries({ queryKey: ['championships'] });
      nav(`/championships/${c.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Nouveau championnat"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={submit} disabled={!name.trim()}>
            Créer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Nom du championnat</label>
          <input className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder={type === 'sng' ? 'Ex: Championnat SnG 2026' : 'Ex: Championnat MTT 2026'} data-autofocus />
        </div>
        <div>
          <label className="label">Type de championnat</label>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'mtt', label: 'MTT (tournois)' },
              { value: 'sng', label: 'Sit & Go' },
            ]}
          />
        </div>
        <JokersField value={best} onChange={setBest} />
      </div>
    </Modal>
  );
}

function JokersField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="space-y-2">
      <Toggle checked={value != null} onChange={(v) => onChange(v ? 10 : null)} label="Jokers" hint="Tous les résultats importés comptent. Activez pour ne garder que les N meilleurs." />
      {value != null && (
        <div className="flex items-center gap-2 text-sm">
          <NumberField className="w-24" value={value} min={1} max={200} onCommit={(v) => onChange(v ?? 1)} /> meilleurs résultats comptabilisés
        </div>
      )}
    </div>
  );
}

export function RankingList({ ranking, onPick }: { ranking: RankRow[]; onPick?: (r: RankRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-zinc-400">
            <th className="py-2 pr-2">Pos.</th>
            <th className="py-2 pr-2">Joueur</th>
            <th className="py-2 pr-2 text-right">Points</th>
            <th className="py-2 pr-2 text-right">Kills</th>
            <th className="py-2 text-right">Retenus / joués</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((r) => (
            <tr key={r.id} className={cx('border-t border-white/5', onPick && 'cursor-pointer hover:bg-white/5', r.position <= 3 && 'font-semibold')} onClick={() => onPick?.(r)}>
              <td className="py-2 pr-2 tabular">
                <span className={cx(r.position === 1 && 'text-accent-300')}>{r.position}</span>
                {r.delta != null && r.delta !== 0 && <span className={cx('ml-1.5 text-xs', r.delta > 0 ? 'text-emerald-400' : 'text-red-400')}>{r.delta > 0 ? `▲${r.delta}` : `▼${-r.delta}`}</span>}
              </td>
              <td className="py-2 pr-2">{r.name}</td>
              <td className="py-2 pr-2 text-right font-bold tabular">
                {r.points}
                {r.bonus !== 0 && <span className="ml-1 text-xs font-normal text-zinc-400">(dont {r.bonus} bonus)</span>}
              </td>
              <td className="py-2 pr-2 text-right tabular">{r.kills}</td>
              <td className="py-2 text-right tabular">
                {r.retained} / {r.played}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlayerDetail({ name, detail }: { name: string; detail: Detail }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow mb-2">Tournois de {name}</p>
        {detail.results.length === 0 ? (
          <p className="text-sm text-zinc-400">Aucun tournoi importé.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {detail.results.map((r) => (
                <tr key={r.importId} className={cx('border-t border-white/5', (r.cancelled || !r.retained) && 'text-zinc-500')}>
                  <td className="py-1.5">{r.tournamentName}</td>
                  <td className="py-1.5 text-zinc-400">{fmtDate(r.playedAt)}</td>
                  <td className="py-1.5 tabular">
                    {r.rank}/{r.entries}
                  </td>
                  <td className="py-1.5 text-right tabular">
                    {r.points} pts {r.cancelled ? '(annulé)' : !r.retained ? '(joker)' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {detail.bonuses.filter((b) => !b.cancelledAt).length > 0 && (
        <div>
          <p className="eyebrow mb-2">Points bonus</p>
          {detail.bonuses
            .filter((b) => !b.cancelledAt)
            .map((b) => (
              <p key={b.id} className="text-sm">
                +{b.points} · {b.justification}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

export function ChampionshipDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['championship', id], queryFn: () => api.get<View>(`/championships/${id}`) });
  const [pick, setPick] = useState<RankRow | null>(null);
  const [merge, setMerge] = useState(false);
  const [bonusFor, setBonusFor] = useState<string | null>(null);
  if (q.isLoading) return <Loading label="Chargement du classement…" />;
  if (!q.data) return <Empty title="Championnat introuvable." />;
  const v = q.data;
  const c = v.championship;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['championship', id] });
    qc.invalidateQueries({ queryKey: ['championships'] });
  };
  const patch = async (body: Partial<Champ>, msg?: string) => {
    try {
      await api.patch(`/championships/${c.id}`, body);
      refresh();
      if (msg) toast(msg);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  const publicUrl = `${window.location.origin}/p/ranking/${c.publicToken}`;

  return (
    <>
      <Link to="/championships" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft size={14} /> Championnats
      </Link>
      <PageHeader
        title={
          <button
            className="text-left hover:underline"
            title="Renommer le championnat"
            onClick={async () => {
              const n = prompt('Nom du championnat', c.name);
              if (n?.trim()) await patch({ name: n.trim() }, 'Nom mis à jour');
            }}
          >
            {c.name}
          </button>
        }
        subtitle={`${c.type.toUpperCase()} · ${v.imports.filter((i) => !i.cancelledAt).length} tournoi(s) · créé le ${fmtDate(c.createdAt)}`}
        right={
          <>
            <button className="btn-ghost" onClick={() => setMerge(true)} disabled={v.players.length < 2}>
              <GitMerge size={16} /> Fusionner
            </button>
            <button className="btn-ghost" onClick={() => patch({ archived: !c.archived }, c.archived ? 'Championnat réactivé' : 'Championnat archivé')}>
              <Archive size={16} /> {c.archived ? 'Réactiver' : 'Archiver'}
            </button>
          </>
        }
      />
      {c.archived && <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">Championnat archivé — consultable uniquement. Réactivez-le pour y envoyer des tournois.</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Section title="Classement général" subtitle="Cliquez un joueur pour voir le détail des scores">
          {v.ranking.length === 0 ? (
            <Empty icon={<Trophy size={28} />} title="Aucun joueur classé pour le moment.">
              Le classement apparaîtra dès le premier tournoi exporté (depuis la fin d’un live ou l’historique).
            </Empty>
          ) : (
            <RankingList ranking={v.ranking} onPick={setPick} />
          )}
        </Section>
        <div className="space-y-5">
          <Section title="Lien public">
            <Toggle checked={c.published} onChange={(p) => patch({ published: p }, p ? 'Classement publié' : 'Classement dépublié')} label={c.published ? 'Publié' : 'Non publié'} hint="Page de classement consultable sans compte" />
            {c.published && (
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-ghost btn-sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(publicUrl);
                      toast('Lien copié');
                    } catch {
                      toast('Impossible de copier le lien.', 'error');
                    }
                  }}
                >
                  <Copy size={14} /> Copier
                </button>
                <a className="btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Ouvrir
                </a>
              </div>
            )}
          </Section>
          <Section title="Jokers" subtitle="Nombre de meilleurs résultats comptabilisés">
            <JokersField value={c.bestResults} onChange={(b) => patch({ bestResults: b })} />
          </Section>
          <Section title="Historique des imports">
            {v.imports.length === 0 ? (
              <p className="text-sm text-zinc-400">Aucun import enregistré.</p>
            ) : (
              <ul className="space-y-2">
                {v.imports.map((i) => (
                  <li key={i.id} className={cx('flex items-center justify-between gap-2 text-sm', i.cancelledAt && 'text-zinc-500 line-through')}>
                    <span>
                      {i.tournamentName}
                      <span className="block text-xs text-zinc-500">
                        {fmtDate(i.playedAt ?? i.importedAt)} · {i.entries} entrées
                      </span>
                    </span>
                    {!i.cancelledAt && (
                      <button
                        className="rounded-lg p-1.5 text-zinc-400 hover:text-red-300"
                        title="Annuler l'import"
                        onClick={async () => {
                          if (await confirm({ title: 'Annuler cet import ?', lines: ['Les points correspondants seront retirés de tous les joueurs.'], confirmLabel: "Annuler l'import", danger: true })) {
                            await api.del(`/championships/${c.id}/imports/${i.id}`);
                            refresh();
                          }
                        }}
                      >
                        <Undo2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Bonus">
            {v.bonuses.length === 0 ? (
              <p className="text-sm text-zinc-400">Aucun bonus enregistré.</p>
            ) : (
              <ul className="space-y-2">
                {v.bonuses.map((b) => (
                  <li key={b.id} className={cx('flex items-center justify-between gap-2 text-sm', b.cancelledAt && 'text-zinc-500 line-through')}>
                    <span>
                      <b>+{b.points}</b> {b.playerName}
                      <span className="block text-xs text-zinc-500">{b.justification}</span>
                    </span>
                    {!b.cancelledAt && (
                      <button
                        className="rounded-lg p-1.5 text-zinc-400 hover:text-red-300"
                        title="Annuler ce bonus"
                        onClick={async () => {
                          if (await confirm({ title: 'Annuler ce bonus ?', danger: true })) {
                            await api.del(`/championships/${c.id}/bonuses/${b.id}`);
                            refresh();
                            toast('Bonus annulé');
                          }
                        }}
                      >
                        <Undo2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Zone sensible">
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-ghost btn-sm"
                onClick={async () => {
                  if (await confirm({ title: 'Réinitialiser les scores ?', lines: ['Tous les scores et bonus seront vidés', 'Le championnat reste, le classement repart de zéro'], confirmLabel: 'Réinitialiser les scores', danger: true })) {
                    await api.post(`/championships/${c.id}/reset-scores`);
                    refresh();
                  }
                }}
              >
                <RotateCcw size={14} /> Réinitialiser les scores
              </button>
              <button
                className="btn-danger btn-sm"
                onClick={async () => {
                  if (await confirm({ title: 'Supprimer ce championnat ?', lines: ['Le championnat et tous ses scores seront effacés'], confirmLabel: 'Supprimer', danger: true })) {
                    await api.del(`/championships/${c.id}`);
                    qc.invalidateQueries({ queryKey: ['championships'] });
                    nav('/championships');
                  }
                }}
              >
                <Trash2 size={14} /> Supprimer
              </button>
            </div>
          </Section>
        </div>
      </div>

      {pick && (
        <Modal
          open
          onClose={() => setPick(null)}
          title={`${pick.name} · ${pick.points} pts`}
          footer={
            <button className="btn-ghost" onClick={() => setBonusFor(pick.id)}>
              <Plus size={16} /> Ajouter un bonus
            </button>
          }
        >
          <PlayerDetail name={pick.name} detail={v.details[pick.id]} />
        </Modal>
      )}
      {bonusFor && <BonusModal champId={c.id} playerId={bonusFor} players={v.players} onClose={() => { setBonusFor(null); setPick(null); refresh(); }} />}
      {merge && <MergeModal champId={c.id} players={v.players} onClose={() => { setMerge(false); refresh(); }} />}
    </>
  );
}

function BonusModal({ champId, playerId, players, onClose }: { champId: string; playerId: string; players: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [points, setPoints] = useState<number | null>(5);
  const [just, setJust] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Ajouter un bonus · ${players.find((p) => p.id === playerId)?.name}`}
      footer={
        <button
          className="btn-primary"
          disabled={!points || just.trim().length < 3}
          onClick={async () => {
            try {
              await api.post(`/championships/${champId}/bonuses`, { playerId, points, justification: just });
              toast('Bonus ajouté');
              onClose();
            } catch (e) {
              toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
            }
          }}
        >
          Ajouter
        </button>
      }
    >
      <p className="mb-3 text-sm text-zinc-400">Points positifs pour un joueur déjà classé, avec une justification. Ils s’ajoutent toujours au total, hors jokers.</p>
      <div className="space-y-3">
        <div>
          <label className="label">Points bonus</label>
          <NumberField className="w-32" value={points} min={0.5} onCommit={setPoints} />
        </div>
        <div>
          <label className="label">Justification</label>
          <input className="input" value={just} onChange={(e) => setJust(e.target.value)} placeholder="Ex: Aide à la mise en place de la table" maxLength={200} />
        </div>
      </div>
    </Modal>
  );
}

function MergeModal({ champId, players, onClose }: { champId: string; players: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [keep, setKeep] = useState('');
  const [mergeId, setMergeId] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Fusionner des joueurs"
      footer={
        <button
          className="btn-primary"
          disabled={!keep || !mergeId || keep === mergeId}
          onClick={async () => {
            try {
              await api.post(`/championships/${champId}/merge`, { keepId: keep, mergeId });
              toast('Fusion réussie ! Le classement a été mis à jour.');
              onClose();
            } catch (e) {
              toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
            }
          }}
        >
          Confirmer
        </button>
      }
    >
      <p className="mb-4 text-sm text-zinc-400">Cette action combinera les points, les kills, les tournois et les bonus du joueur à fusionner vers le joueur conservé. Le joueur fusionné disparaîtra du classement.</p>
      <div className="space-y-3">
        <div>
          <label className="label">Joueur à conserver</label>
          <select className="input" value={keep} onChange={(e) => setKeep(e.target.value)}>
            <option value="">—</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Joueur à fusionner</label>
          <select className="input" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
            <option value="">—</option>
            {players
              .filter((p) => p.id !== keep)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}
