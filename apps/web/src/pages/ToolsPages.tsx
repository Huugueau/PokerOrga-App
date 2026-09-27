import { useQuery } from '@tanstack/react-query';
import {
  autoPayouts,
  formatDuration,
  formatMoney,
  generateStructure,
  levelNumberAt,
  ordinalPrize,
  payoutPercentages,
  toCsv,
  type GeneratorInput,
} from '@pokerorga/shared';
import { Calculator, CalendarDays, Download, Layers, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QrCode } from '../components/QrCode';
import { cx, Empty, fmtDate, Loading, NumberField, Toggle, useConfirm, useToast } from '../components/ui';
import { api, ApiError, downloadText } from '../lib/api';

function ToolsFrame({ children, tab }: { children: React.ReactNode; tab: 'structure' | 'payout' }) {
  return (
    <div className="bg-felt min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-9 w-9" />
            <span className="text-xl font-black">
              Poker<span className="text-accent-500">Orga</span> <span className="text-sm font-semibold text-zinc-400">· outils gratuits</span>
            </span>
          </Link>
          <div className="flex gap-1.5">
            <Link to="/outils/structure" className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', tab === 'structure' ? 'bg-accent-500 text-ink-950' : 'bg-white/5 text-zinc-300')}>
              <Layers size={14} className="mr-1 inline" /> Générateur de structure
            </Link>
            <Link to="/outils/payout" className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', tab === 'payout' ? 'bg-accent-500 text-ink-950' : 'bg-white/5 text-zinc-300')}>
              <Calculator size={14} className="mr-1 inline" /> Calculateur de payout
            </Link>
          </div>
        </div>
        {children}
        <p className="mt-8 text-center text-sm text-zinc-500">
          Pour piloter le tournoi (timer, joueurs, tables) : <Link to="/login" className="text-accent-400">ouvrir PokerOrga</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function StructureToolPage() {
  const [input, setInput] = useState<GeneratorInput>({ players: 12, startStack: 20000, durationHours: 4, levelMinutes: 20, smallestChip: 25, ante: true, breakEvery: 4, extraChipsPct: 0 });
  const set = (p: Partial<GeneratorInput>) => setInput({ ...input, ...p });
  const res = useMemo(() => generateStructure(input), [input]);
  const exportCsv = () =>
    downloadText(
      'structure.csv',
      toCsv([['type', 'sb', 'bb', 'ante', 'duree'], ...res.levels.map((l) => (l.kind === 'break' ? ['pause', 0, 0, 0, l.minutes] : ['niveau', l.sb, l.bb, l.ante, l.minutes]))]).replace(/^﻿/, ''),
    );
  return (
    <ToolsFrame tab="structure">
      <div className="grid gap-5 md:grid-cols-[300px_1fr]">
        <div className="card space-y-3 p-5">
          <h1 className="text-lg font-bold">Vos contraintes</h1>
          <Field label="Joueurs (total)">
            <NumberField value={input.players} min={2} max={1000} onCommit={(v) => set({ players: v ?? 10 })} />
          </Field>
          <Field label="Stack de départ">
            <NumberField value={input.startStack} min={100} onCommit={(v) => set({ startStack: v ?? 10000 })} />
          </Field>
          <Field label="Durée (heures)">
            <NumberField value={input.durationHours} min={0.5} max={24} step={0.5} onCommit={(v) => set({ durationHours: v ?? 4 })} />
          </Field>
          <Field label="Niveaux (minutes)">
            <NumberField value={input.levelMinutes} min={1} max={120} onCommit={(v) => set({ levelMinutes: v ?? 20 })} />
          </Field>
          <Field label="Plus petit jeton">
            <select className="input" value={input.smallestChip} onChange={(e) => set({ smallestChip: Number(e.target.value) })}>
              {[1, 5, 10, 25, 50, 100, 500].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pause tous les (niveaux)">
            <NumberField value={input.breakEvery} min={0} max={20} onCommit={(v) => set({ breakEvery: v ?? 0 })} />
          </Field>
          <Field label="Jetons en plus (recaves / add-ons)">
            <NumberField value={input.extraChipsPct ?? 0} min={0} max={300} suffix="%" onCommit={(v) => set({ extraChipsPct: v ?? 0 })} />
          </Field>
          <Toggle checked={input.ante} onChange={(v) => set({ ante: v })} label="Big Blind Ante" />
        </div>
        <div className="card p-5">
          <div className="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[
              ['Départ', `${res.summary.startBB} BB · ${res.summary.startDepth} BB`],
              ['Blinde finale', String(res.summary.endBB)],
              ['Durée estimée', formatDuration(res.summary.estimatedMinutes * 60000)],
              ['Profondeur finale', `${res.summary.finalAverageDepth} BB`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-white/5 p-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{l}</p>
                <p className="text-sm font-bold">{v}</p>
              </div>
            ))}
          </div>
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="text-left text-xs uppercase text-zinc-400">
                <th className="py-1">Niv.</th>
                <th>SB</th>
                <th>BB</th>
                <th>Ante</th>
                <th>Durée</th>
              </tr>
            </thead>
            <tbody>
              {res.levels.map((l, i) =>
                l.kind === 'break' ? (
                  <tr key={l.id} className="border-t border-white/5 text-accent-300">
                    <td className="py-1" colSpan={4}>
                      Pause {l.lateRegEnd && '· fin des inscriptions tardives'}
                    </td>
                    <td>{l.minutes} min</td>
                  </tr>
                ) : (
                  <tr key={l.id} className="border-t border-white/5">
                    <td className="py-1">{levelNumberAt(res.levels, i)}</td>
                    <td>{l.sb}</td>
                    <td>{l.bb}</td>
                    <td>{l.ante || ''}</td>
                    <td>{l.minutes} min</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <button className="btn-ghost mt-4" onClick={exportCsv}>
            <Download size={16} /> Exporter en CSV (importable dans l'éditeur)
          </button>
        </div>
      </div>
    </ToolsFrame>
  );
}

export function PayoutToolPage() {
  const [f, setF] = useState({ entries: 20, buyin: 20, rebuys: 0, addons: 0, addonCost: 10, bounty: 0 });
  const pool = Math.max(0, f.entries * (f.buyin - f.bounty) + f.rebuys * f.buyin + f.addons * f.addonCost);
  const amounts = autoPayouts(f.entries, pool);
  const pct = payoutPercentages(f.entries);
  const num = (k: keyof typeof f, label: string, suffix?: string) => (
    <Field label={label}>
      <NumberField value={f[k]} suffix={suffix} onCommit={(v) => setF({ ...f, [k]: v ?? 0 })} />
    </Field>
  );
  return (
    <ToolsFrame tab="payout">
      <div className="grid gap-5 md:grid-cols-[300px_1fr]">
        <div className="card space-y-3 p-5">
          <h1 className="text-lg font-bold">Votre tournoi</h1>
          {num('entries', 'Entrées (re-entries comprises)')}
          {num('buyin', 'Buy-in', '€')}
          {num('bounty', 'Dont bounty par entrée', '€')}
          {num('rebuys', 'Recaves')}
          {num('addons', 'Add-ons')}
          {num('addonCost', 'Prix add-on', '€')}
        </div>
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap gap-6">
            <div>
              <p className="eyebrow">Prize pool</p>
              <p className="text-3xl font-black">{formatMoney(pool)}</p>
            </div>
            {f.bounty > 0 && (
              <div>
                <p className="eyebrow">Bounties (hors prize pool)</p>
                <p className="text-3xl font-black text-zinc-300">{formatMoney(f.entries * f.bounty)}</p>
              </div>
            )}
            <div>
              <p className="eyebrow">Places payées</p>
              <p className="text-3xl font-black">{amounts.length}</p>
            </div>
          </div>
          {amounts.length === 0 ? (
            <Empty title="Renseignez les entrées et le buy-in." />
          ) : (
            <table className="w-full text-sm tabular">
              <tbody>
                {amounts.map((a, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-2 font-semibold">{ordinalPrize(i + 1)}</td>
                    <td className="text-zinc-400">{Math.round(pct[i] * 10) / 10} %</td>
                    <td className="text-right font-bold">{formatMoney(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-xs text-zinc-500">Montants arrondis (à 5 € au-delà de 500 € de prize pool), reliquat attribué au vainqueur. Dans l'app, la répartition se recalcule en direct et reste modifiable à la main.</p>
        </div>
      </div>
    </ToolsFrame>
  );
}

interface MyRegistration {
  pseudo: string;
  status: 'pending' | 'validated' | 'waitlist' | 'refused' | 'cancelled';
  present: boolean;
  position: number | null;
  code: string;
  event: { name: string; eventDate: string | null; eventTime: string | null; location: string | null; status: string; publicToken: string };
}

const STATUS: Record<MyRegistration['status'], string> = {
  pending: "En attente de validation par l'organisateur",
  validated: 'Inscription validée',
  waitlist: "Liste d'attente",
  refused: 'Inscription refusée',
  cancelled: 'Inscription annulée',
};

/** Page de suivi d'une préinscription (lien personnel du joueur). */
export function MyRegistrationPage() {
  const { code } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['my-reg', code], queryFn: () => api.get<MyRegistration>(`/public/registrations/${code}`), retry: false });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return (
      <div className="bg-felt min-h-screen p-8">
        <Empty title="Inscription introuvable." />
      </div>
    );
  const r = q.data;
  return (
    <div className="bg-felt flex min-h-screen items-start justify-center p-4 pt-12">
      <div className="card w-full max-w-md p-6 text-center">
        <p className="eyebrow">Ma préinscription</p>
        <h1 className="mt-1 text-2xl font-black">{r.event.name}</h1>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-3 text-sm text-zinc-400">
          <span className="flex items-center gap-1">
            <CalendarDays size={14} /> {r.event.eventDate ? fmtDate(r.event.eventDate) : 'Date à définir'}
            {r.event.eventTime ? ` · ${r.event.eventTime}` : ''}
          </span>
          {r.event.location && (
            <span className="flex items-center gap-1">
              <MapPin size={14} /> {r.event.location}
            </span>
          )}
        </p>
        <p className="mt-5 text-lg font-bold">{r.pseudo}</p>
        <p className={cx('mt-1 text-sm font-semibold', r.status === 'validated' ? 'text-accent-300' : r.status === 'cancelled' || r.status === 'refused' ? 'text-red-300' : 'text-amber-300')}>
          {STATUS[r.status]}
          {r.position ? ` — position n°${r.position}` : ''}
          {r.present ? ' · présence confirmée' : ''}
        </p>
        {r.status !== 'cancelled' && r.status !== 'refused' && (
          <>
            <div className="mx-auto mt-5 w-fit rounded-xl bg-white p-3">
              <QrCode value={r.code} size={200} />
            </div>
            <p className="mt-2 text-sm text-zinc-400">Présentez ce QR à l'accueil le jour J.</p>
            {r.event.status !== 'imported' && (
              <button
                className="btn-danger mt-6"
                onClick={async () => {
                  if (!(await confirm({ title: 'Annuler mon inscription ?', lines: ['Votre place sera libérée pour un autre joueur.'], confirmLabel: 'Annuler mon inscription', danger: true }))) return;
                  try {
                    await api.post(`/public/registrations/${code}/cancel`);
                    toast('Inscription annulée.');
                    q.refetch();
                  } catch (e) {
                    toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
                  }
                }}
              >
                Annuler mon inscription
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
