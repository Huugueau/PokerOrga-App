import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@pokerorga/shared';
import { ArrowLeft, CalendarDays, Check, Copy, Download, ExternalLink, Import, MapPin, Pencil, Plus, Trash2, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cx, Empty, fmtDate, Loading, Modal, NumberField, PageHeader, Section, Segmented, useConfirm, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';

export interface EventRow {
  id: string;
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
  status: 'draft' | 'open' | 'closed' | 'imported';
  publicToken: string;
  tournamentId: string | null;
  counts?: Record<string, number>;
}
interface Reg {
  id: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  answers: Record<string, 'yes' | 'no' | 'unknown'>;
  status: 'pending' | 'validated' | 'waitlist' | 'refused' | 'cancelled';
  present: boolean;
  createdAt: string;
}

export const STATUS_LABEL: Record<EventRow['status'], string> = { draft: 'Brouillon', open: 'Inscriptions ouvertes', closed: 'Inscriptions closes', imported: 'Importée' };
const STATUS_COLOR: Record<EventRow['status'], string> = { draft: 'text-zinc-300', open: 'border-emerald-400/40 text-emerald-300', closed: 'border-amber-400/40 text-amber-300', imported: 'text-zinc-400' };

export function PlanningPage() {
  const q = useQuery({ queryKey: ['events'], queryFn: () => api.get<{ items: EventRow[] }>('/events') });
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const items = (q.data?.items ?? []).filter((e) => (filter === 'active' ? e.status !== 'imported' : e.status === 'imported'));
  return (
    <>
      <PageHeader
        title="Mon planning"
        subtitle="Structurez vos tournois à l'avance : pages d'inscription en ligne, liste d'attente, et import des joueurs validés en un clic."
        right={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Ajouter un événement
          </button>
        }
      />
      <div className="mb-4">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Événements actifs' },
            { value: 'archived', label: 'Événements archivés' },
          ]}
        />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty icon={<CalendarDays size={32} />} title={filter === 'active' ? 'Aucun événement en cours.' : 'Aucun événement archivé.'}>
          {filter === 'active' ? 'Créez un événement pour commencer.' : 'Les événements importés apparaîtront ici.'}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <Link key={e.id} to={`/planning/${e.id}`} className="card block p-5 hover:border-accent-500/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold">{e.name}</h3>
                <span className={cx('chip', STATUS_COLOR[e.status])}>{STATUS_LABEL[e.status]}</span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                {e.eventDate ? fmtDate(e.eventDate) : 'Date à définir'}
                {e.eventTime ? ` · ${e.eventTime}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <span className="chip">À valider : {e.counts?.pending ?? 0}</span>
                <span className="chip">Validés : {e.counts?.validated ?? 0}</span>
                {e.capacity && <span className="chip">Capacité : {e.capacity}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <EventForm onClose={() => setCreating(false)} />}
    </>
  );
}

function EventForm({ event, onClose }: { event?: EventRow; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    name: event?.name ?? '',
    eventDate: event?.eventDate ?? '',
    eventTime: event?.eventTime ?? '',
    location: event?.location ?? '',
    capacity: event?.capacity ?? null,
    maxPerTable: event?.maxPerTable ?? 10,
    startStack: event?.startStack ?? 10000,
    financialMode: event?.financialMode ?? 'money',
    buyin: event?.buyin ?? 10,
    description: event?.description ?? '',
    options: event?.options ?? [],
  });
  const optionsLocked = !!event && event.status !== 'draft';
  const submit = async () => {
    try {
      const body = { ...f, eventDate: f.eventDate || null, eventTime: f.eventTime || null, location: f.location || null, description: f.description || null };
      if (event) {
        await api.patch(`/events/${event.id}`, body);
        toast('Brouillon mis à jour.');
        qc.invalidateQueries({ queryKey: ['event', event.id] });
        onClose();
      } else {
        const r = await api.post<EventRow>('/events', body);
        toast('Événement créé (brouillon).');
        nav(`/planning/${r.id}`);
      }
      qc.invalidateQueries({ queryKey: ['events'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Une erreur est survenue.', 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={event ? "Modifier l'événement" : 'Nouvel événement'}
      size="lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={submit} disabled={!f.name.trim()}>
            {event ? 'Enregistrer les modifications' : 'Créer le brouillon'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Nom de l'événement *</label>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Tournoi du samedi" maxLength={80} data-autofocus />
        </div>
        <div>
          <label className="label">Date</label>
          <input className="input" type="date" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} />
        </div>
        <div>
          <label className="label">Heure</label>
          <input className="input" type="time" value={f.eventTime} onChange={(e) => setF({ ...f, eventTime: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Lieu (optionnel)</label>
          <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Adresse ou salle" />
        </div>
        <div>
          <label className="label">Capacité max</label>
          <NumberField value={f.capacity} min={2} max={1000} allowEmpty onCommit={(v) => setF({ ...f, capacity: v })} />
          <p className="mt-1 text-xs text-zinc-500">Vide = illimité. Au-delà : liste d'attente.</p>
        </div>
        <div>
          <label className="label">Format (joueurs / table)</label>
          <select className="input" value={f.maxPerTable} onChange={(e) => setF({ ...f, maxPerTable: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n === 2 ? "2 (Head's up)" : n === 10 ? '10 (Full ring)' : `${n}-max`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Stack de départ</label>
          <NumberField value={f.startStack} min={1} onCommit={(v) => setF({ ...f, startStack: v ?? 10000 })} />
        </div>
        <div>
          <label className="label">Mode financier</label>
          <select className="input" value={f.financialMode} onChange={(e) => setF({ ...f, financialMode: e.target.value as EventRow['financialMode'] })}>
            <option value="money">Buy-in en argent</option>
            <option value="lots">Dotation en lots</option>
            <option value="free">Gratuit</option>
          </select>
        </div>
        {f.financialMode === 'money' && (
          <div>
            <label className="label">Buy-in (€)</label>
            <NumberField value={f.buyin} suffix="€" onCommit={(v) => setF({ ...f, buyin: v ?? 0 })} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <textarea className="input min-h-20" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} placeholder="Infos pratiques, règles, repas…" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Options posées aux joueurs</label>
          <p className="mb-2 text-xs text-zinc-500">Les choix de réponses pour les options sont Oui / Non / Ne sais pas.{optionsLocked && ' Les options sont figées après publication.'}</p>
          <div className="space-y-2">
            {f.options.map((o, i) => (
              <div key={o.id} className="flex gap-2">
                <input
                  className="input"
                  value={o.label}
                  disabled={optionsLocked}
                  onChange={(e) => setF({ ...f, options: f.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  placeholder="Présent au repas, prévoir 15€"
                />
                {!optionsLocked && (
                  <button className="rounded-lg p-2 text-zinc-400 hover:text-red-300" onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })} aria-label="Supprimer l'option">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            {!optionsLocked && f.options.length < 10 && (
              <button className="btn-ghost btn-sm" onClick={() => setF({ ...f, options: [...f.options, { id: crypto.randomUUID(), label: '' }] })}>
                <Plus size={14} /> Ajouter une option
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const TABS: { key: string; label: string; filter: (r: Reg) => boolean }[] = [
  { key: 'pending', label: 'À valider', filter: (r) => r.status === 'pending' },
  { key: 'validated', label: 'Validés', filter: (r) => r.status === 'validated' },
  { key: 'present', label: 'Présents', filter: (r) => r.status === 'validated' && r.present },
  { key: 'waitlist', label: "Liste d'attente", filter: (r) => r.status === 'waitlist' },
  { key: 'refused', label: 'Refusés', filter: (r) => r.status === 'refused' || r.status === 'cancelled' },
];

export function EventDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api.get<{ event: EventRow; registrations: Reg[] }>(`/events/${id}`), refetchInterval: 15000 });
  const [tab, setTab] = useState('pending');
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  if (q.isLoading) return <Loading label="Chargement des inscriptions…" />;
  if (!q.data) return <Empty title="Événement introuvable." />;
  const e = q.data.event;
  const regs = q.data.registrations;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['event', id] });
    qc.invalidateQueries({ queryKey: ['events'] });
  };
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      refresh();
      if (msg) toast(msg);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Une erreur est survenue.', 'error');
    }
  };
  const setStatus = (status: string, msg: string) => act(() => api.post(`/events/${e.id}/status`, { status }), msg);
  const publicUrl = `${window.location.origin}/p/register/${e.publicToken}`;
  const current = TABS.find((t) => t.key === tab)!;
  const list = regs.filter(current.filter);
  const locked = e.status === 'imported';

  return (
    <>
      <Link to="/planning" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft size={14} /> Mon planning
      </Link>
      <PageHeader
        title={e.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span className={cx('chip', STATUS_COLOR[e.status])}>{STATUS_LABEL[e.status]}</span>
            <span>
              {e.eventDate ? fmtDate(e.eventDate) : 'Date à définir'}
              {e.eventTime ? ` · ${e.eventTime}` : ''}
            </span>
            {e.location && (
              <span className="flex items-center gap-1">
                <MapPin size={13} /> {e.location}
              </span>
            )}
          </span>
        }
        right={
          <>
            {!locked && (
              <button className="btn-ghost" onClick={() => setEditing(true)}>
                <Pencil size={16} /> Modifier
              </button>
            )}
            {e.status === 'draft' && (
              <button className="btn-primary" onClick={() => setStatus('open', 'Inscriptions ouvertes.')}>
                Publier et ouvrir les inscriptions
              </button>
            )}
            {e.status === 'open' && (
              <button className="btn-ghost" onClick={() => setStatus('closed', 'Inscriptions closes.')}>
                Clôturer les inscriptions
              </button>
            )}
            {e.status === 'closed' && (
              <button className="btn-ghost" onClick={() => setStatus('open', 'Inscriptions rouvertes.')}>
                Rouvrir les inscriptions
              </button>
            )}
            <button
              className="btn-danger"
              onClick={async () => {
                if (await confirm({ title: "Supprimer l'événement ?", lines: ['L’événement et ses préinscriptions seront effacés'], confirmLabel: 'Supprimer', danger: true })) {
                  await api.del(`/events/${e.id}`);
                  qc.invalidateQueries({ queryKey: ['events'] });
                  toast('Événement supprimé.');
                  nav('/planning');
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Section
          title="Participants"
          subtitle={`Total : ${regs.length} · Capacité : ${e.capacity ?? 'illimitée'}`}
          right={
            <div className="flex flex-wrap gap-2">
              {!locked && (
                <button className="btn-ghost btn-sm" onClick={() => setAdding(true)}>
                  <Plus size={14} /> Ajouter
                </button>
              )}
              <a className={cx('btn-ghost btn-sm', regs.length === 0 && 'pointer-events-none opacity-50')} href={`/api/events/${e.id}/registrations.csv`}>
                <Download size={14} /> Exporter
              </a>
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap gap-1.5">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={cx('rounded-full px-3 py-1 text-xs font-semibold', tab === t.key ? 'bg-accent-500 text-ink-950' : 'bg-white/5 text-zinc-300 hover:bg-white/10')}>
                {t.label} ({regs.filter(t.filter).length})
              </button>
            ))}
          </div>
          {list.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">{tab === 'pending' ? 'Aucun joueur à valider.' : 'Aucun participant.'}</p>
          ) : (
            <div className="divide-y divide-white/5">
              {list.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-40 flex-1">
                    <p className="font-semibold">
                      {r.status === 'waitlist' && <span className="mr-2 chip">#{regs.filter((x) => x.status === 'waitlist').findIndex((x) => x.id === r.id) + 1}</span>}
                      {r.pseudo} {r.present && <span className="chip ml-1 border-emerald-400/40 text-emerald-300">✓ Présent</span>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {[r.firstName, r.lastName].filter(Boolean).join(' ')} {r.email && `· ${r.email}`} · inscrit le {fmtDate(r.createdAt, true)}
                    </p>
                    {e.options.length > 0 && (
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {e.options.map((o) => `${o.label} : ${{ yes: 'Oui', no: 'Non', unknown: 'Ne sait pas' }[r.answers[o.id]] ?? '—'}`).join(' · ')}
                      </p>
                    )}
                  </div>
                  {!locked && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.status !== 'validated' && (
                        <button className="btn-ghost btn-sm" onClick={() => act(() => api.patch(`/events/${e.id}/registrations/${r.id}`, { status: 'validated' }))}>
                          <Check size={14} /> Valider
                        </button>
                      )}
                      {r.status === 'validated' && (
                        <button className="btn-ghost btn-sm" onClick={() => act(() => api.patch(`/events/${e.id}/registrations/${r.id}`, { present: !r.present }))} title="Confirmer la présence sur place">
                          <UserCheck size={14} /> {r.present ? 'Absent' : 'Présent'}
                        </button>
                      )}
                      {r.status === 'validated' && (
                        <button className="btn-ghost btn-sm" onClick={() => act(() => api.patch(`/events/${e.id}/registrations/${r.id}`, { status: 'pending', present: false }))}>
                          Dévalider
                        </button>
                      )}
                      {r.status !== 'waitlist' && r.status !== 'refused' && (
                        <button className="btn-ghost btn-sm" onClick={() => act(() => api.patch(`/events/${e.id}/registrations/${r.id}`, { status: 'waitlist', present: false }))}>
                          Attente
                        </button>
                      )}
                      {r.status !== 'refused' && (
                        <button className="btn-ghost btn-sm" onClick={() => act(() => api.patch(`/events/${e.id}/registrations/${r.id}`, { status: 'refused', present: false }))}>
                          <X size={14} /> Refuser
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
        <div className="space-y-5">
          <Section title="Page d'inscription">
            {e.status === 'draft' ? (
              <p className="text-sm text-zinc-400">Publiez l'événement pour ouvrir la page d'inscription publique.</p>
            ) : (
              <div className="space-y-2">
                <p className="break-all rounded-lg bg-ink-950/60 p-2 text-xs text-zinc-300">{publicUrl}</p>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(publicUrl);
                        toast('Lien copié.');
                      } catch {
                        toast('Impossible de copier le lien.', 'error');
                      }
                    }}
                  >
                    <Copy size={14} /> Copier le lien
                  </button>
                  <a className="btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Voir
                  </a>
                </div>
              </div>
            )}
          </Section>
          <Section title="Infos">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Format</dt>
                <dd>{e.maxPerTable}-max</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Stack</dt>
                <dd>{e.startStack.toLocaleString('fr-FR')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Financier</dt>
                <dd>{e.financialMode === 'money' ? `Buy-in ${formatMoney(e.buyin)}` : e.financialMode === 'lots' ? 'Dotation en lots' : 'Gratuit'}</dd>
              </div>
            </dl>
          </Section>
          <Section title="Import dans le live">
            {locked ? (
              <p className="text-sm text-zinc-400">
                Joueurs importés.{' '}
                {e.tournamentId && (
                  <Link className="text-accent-400 underline" to={`/live/${e.tournamentId}`}>
                    Ouvrir le live
                  </Link>
                )}
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-zinc-400">
                  {regs.filter((r) => r.status === 'validated').length} validé(s) dont {regs.filter((r) => r.status === 'validated' && r.present).length} présent(s).
                </p>
                <button className="btn-primary w-full" onClick={() => setImporting(true)} disabled={!regs.some((r) => r.status === 'validated')}>
                  <Import size={16} /> Importer les joueurs
                </button>
              </>
            )}
          </Section>
        </div>
      </div>
      {editing && <EventForm event={e} onClose={() => setEditing(false)} />}
      {importing && <ImportModal event={e} regs={regs} onClose={() => setImporting(false)} onDone={refresh} />}
      {adding && <AddRegistration eventId={e.id} options={e.options} onClose={() => { setAdding(false); refresh(); }} />}
    </>
  );
}

function ImportModal({ event, regs, onClose, onDone }: { event: EventRow; regs: Reg[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const lives = useQuery({ queryKey: ['lives'], queryFn: () => api.get<{ tournaments: { id: string; title: string; status: string }[] }>('/tournaments') });
  const [mode, setMode] = useState<'present' | 'validated'>('present');
  const [tid, setTid] = useState('');
  const validated = regs.filter((r) => r.status === 'validated');
  const count = mode === 'present' ? validated.filter((r) => r.present).length : validated.length;
  const target = tid || lives.data?.tournaments[0]?.id || '';
  return (
    <Modal
      open
      onClose={onClose}
      title="Importer les joueurs"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            disabled={!target || count === 0}
            onClick={async () => {
              try {
                const r = await api.post<{ added: string[]; skipped: string[] }>(`/events/${event.id}/import`, { tournamentId: target, mode });
                toast(`${r.added.length} joueur(s) importé(s).`);
                onDone();
                nav(`/live/${target}`);
              } catch (e) {
                toast(e instanceof ApiError ? e.message : 'Import des joueurs dans le tournoi impossible.', 'error');
              }
            }}
          >
            Importer {count} joueur(s)
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Mode d'import</label>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'present', label: `Les présents (${validated.filter((r) => r.present).length})` },
              { value: 'validated', label: `Tous les validés (${validated.length})` },
            ]}
          />
          {mode === 'validated' && <p className="mt-2 text-xs text-amber-200">Les joueurs validés seront tous importés, même sans présence confirmée. Un absent garde sa place et compte dans le prize pool jusqu'à ce que vous le supprimiez.</p>}
        </div>
        <div>
          <label className="label">Tournoi de destination</label>
          <select className="input" value={target} onChange={(e) => setTid(e.target.value)}>
            {lives.data?.tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.status === 'prepared' ? 'préparé' : 'en cours'})
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-zinc-400">La page d'inscription sera fermée et l'événement archivé.</p>
      </div>
    </Modal>
  );
}

function AddRegistration({ eventId, options, onClose }: { eventId: string; options: EventRow['options']; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ pseudo: '', firstName: '', lastName: '', email: '' });
  return (
    <Modal
      open
      onClose={onClose}
      title="Ajouter un participant"
      footer={
        <button
          className="btn-primary"
          disabled={!f.pseudo.trim()}
          onClick={async () => {
            try {
              await api.post(`/events/${eventId}/registrations`, { ...f, answers: Object.fromEntries(options.map((o) => [o.id, 'unknown'])) });
              toast('Participant ajouté (validé).');
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Pseudo *</label>
          <input className="input" value={f.pseudo} onChange={(e) => setF({ ...f, pseudo: e.target.value })} data-autofocus />
        </div>
        <div>
          <label className="label">Prénom</label>
          <input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        </div>
        <div>
          <label className="label">Nom</label>
          <input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
