import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  envelopesTotal,
  formatChips,
  formatMoney,
  FORMAT_LABELS,
  tablesPreview,
  type BountyType,
  type EntryFormat,
  type TournamentSettings,
  type TournamentSnapshot,
} from '@pokerorga/shared';
import { Lock, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx, NumberField, Section, Segmented, Toggle, useConfirm, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { useLiveAction } from '../live/useLive';
import { useSave } from './useSave';

interface ConfigItem {
  id: string;
  name: string;
  settings: TournamentSettings;
}

export function configSummary(s: TournamentSettings) {
  const fmt = s.entryFormat === 'freezeout' ? 'Freezeout' : s.entryFormat === 'reentry' ? (s.reentryLimit < 0 ? 'Re-entry illimité' : `Re-entry ×${s.reentryLimit}`) : s.addonsEnabled ? 'Recaves + add-on' : 'Recaves';
  const bounty = { none: null, fixed: 'Bounty fixe', progressive: 'Progressif', mystery: 'Mystery' }[s.bounty.type];
  return [fmt, `${s.maxPerTable}-max · TF ${s.finalTableSize}`, `${formatChips(s.startStack)} jetons`, s.isFree ? 'Gratuit' : formatMoney(s.buyin), bounty].filter(Boolean) as string[];
}

export function GeneralPanel({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const s = t.settings;
  const save = useSave(t.id);
  const started = t.status !== 'prepared';
  const me = useMe();
  const set = (patch: Partial<TournamentSettings>) => save({ settings: patch });
  const [title, setTitle] = useState(t.title);
  useEffect(() => setTitle(t.title), [t.title]);
  const tp = tablesPreview(s.maxPerTable, s.finalTableSize);
  const lockedHint = started ? 'Verrouillé : tournoi commencé' : undefined;

  return (
    <div className="space-y-5">
      <Section title="Général" subtitle="Nom du tournoi et résumé de la configuration">
        <label className="label">Titre du tournoi</label>
        <input className="input text-lg font-bold" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && save({ title: title.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {configSummary(s).map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
      </Section>

      <Favorites snap={snap} />

      <Section title="Format d'entrée" subtitle="Ce qui se passe quand un joueur est éliminé" right={started ? <span className="chip"><Lock size={12} /> {lockedHint}</span> : null}>
        <Segmented<EntryFormat>
          value={s.entryFormat}
          disabled={started}
          onChange={(v) => set({ entryFormat: v })}
          options={[
            { value: 'freezeout', label: 'Freezeout', hint: 'Éliminations définitives' },
            { value: 'reentry', label: 'Re-entry', hint: 'Nouvelle place attribuée au re-entry' },
            { value: 'rebuys', label: 'Recaves', hint: "Garde son siège lors d'une recave", disabled: s.bounty.type !== 'none' },
          ]}
        />
        <div className="mt-4 rounded-xl bg-white/5 p-4 text-sm">
          {s.entryFormat === 'freezeout' && (
            <p>
              <strong>Freezeout</strong> : une élimination est définitive, rien d'autre à régler.
            </p>
          )}
          {s.entryFormat === 'reentry' && (
            <div className="flex flex-wrap items-center gap-3">
              <span>Nombre max de re-entry :</span>
              <Segmented<number>
                size="sm"
                value={s.reentryLimit < 0 ? -1 : s.reentryLimit > 3 ? 99 : s.reentryLimit}
                onChange={(v) => set({ reentryLimit: v === 99 ? 5 : v })}
                options={[
                  { value: -1, label: 'Illimité' },
                  { value: 1, label: '1' },
                  { value: 2, label: '2' },
                  { value: 3, label: '3' },
                  { value: 99, label: 'Autre' },
                ]}
              />
              {s.reentryLimit > 3 && <NumberField className="w-24" value={s.reentryLimit} min={1} max={100} onCommit={(v) => set({ reentryLimit: v ?? 1 })} />}
              <span className="text-zinc-400">Le re-entry est autorisé jusqu'à la fin de la late registration.</span>
            </div>
          )}
          {s.entryFormat === 'rebuys' && (
            <div className="space-y-3">
              <p className="text-zinc-300">Recave au prix du buy-in, stack de départ ajouté. Possible jusqu'à la fin de la late registration.</p>
              <div className="flex flex-wrap items-center gap-3">
                <span>Recaves par joueur :</span>
                <Segmented<number>
                  size="sm"
                  value={s.rebuyLimit}
                  onChange={(v) => set({ rebuyLimit: v })}
                  options={[
                    { value: -1, label: 'Illimité' },
                    { value: 1, label: '1 (double chance)' },
                    { value: 2, label: '2' },
                    { value: 3, label: '3' },
                  ]}
                />
              </div>
              <Toggle checked={s.addonsEnabled} onChange={(v) => set({ addonsEnabled: v })} label="Activer les add-ons" hint="Un add-on par joueur" />
              {s.addonsEnabled && (
                <div className="grid max-w-md grid-cols-2 gap-3">
                  <div>
                    <label className="label">Prix add-on</label>
                    <NumberField value={s.addonCost} suffix="€" onCommit={(v) => set({ addonCost: v ?? 0 })} />
                  </div>
                  <div>
                    <label className="label">Stack add-on</label>
                    <NumberField value={s.addonStack} onCommit={(v) => set({ addonStack: v ?? 0 })} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Jetons & économie" subtitle="Stack, buy-in et places payées">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="label">Stack de départ</label>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<number>
                size="sm"
                value={s.startStack}
                onChange={(v) => set({ startStack: v })}
                options={[5000, 10000, 20000, 30000].map((v) => ({ value: v, label: `${v / 1000}k` }))}
              />
              <NumberField className="w-32" value={s.startStack} min={1} onCommit={(v) => set({ startStack: v ?? 10000 })} />
            </div>
          </div>
          <div>
            <label className="label">Buy-in</label>
            <div className="flex items-center gap-3">
              <NumberField className="w-32" value={s.buyin} suffix="€" disabled={s.isFree} onCommit={(v) => set({ buyin: v ?? 0 })} />
              <Toggle checked={s.isFree} onChange={(v) => set({ isFree: v })} label="Gratuit" hint="Aucune place payée" />
            </div>
          </div>
          {me.data?.rakeEnabled && (
            <div>
              <label className="label">Rake par entrée</label>
              <NumberField className="w-32" value={s.rake} suffix="€" onCommit={(v) => set({ rake: v ?? 0 })} />
              <p className="mt-1 text-xs text-zinc-500">Payé en sus du buy-in, hors prize pool. Compté sur les entrées, re-entries et recaves (pas les add-ons). Collecté : {formatMoney(snap.stats.rakeTotal)}.</p>
            </div>
          )}
          <div className="self-end">
            <Toggle checked={s.hidePayout} onChange={(v) => set({ hidePayout: v })} label="Masquer le payout" hint="Aucun gain affiché sur le timer" />
          </div>
        </div>
        <p className="eyebrow mt-5">Aperçu avec {snap.stats.totalEntries} entrée(s)</p>
        <div className="mt-2 grid grid-cols-3 gap-3 rounded-xl bg-white/5 p-4 text-center">
          <Mini label="Prize pool" value={s.isFree ? '—' : formatMoney(snap.stats.prizePool)} />
          <Mini label="Inscrits" value={String(snap.stats.registered)} />
          <Mini label="Jetons en jeu" value={formatChips(snap.stats.chipsInPlay)} />
        </div>
      </Section>

      <Section title="Championnat">
        <Toggle checked={s.trackKills} onChange={(v) => set({ trackKills: v })} label="Comptabiliser le nombre d'éliminations par joueur" hint="Demande qui a éliminé à chaque sortant. Classement des éliminations sur la saison." />
      </Section>

      <Section title="Tables" subtitle="Joueurs par table, table finale et équilibrage">
        <label className="label">Nombre de joueurs par table</label>
        <Segmented<number> size="sm" value={s.maxPerTable} onChange={(v) => set({ maxPerTable: v, finalTableSize: Math.min(s.finalTableSize, v + 1, 10) })} options={[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n), hint: FORMAT_LABELS[n] }))} />
        <label className="label mt-4">Nombre de joueurs en table finale</label>
        <Segmented<number> size="sm" value={s.finalTableSize} onChange={(v) => set({ finalTableSize: v })} options={[2, 3, 4, 5, 6, 7, 8, 9, 10].filter((n) => n <= s.maxPerTable + 1).map((n) => ({ value: n, label: n === s.maxPerTable + 1 ? `${n} (+1 siège)` : String(n) }))} />
        <p className="mt-3 text-sm text-zinc-400">
          À {tp.beforeFinal.n} joueurs restants, les tables seront à {tp.beforeFinal.a} vs {tp.beforeFinal.b}. À {tp.finalAt} joueurs restants, fusion en table finale.
        </p>
        <div className="mt-4 space-y-3">
          <Toggle checked={s.autoBalance} onChange={(v) => set({ autoBalance: v })} label="Équilibrage automatique" hint="Déplace les joueurs pour garder des tables égales" />
          <Toggle checked={s.breakTablesHighToLow} onChange={(v) => set({ breakTablesHighToLow: v })} label="Casse des tables par ordre décroissant" hint="La table au numéro le plus haut est cassée en premier" />
        </div>
      </Section>

      <BountySection snap={snap} />

      <Section title="Affichage">
        <Toggle checked={s.showLocalClock} onChange={(v) => set({ showLocalClock: v })} label="Afficher l'heure locale" hint="Heure de l'écran, sur le timer et la TV" />
      </Section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      {value && <p className="text-lg font-bold tabular">{value}</p>}
    </div>
  );
}

function BountySection({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const s = t.settings;
  const save = useSave(t.id);
  const run = useLiveAction(t.id);
  const started = t.status !== 'prepared';
  const pts = s.isFree || t.payouts.type === 'lots';
  const unit = pts ? 'pts' : '€';
  const setBounty = (patch: Partial<TournamentSettings['bounty']>) => save({ settings: { bounty: { ...s.bounty, ...patch } } });
  const hints: Record<BountyType, string> = {
    none: pts ? 'Sans bounty, une élimination ne rapporte aucun point.' : 'Sans bounty, tout le buy-in va au prize pool.',
    fixed: 'Une élimination rapporte une prime fixe' + (pts ? ' en points' : ''),
    progressive: '50 % gagnés, 50 % ajoutés à sa prime',
    mystery: 'Une élimination rapporte une prime aléatoire (enveloppes)',
  };
  const m = t.mystery;
  const pool = snap.stats.bountyPool;
  return (
    <Section title="Bounty" subtitle="Prime gagnée à chaque élimination" right={started ? <span className="chip"><Lock size={12} /> Type verrouillé</span> : null}>
      <Segmented<BountyType>
        value={s.bounty.type}
        disabled={started}
        onChange={(v) => setBounty({ type: v, amount: s.bounty.amount || Math.min(s.buyin, Math.round(s.buyin / 4) || 5) })}
        options={[
          { value: 'none', label: 'Aucun' },
          { value: 'fixed', label: 'Fixe', disabled: s.entryFormat === 'rebuys' },
          { value: 'progressive', label: 'Progressif', disabled: s.entryFormat === 'rebuys' },
          { value: 'mystery', label: 'Mystery', disabled: s.entryFormat === 'rebuys' },
        ]}
      />
      <p className="mt-2 text-sm text-zinc-400">{s.entryFormat === 'rebuys' ? 'Incompatible avec les recaves.' : hints[s.bounty.type]}</p>
      {s.bounty.type !== 'none' && (
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="label">{s.bounty.type === 'mystery' ? 'Part enveloppes par entrée' : 'Prime initiale'}</label>
            <NumberField className="w-36" value={s.bounty.amount} suffix={unit} disabled={started} max={pts ? undefined : s.buyin} onCommit={(v) => setBounty({ amount: v ?? 0 })} />
          </div>
          {!pts && <p className="pb-2 text-sm text-zinc-400">Prize pool par entrée : {formatMoney(Math.max(0, s.buyin - s.bounty.amount - s.rake))}</p>}
        </div>
      )}
      {s.bounty.type === 'mystery' && (
        <div className="mt-5 space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Commencer le tirage des enveloppes à partir de :</span>
            <Segmented<string>
              size="sm"
              value={s.bounty.drawFrom == null ? 'all' : 'n'}
              onChange={(v) => setBounty({ drawFrom: v === 'all' ? null : Math.max(2, Math.round(snap.stats.totalEntries / 2) || 9) })}
              options={[
                { value: 'all', label: 'Tout le field' },
                { value: 'n', label: 'N joueurs restants' },
              ]}
            />
            {s.bounty.drawFrom != null && <NumberField className="w-24" value={s.bounty.drawFrom} min={2} onCommit={(v) => setBounty({ drawFrom: v ?? 2 })} />}
          </div>
          <p className="text-xs text-zinc-400">Aucun tirage tant que la grille n’est pas figée. Figement automatique des enveloppes à la fin de la late registration.</p>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <Mini label="Pool" value={`${pool} ${unit}`} />
            <Mini label="Enveloppes" value={String(m.envelopes.length)} />
            <Mini label="Total grille" value={`${envelopesTotal(m.envelopes)} ${unit}`} />
            <Mini label="Tirées" value={String(m.envelopes.filter((e) => e.drawn).length)} />
            <Mini label="Statut" value={m.frozen ? 'Figée' : 'Non figée'} />
          </div>
          <div className="flex flex-wrap gap-2">
            {!m.frozen && (
              <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/tournaments/${t.id}/mystery/regenerate`), 'Grille générée.')}>
                Générer la grille auto
              </button>
            )}
            {!m.frozen ? (
              <button className="btn-primary btn-sm" onClick={() => run(() => api.post(`/tournaments/${t.id}/mystery/freeze`), 'Grille figée.')}>
                Figer
              </button>
            ) : (
              <button className="btn-ghost btn-sm" disabled={m.envelopes.some((e) => e.drawn)} onClick={() => run(() => api.post(`/tournaments/${t.id}/mystery/unfreeze`), 'Grille défigée.')}>
                Défiger
              </button>
            )}
            <button className="btn-ghost btn-sm" onClick={() => window.print()}>
              Imprimer
            </button>
          </div>
          {m.envelopes.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {m.envelopes.map((e) => (
                <div key={e.id} className={cx('rounded-lg border px-2 py-1.5 text-center text-xs', e.drawn ? 'border-white/5 bg-white/5 text-zinc-500 line-through' : 'border-accent-500/30 bg-accent-500/10')}>
                  <p className="truncate text-[10px] text-zinc-400">{e.group}</p>
                  <p className="font-bold tabular">
                    {e.amount} {unit}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function Favorites({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const save = useSave(t.id);
  const q = useQuery({ queryKey: ['fav-configs'], queryFn: () => api.get<{ items: ConfigItem[] }>('/favorites/configs') });
  const [name, setName] = useState('');
  const add = async () => {
    try {
      await api.post('/favorites/configs', { name: name.trim() || `Configuration #${(q.data?.items.length ?? 0) + 1}`, settings: t.settings });
      setName('');
      toast('Configuration ajoutée aux favoris.');
      qc.invalidateQueries({ queryKey: ['fav-configs'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  const load = async (c: ConfigItem) => {
    if (t.status !== 'prepared') return toast('Chargement possible uniquement avant le démarrage du tournoi', 'warning');
    if (await save({ settings: c.settings })) toast(`Configuration « ${c.name} » chargée.`);
  };
  return (
    <Section title="Favoris" subtitle="Mes configurations favorites" right={<Star size={18} className="text-accent-400" />}>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Nom de la configuration" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn-ghost" onClick={add}>
          <Star size={16} /> Enregistrer la configuration actuelle
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {q.data?.items.length === 0 && <p className="text-sm text-zinc-400">Aucune configuration sauvegardée pour le moment.</p>}
        {q.data?.items.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <button
              className="font-semibold hover:underline"
              title="Cliquer pour renommer"
              onClick={async () => {
                const n = prompt('Nom de la configuration', c.name);
                if (n && n.trim()) {
                  await api.patch(`/favorites/configs/${c.id}`, { name: n.trim() });
                  qc.invalidateQueries({ queryKey: ['fav-configs'] });
                }
              }}
            >
              {c.name}
            </button>
            <div className="flex flex-1 flex-wrap gap-1">
              {configSummary(c.settings).map((x) => (
                <span key={x} className="chip text-[10px]">
                  {x}
                </span>
              ))}
            </div>
            <button className="btn-ghost btn-sm" disabled={t.status !== 'prepared'} onClick={() => load(c)}>
              Charger
            </button>
            <button
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-red-500/20 hover:text-red-300"
              onClick={async () => {
                if (await confirm({ title: `Supprimer « ${c.name} » ?`, confirmLabel: 'Supprimer', danger: true })) {
                  await api.del(`/favorites/configs/${c.id}`);
                  qc.invalidateQueries({ queryKey: ['fav-configs'] });
                }
              }}
              aria-label="Supprimer"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}
