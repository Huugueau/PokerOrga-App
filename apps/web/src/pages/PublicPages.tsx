import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@pokerorga/shared';
import { CalendarDays, Expand, LayoutGrid, List, MapPin, Pause, Play, Printer, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cx, Empty, fmtDate, Loading, Modal } from '../components/ui';
import { api, ApiError, assetUrl } from '../lib/api';
import { PlayerDetail, RankingList, type Detail, type RankRow } from './ChampionshipPages';

function PublicFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-felt min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
      <p className="pb-6 text-center text-xs text-zinc-500 no-print">
        Organisé avec Poker<span className="text-accent-500">Orga</span>
      </p>
    </div>
  );
}

interface Plan {
  title: string;
  logoAssetId: string | null;
  maxPerTable: number;
  version: number;
  stats: { activePlayers: number; totalEntries: number };
  tables: { number: number; isFinal: boolean; seats: { seat: number | null; pseudo: string }[] }[];
}

export function PublicPlanPage() {
  const { token } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', token], queryFn: () => api.get<Plan>(`/public/plan/${token}`), retry: false });
  const [view, setView] = useState<'tables' | 'list'>('tables');
  const [auto, setAuto] = useState(true);
  const [page, setPage] = useState(0);
  const perPage = 6;
  useEffect(() => {
    const es = new EventSource(`/api/public/plan/${token}/stream`);
    es.onmessage = () => qc.invalidateQueries({ queryKey: ['plan', token] });
    return () => es.close();
  }, [token, qc]);
  const pages = Math.max(1, Math.ceil((q.data?.tables.length ?? 0) / perPage));
  useEffect(() => {
    if (!auto || pages <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), 10000);
    return () => clearInterval(t);
  }, [auto, pages]);
  if (q.isLoading) return <Loading label="Chargement du plan…" />;
  if (q.error) return <PublicFrame><Empty title={q.error instanceof ApiError ? q.error.message : 'Impossible de charger le plan des tables.'} /></PublicFrame>;
  const d = q.data!;
  const shown = d.tables.slice(page * perPage, page * perPage + perPage);
  const all = d.tables.flatMap((t) => t.seats.map((s) => ({ ...s, table: t.number }))).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  return (
    <PublicFrame>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {d.logoAssetId && <img src={assetUrl(d.logoAssetId)!} alt="Logo organisateur" className="h-12 max-w-[160px] object-contain" />}
          <div>
            <h1 className="text-2xl font-black">Plan des tables — {d.title}</h1>
            <p className="text-sm text-zinc-400">
              {d.stats.activePlayers} joueurs en lice · {d.tables.length} table(s)
            </p>
          </div>
        </div>
        <div className="flex gap-2 no-print">
          <button className="btn-ghost btn-sm" onClick={() => setView(view === 'tables' ? 'list' : 'tables')}>
            {view === 'tables' ? <List size={15} /> : <LayoutGrid size={15} />} {view === 'tables' ? 'Vue liste' : 'Vue tables'}
          </button>
          {view === 'tables' && pages > 1 && (
            <button className="btn-ghost btn-sm" onClick={() => setAuto(!auto)} title={auto ? 'Mettre en pause le défilement' : 'Défiler les pages automatiquement'}>
              {auto ? <Pause size={15} /> : <Play size={15} />}
            </button>
          )}
          <button className="btn-ghost btn-sm" onClick={() => window.print()}>
            <Printer size={15} />
          </button>
          <button className="btn-ghost btn-sm" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>
            <Expand size={15} />
          </button>
        </div>
      </div>
      {d.tables.length === 0 ? (
        <Empty icon={<Users size={32} />} title="Aucun joueur actif placé pour le moment." />
      ) : view === 'tables' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => (
              <div key={t.number} className={cx('card p-4', t.isFinal && 'border-accent-500/60')}>
                <h2 className="mb-3 text-lg font-black">{t.isFinal ? '🏆 Table finale' : `Table ${t.number}`}</h2>
                <ul className="space-y-1">
                  {Array.from({ length: d.maxPerTable }, (_, i) => i + 1).map((s) => {
                    const p = t.seats.find((x) => x.seat === s);
                    return (
                      <li key={s} className={cx('flex gap-3 rounded-lg px-3 py-1.5 text-sm', p ? 'bg-white/5' : 'text-zinc-600')}>
                        <span className="w-14 font-bold text-zinc-400">Siège {s}</span>
                        <span className="font-semibold">{p?.pseudo ?? 'Libre'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 no-print" aria-label="Pagination des tables">
              {Array.from({ length: pages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)} className={cx('h-2.5 w-2.5 rounded-full', i === page ? 'bg-accent-500' : 'bg-white/20')} aria-label={`Page ${i + 1}`} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="card columns-1 gap-6 p-5 sm:columns-2 lg:columns-3">
          {all.map((p) => (
            <p key={p.pseudo} className="flex break-inside-avoid justify-between border-b border-white/5 py-1.5 text-sm">
              <span className="font-semibold">{p.pseudo}</span>
              <span className="tabular text-zinc-400">
                T{p.table} · S{p.seat}
              </span>
            </p>
          ))}
        </div>
      )}
    </PublicFrame>
  );
}

interface PublicRanking {
  name: string;
  type: string;
  bestResults: number | null;
  organizer: string | null;
  ranking: RankRow[];
  imports: number;
  details: Record<string, Detail>;
}

export function PublicRankingPage() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ['pub-ranking', token], queryFn: () => api.get<PublicRanking>(`/public/ranking/${token}`), retry: false });
  const [pick, setPick] = useState<RankRow | null>(null);
  if (q.isLoading) return <Loading label="Chargement du classement…" />;
  if (q.error) return <PublicFrame><Empty title="Classement indisponible">Ce championnat n’est pas publié, ou le lien n’est plus valide.</Empty></PublicFrame>;
  const d = q.data!;
  const podium = d.ranking.slice(0, 3);
  return (
    <PublicFrame>
      <div className="mb-6 text-center">
        {d.organizer && <p className="eyebrow">{d.organizer}</p>}
        <h1 className="text-3xl font-black">{d.name}</h1>
        <p className="text-sm text-zinc-400">
          {d.imports} tournoi(s) · {d.bestResults ? `${d.bestResults} meilleurs résultats retenus (jokers)` : 'Tous les résultats comptent'}
        </p>
      </div>
      {d.ranking.length === 0 ? (
        <Empty icon={<Trophy size={32} />} title="Aucun résultat importé pour l’instant.">
          Le classement apparaîtra dès le premier tournoi exporté.
        </Empty>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 items-end gap-3">
            {[podium[1], podium[0], podium[2]].map((p, i) =>
              p ? (
                <div key={p.id} className={cx('card p-4 text-center', i === 1 && 'border-accent-500/60 pb-8')}>
                  <p className="text-3xl">{['🥈', '🥇', '🥉'][i]}</p>
                  <p className="mt-1 truncate font-bold">{p.name}</p>
                  <p className="text-sm text-accent-300">{p.points} pts</p>
                </div>
              ) : (
                <div key={i} />
              ),
            )}
          </div>
          <div className="card p-5">
            <p className="mb-3 text-xs text-zinc-400">Touchez un joueur pour voir les tournois et les bonus.</p>
            <RankingList ranking={d.ranking} onPick={setPick} />
          </div>
        </>
      )}
      {pick && (
        <Modal open onClose={() => setPick(null)} title={`${pick.name} · ${pick.points} pts`}>
          <PlayerDetail name={pick.name} detail={d.details[pick.id]} />
        </Modal>
      )}
    </PublicFrame>
  );
}

interface PublicEvent {
  name: string;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  capacity: number | null;
  maxPerTable: number;
  startStack: number;
  financialMode: 'money' | 'lots' | 'free';
  buyin: number;
  description: string | null;
  options: { id: string; label: string }[];
  status: string;
  organizer: string | null;
  taken: number;
  participants: string[];
  waitlist: number;
}

export function PublicRegisterPage() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ['pub-event', token], queryFn: () => api.get<PublicEvent>(`/public/events/${token}`), retry: false });
  const [f, setF] = useState({ pseudo: '', firstName: '', lastName: '', email: '' });
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no' | 'unknown'>>({});
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <PublicFrame><Empty title="Page d’inscription introuvable." /></PublicFrame>;
  const e = q.data!;
  const full = e.capacity != null && e.taken >= e.capacity;
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (!f.pseudo.trim()) return setErr('Veuillez saisir un pseudo.');
    if (e.options.some((o) => !answers[o.id])) return setErr('Merci de répondre à toutes les options.');
    setBusy(true);
    try {
      const r = await api.post<{ status: string }>(`/public/events/${token}/register`, { ...f, answers });
      setDone(r.status);
      q.refetch();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Inscription impossible.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicFrame>
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="card p-6">
          {e.organizer && <p className="eyebrow">{e.organizer}</p>}
          <h1 className="mt-1 text-3xl font-black">{e.name}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-300">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={15} /> {e.eventDate ? fmtDate(e.eventDate) : 'Date à définir'}
              {e.eventTime ? ` · ${e.eventTime}` : ''}
            </span>
            {e.location && (
              <span className="flex items-center gap-1.5">
                <MapPin size={15} /> {e.location}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Users size={15} /> {e.taken}
              {e.capacity ? ` / ${e.capacity}` : ''} inscrit(s)
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="chip">{e.maxPerTable}-max</span>
            <span className="chip">Stack {e.startStack.toLocaleString('fr-FR')}</span>
            <span className="chip">{e.financialMode === 'money' ? `Buy-in ${formatMoney(e.buyin)}` : e.financialMode === 'lots' ? 'Dotation en lots' : 'Gratuit'}</span>
          </div>
          {e.description && <p className="mt-4 whitespace-pre-line text-sm text-zinc-300">{e.description}</p>}
        </div>

        <div className="card p-6">
          {done ? (
            <div className="py-6 text-center">
              <p className="text-2xl font-black">{done === 'waitlist' ? "Vous êtes sur liste d'attente" : 'Inscription enregistrée.'}</p>
              <p className="mt-2 text-sm text-zinc-400">{done === 'waitlist' ? "L'organisateur vous contactera si une place se libère." : "L'organisateur doit encore valider votre inscription."}</p>
            </div>
          ) : e.status !== 'open' ? (
            <p className="py-6 text-center font-semibold text-zinc-300">Les inscriptions sont closes.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h2 className="text-lg font-bold">S'inscrire</h2>
              {full && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">Complet : votre inscription sera placée en liste d'attente.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label">Pseudo *</label>
                  <input className="input" value={f.pseudo} onChange={(x) => setF({ ...f, pseudo: x.target.value })} maxLength={40} />
                </div>
                <div>
                  <label className="label">Prénom</label>
                  <input className="input" value={f.firstName} onChange={(x) => setF({ ...f, firstName: x.target.value })} />
                </div>
                <div>
                  <label className="label">Nom</label>
                  <input className="input" value={f.lastName} onChange={(x) => setF({ ...f, lastName: x.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Email (facultatif)</label>
                  <input className="input" type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} />
                </div>
              </div>
              {e.options.map((o) => (
                <div key={o.id}>
                  <label className="label !normal-case !tracking-normal !text-sm !text-zinc-200">{o.label}</label>
                  <div className="flex gap-2">
                    {(['yes', 'no', 'unknown'] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setAnswers({ ...answers, [o.id]: v })} className={cx('rounded-xl border px-3 py-1.5 text-sm font-semibold', answers[o.id] === v ? 'border-accent-500 bg-accent-500/15 text-accent-300' : 'border-white/10 bg-white/5')}>
                        {{ yes: 'Oui', no: 'Non', unknown: 'Ne sais pas' }[v]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
              <button className="btn-primary w-full py-3" disabled={busy}>
                {busy ? 'Envoi…' : full ? "S'inscrire en liste d'attente" : "S'inscrire"}
              </button>
            </form>
          )}
        </div>
        {e.participants.length > 0 && (
          <div className="card p-6">
            <h2 className="mb-3 font-bold">Participants validés ({e.participants.length})</h2>
            <div className="flex flex-wrap gap-1.5">
              {e.participants.map((p) => (
                <span key={p} className="chip">
                  {p}
                </span>
              ))}
            </div>
            {e.waitlist > 0 && <p className="mt-3 text-xs text-zinc-400">{e.waitlist} personne(s) en liste d'attente.</p>}
          </div>
        )}
      </div>
    </PublicFrame>
  );
}
