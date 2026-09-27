import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatChips, type TournamentSnapshot } from '@pokerorga/shared';
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Flag, Layers3, Play, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cx, Empty, fmtDate, Loading, Modal, NumberField, PageHeader, Section, useConfirm, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface Series {
  id: string;
  name: string;
  qualifyPct: number;
  day1Stack: number;
  status: 'open' | 'closed';
  createdAt: string;
  days?: number;
  closedDays?: number;
}
interface Qualifier {
  id: string;
  pseudo: string;
  stack: number;
  toDayId: string;
}
interface Day {
  id: string;
  label: string;
  stage: number;
  targetDayId: string | null;
  tournamentId: string | null;
  status: 'pending' | 'running' | 'closed';
  closedAt: string | null;
  stats: { entries: number; active: number; status: string; chips: number } | null;
  qualifiers: Qualifier[];
  incoming: number;
}
interface RecapRow {
  pseudo: string;
  rank: number;
  bestStage: number;
  dayLabel: string;
  kills: number;
  entries: number;
}
interface Detail {
  series: Series;
  days: Day[];
  recap: { rows: RecapRow[]; totalEntries: number };
}

const err = (e: unknown) => (e instanceof ApiError ? e.message : 'Une erreur est survenue.');

export function FlightsPage() {
  const q = useQuery({ queryKey: ['flights'], queryFn: () => api.get<{ items: Series[] }>('/flights') });
  const [creating, setCreating] = useState(false);
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Tournois flights"
        subtitle="Un dossier par tournoi multi-jours : chaque jour garde son propre chrono et ses joueurs, les qualifiés passent au jour suivant avec leur tapis."
        right={
          <button className="btn-primary" onClick={() => setCreating(true)} disabled={items.some((s) => s.status === 'open')} title={items.some((s) => s.status === 'open') ? 'Un dossier est déjà en cours.' : undefined}>
            <Plus size={16} /> Nouveau dossier
          </button>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty icon={<Layers3 size={32} />} title="Aucun dossier flight">
          Exemple : Day 1A et Day 1B qualifient vers le Day 2, puis la finale.
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <Link key={s.id} to={`/flights/${s.id}`} className="card block p-5 hover:border-accent-500/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{s.name}</h3>
                <span className={cx('chip', s.status === 'open' ? 'border-emerald-400/40 text-emerald-300' : '')}>{s.status === 'open' ? 'En cours' : 'Clôturé'}</span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                {s.closedDays}/{s.days} jour(s) clôturé(s) · tapis Day 1 {formatChips(s.day1Stack)}
              </p>
            </Link>
          ))}
        </div>
      )}
      {creating && <CreateSeries onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateSeries({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', qualifyPct: 15 as number | null, day1Stack: 20000 as number | null });
  return (
    <Modal
      open
      onClose={onClose}
      title="Nouveau dossier flight"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            disabled={!f.name.trim()}
            onClick={async () => {
              try {
                const s = await api.post<Series>('/flights', { name: f.name, qualifyPct: f.qualifyPct ?? 15, day1Stack: f.day1Stack ?? 20000 });
                qc.invalidateQueries({ queryKey: ['flights'] });
                nav(`/flights/${s.id}`);
              } catch (e) {
                toast(err(e), 'error');
              }
            }}
          >
            Créer le dossier
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Nom du tournoi</label>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Main Event" maxLength={60} data-autofocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Qualifiés par jour (%)</label>
            <NumberField value={f.qualifyPct} min={1} max={100} suffix="%" onCommit={(v) => setF({ ...f, qualifyPct: v })} />
          </div>
          <div>
            <label className="label">Tapis de départ des Day 1</label>
            <NumberField value={f.day1Stack} min={100} onCommit={(v) => setF({ ...f, day1Stack: v })} />
          </div>
        </div>
        <p className="text-xs text-zinc-400">Le dossier démarre avec un Day 1A qui qualifie vers un Day 2. Ajoutez ensuite autant de jours que nécessaire (12 au maximum).</p>
      </div>
    </Modal>
  );
}

export function FlightDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['flight', id], queryFn: () => api.get<Detail>(`/flights/${id}`), refetchInterval: 15000 });
  const champs = useQuery({ queryKey: ['championships'], queryFn: () => api.get<{ items: { id: string; name: string; archived: boolean }[] }>('/championships') });
  const [closing, setClosing] = useState<Day | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [champ, setChamp] = useState('');
  if (q.isLoading) return <Loading label="Chargement du dossier…" />;
  if (!q.data) return <Empty title="Dossier introuvable." />;
  const { series, days, recap } = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['flight', id] });
    qc.invalidateQueries({ queryKey: ['flights'] });
    qc.invalidateQueries({ queryKey: ['lives'] });
  };
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      const r = await fn();
      refresh();
      if (msg) toast(msg);
      return r;
    } catch (e) {
      toast(err(e), 'error');
    }
  };
  const stages = [...new Set(days.map((d) => d.stage))].sort((a, b) => a - b);
  const maxStage = Math.max(...stages, 1);
  const label = (dayId: string | null) => days.find((d) => d.id === dayId)?.label ?? '—';
  const open = series.status === 'open';

  return (
    <>
      <Link to="/flights" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft size={14} /> Tournois flights
      </Link>
      <PageHeader
        title={series.name}
        subtitle={`Tapis Day 1 : ${formatChips(series.day1Stack)} · qualifiés visés : ${series.qualifyPct} % · créé le ${fmtDate(series.createdAt)}`}
        right={
          <>
            <a className="btn-ghost" href={`/api/flights/${series.id}/recap.csv`}>
              <Download size={16} /> CSV
            </a>
            {open && (
              <button
                className="btn-primary"
                onClick={async () => {
                  if (await confirm({ title: 'Clôturer ce tournoi flight ?', lines: ['Tous les jours doivent être clôturés', 'Tournois et résultats restent dans l’historique'], confirmLabel: 'Clôturer' })) await act(() => api.post(`/flights/${series.id}/close`), 'Dossier clôturé.');
                }}
              >
                <Flag size={16} /> Clôturer le dossier
              </button>
            )}
            <button
              className="btn-danger"
              onClick={async () => {
                if (await confirm({ title: 'Supprimer ce dossier ?', lines: ['Les jours jamais lancés sont supprimés', 'Les lives déjà joués restent dans l’historique'], confirmLabel: 'Supprimer', danger: true })) {
                  const r = await act(() => api.del(`/flights/${series.id}`), 'Dossier supprimé.');
                  if (r) nav('/flights');
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        }
      />

      <div className="mb-6 flex gap-4 overflow-x-auto pb-2">
        {stages.map((stage, i) => (
          <div key={stage} className="flex items-stretch gap-4">
            <div className="w-[min(18rem,calc(100vw-4rem))] shrink-0 space-y-3">
              <p className="eyebrow">{stage === maxStage && days.filter((d) => d.stage === stage).every((d) => !d.targetDayId) ? `Étage ${stage} · finale` : `Étage ${stage}`}</p>
              {days
                .filter((d) => d.stage === stage)
                .map((d) => (
                  <DayCard
                    key={d.id}
                    day={d}
                    target={label(d.targetDayId)}
                    seriesOpen={open}
                    blocked={days.some((f) => f.targetDayId === d.id && f.status !== 'closed')}
                    onLaunch={async () => {
                      const r = (await act(() => api.post<{ tournamentId: string }>(`/flights/${series.id}/days/${d.id}/launch`), `${d.label} lancé.`)) as { tournamentId: string } | undefined;
                      if (r) nav(`/live/${r.tournamentId}`);
                    }}
                    onClose={() => setClosing(d)}
                    onDelete={async () => {
                      if (await confirm({ title: `Supprimer ${d.label} ?`, danger: true, confirmLabel: 'Supprimer ce jour' })) await act(() => api.del(`/flights/${series.id}/days/${d.id}`));
                    }}
                  />
                ))}
              {open && (
                <button className="btn-ghost btn-sm w-full" onClick={() => setAdding(stage)}>
                  <Plus size={14} /> Ajouter un jour
                </button>
              )}
            </div>
            {i < stages.length - 1 && <ArrowRight className="mt-10 shrink-0 text-zinc-600" />}
          </div>
        ))}
        {open && (
          <button className="btn-ghost h-fit shrink-0 self-start" onClick={() => setAdding(maxStage + 1)}>
            <Plus size={14} /> Étage {maxStage + 1}
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Section title="Classement global" subtitle={`${recap.totalEntries} entrée(s) sur les Day 1 · finale d'abord, puis éliminés du plus tardif au plus précoce`}>
          {recap.rows.length === 0 ? (
            <p className="text-sm text-zinc-400">Aucun joueur dans ce dossier.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-zinc-400">
                  <th className="py-2">Place</th>
                  <th>Joueur</th>
                  <th>Meilleur jour</th>
                  <th className="text-right">Kills</th>
                </tr>
              </thead>
              <tbody>
                {recap.rows.map((r) => (
                  <tr key={r.pseudo} className="border-t border-white/5">
                    <td className="py-1.5 font-bold tabular">{r.rank}</td>
                    <td className="font-semibold">{r.pseudo}</td>
                    <td className="text-zinc-400">{r.dayLabel}</td>
                    <td className="text-right tabular">{r.kills}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Exporter vers un championnat">
          {open ? (
            <p className="text-sm text-zinc-400">Disponible une fois le dossier clôturé.</p>
          ) : (
            <div className="space-y-2">
              <select className="input" value={champ} onChange={(e) => setChamp(e.target.value)}>
                <option value="">-- Choisissez un championnat --</option>
                {(champs.data?.items ?? [])
                  .filter((c) => !c.archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <button className="btn-ghost w-full" disabled={!champ} onClick={() => act(() => api.post(`/flights/${series.id}/export`, { championshipId: champ }), 'Résultats envoyés au championnat !')}>
                <Send size={15} /> Envoyer
              </button>
            </div>
          )}
        </Section>
      </div>

      {closing && <CloseDayModal seriesId={series.id} day={closing} target={label(closing.targetDayId)} onClose={() => { setClosing(null); refresh(); }} />}
      {adding != null && <AddDayModal seriesId={series.id} stage={adding} days={days} onClose={() => { setAdding(null); refresh(); }} />}
    </>
  );
}

function DayCard({ day, target, seriesOpen, blocked, onLaunch, onClose, onDelete }: { day: Day; target: string; seriesOpen: boolean; blocked: boolean; onLaunch: () => void; onClose: () => void; onDelete: () => void }) {
  const status = { pending: 'Pas encore lancé', running: 'En cours', closed: 'Clôturé' }[day.status];
  return (
    <div className={cx('card p-4', day.status === 'running' && 'border-accent-500/50')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold">{day.label}</p>
          <p className="text-xs text-zinc-400">{day.targetDayId ? `Qualifie vers : ${target}` : 'Finale'}</p>
        </div>
        <span className={cx('chip text-[10px]', day.status === 'running' && 'border-emerald-400/40 text-emerald-300')}>{status}</span>
      </div>
      {day.stage > 1 && day.status === 'pending' && <p className="mt-2 text-xs text-zinc-400">{day.incoming} qualifié(s) en attente</p>}
      {day.stats && (
        <p className="mt-2 text-sm text-zinc-300">
          {day.status === 'closed' ? `${day.stats.entries} entrée(s)` : `${day.stats.active} en jeu / ${day.stats.entries} entrée(s)`} · {formatChips(day.stats.chips)} jetons
        </p>
      )}
      {day.qualifiers.length > 0 && (
        <details className="mt-2 text-xs text-zinc-400">
          <summary className="cursor-pointer">{day.qualifiers.length} qualifié(s)</summary>
          <ul className="mt-1 space-y-0.5">
            {day.qualifiers.map((q) => (
              <li key={q.id} className="flex justify-between">
                <span>{q.pseudo}</span>
                <span className="tabular">{formatChips(q.stack)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {seriesOpen && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {day.status === 'pending' && (
            <>
              <button className="btn-primary btn-sm" onClick={onLaunch} disabled={blocked} title={blocked ? "Tous les jours qui alimentent celui-ci doivent être clôturés avant de le lancer." : undefined}>
                <Play size={13} /> Lancer
              </button>
              <button className="btn-ghost btn-sm" onClick={onDelete} aria-label="Supprimer ce jour">
                <Trash2 size={13} />
              </button>
            </>
          )}
          {day.status === 'running' && (
            <>
              <Link className="btn-ghost btn-sm" to={`/live/${day.tournamentId}`}>
                Ouvrir le live
              </Link>
              <button className="btn-primary btn-sm" onClick={onClose}>
                <CheckCircle2 size={13} /> {day.targetDayId ? 'Clôturer et baguer' : 'Clôturer la finale'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddDayModal({ seriesId, stage, days, onClose }: { seriesId: string; stage: number; days: Day[]; onClose: () => void }) {
  const toast = useToast();
  const letters = 'ABCDEFGHIJ';
  const same = days.filter((d) => d.stage === stage).length;
  const higher = days.filter((d) => d.stage > stage);
  const [labelTxt, setLabel] = useState(stage === 1 ? `Day 1${letters[same] ?? same + 1}` : `Day ${stage}`);
  const [target, setTarget] = useState(higher[0]?.id ?? '');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Ajouter un jour à l'étage ${stage}`}
      footer={
        <button
          className="btn-primary"
          disabled={!labelTxt.trim()}
          onClick={async () => {
            try {
              await api.post(`/flights/${seriesId}/days`, { label: labelTxt, stage, targetDayId: target || null });
              onClose();
            } catch (e) {
              toast(err(e), 'error');
            }
          }}
        >
          Ajouter
        </button>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Nom du jour</label>
          <input className="input" value={labelTxt} onChange={(e) => setLabel(e.target.value)} maxLength={30} data-autofocus />
        </div>
        <div>
          <label className="label">Qualifie vers</label>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Aucun (finale)</option>
            {higher.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          {higher.length === 0 && <p className="mt-1 text-xs text-zinc-500">Ajoutez d'abord un jour à un étage supérieur pour y envoyer les qualifiés.</p>}
        </div>
      </div>
    </Modal>
  );
}

/** Clôture d'un jour : saisie des tapis bagués des joueurs encore en jeu. */
function CloseDayModal({ seriesId, day, target, onClose }: { seriesId: string; day: Day; target: string; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  // lecture fraîche : le snapshot du live en cache peut dater d'avant les dernières éliminations
  const q = useQuery({ queryKey: ['flight-close', day.tournamentId], queryFn: () => api.get<TournamentSnapshot>(`/tournaments/${day.tournamentId}/full`), staleTime: 0, gcTime: 0 });
  const [stacks, setStacks] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  if (q.isLoading || !q.data) return <Loading />;
  const active = q.data.players.filter((p) => p.status === 'active');
  const total = q.data.stats.chipsInPlay;
  const sum = active.reduce((a, p) => a + (stacks[p.id] ?? 0), 0);
  const missing = active.filter((p) => !stacks[p.id]);
  const spread = () => {
    const rest = total - sum;
    if (missing.length === 0 || rest <= 0) return;
    const each = Math.floor(rest / missing.length / 100) * 100;
    const next = { ...stacks };
    missing.forEach((p, i) => (next[p.id] = i === missing.length - 1 ? rest - each * (missing.length - 1) : each));
    setStacks(next);
  };
  const submit = async () => {
    if (day.targetDayId && missing.length) return toast('Chaque joueur encore en jeu doit avoir un tapis saisi.', 'error');
    if (day.targetDayId && sum !== total) {
      const ok = await confirm({ title: 'Écart de jetons', lines: [`Somme saisie : ${formatChips(sum)}`, `Total théorique du jour : ${formatChips(total)}`, "L'écart sera conservé tel quel."], confirmLabel: 'Clôturer quand même' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.post(`/flights/${seriesId}/days/${day.id}/close`, { stacks: Object.fromEntries(Object.entries(stacks).filter(([, v]) => v)) });
      toast(`${day.label} clôturé.`);
      onClose();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={day.targetDayId ? `Clôturer ${day.label} et baguer les tapis` : `Clôturer ${day.label} (finale)`}
      size="lg"
      footer={
        <>
          {day.targetDayId && (
            <button className="btn-ghost mr-auto" onClick={spread} disabled={missing.length === 0}>
              Répartir le reste
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Clôture…' : 'Vérifier et clôturer'}
          </button>
        </>
      }
    >
      {day.targetDayId ? (
        <>
          <p className="mb-3 text-sm text-zinc-400">
            Les {active.length} joueur(s) encore en jeu partent vers <b className="text-zinc-200">{target}</b> avec le tapis saisi. Le live est ensuite archivé.
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <p>
              Total théorique : <b>{formatChips(total)}</b>
            </p>
            <p className={cx(sum === total ? 'text-emerald-300' : 'text-amber-300')}>
              Somme saisie : <b>{formatChips(sum)}</b>
            </p>
          </div>
          <div className="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {active.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <span className="flex-1 truncate font-semibold">{p.pseudo}</span>
                <NumberField className="w-32" value={stacks[p.id] ?? null} min={1} allowEmpty onCommit={(v) => setStacks({ ...stacks, [p.id]: v })} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-300">{active.length > 1 ? `Il reste ${active.length} joueurs en jeu : ils seront classés à égalité de fin de journée.` : 'La finale est terminée : le live est archivé et le classement global est figé.'}</p>
      )}
    </Modal>
  );
}
