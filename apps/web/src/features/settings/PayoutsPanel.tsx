import { formatMoney, ordinalPrize, type PayoutConfig, type TournamentSnapshot } from '@pokerorga/shared';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx, NumberField, Section, Segmented } from '../../components/ui';
import { useSave } from './useSave';

export function PayoutsPanel({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const s = t.settings;
  const save = useSave(t.id);
  const p = t.payouts;
  const [draft, setDraft] = useState<PayoutConfig>(p);
  useEffect(() => setDraft(p), [JSON.stringify(p)]);
  const pool = snap.stats.prizePool;
  const commit = (next: PayoutConfig) => {
    setDraft(next);
    void save({ payouts: next });
  };

  if (s.isFree && p.type === 'money') {
    return (
      <Section title="Gestion des places payées">
        <p className="text-sm text-stone-300">Le tournoi est en mode Gratuit : aucune place payée en argent. Vous pouvez distribuer des lots.</p>
        <button className="btn-ghost mt-3" onClick={() => commit({ ...draft, type: 'lots', mode: 'manual', lots: draft.lots.length ? draft.lots : ['', '', ''] })}>
          Distribuer des lots
        </button>
      </Section>
    );
  }

  const manualSum = draft.amounts.reduce((a, b) => a + b, 0);
  const displayed = draft.mode === 'auto' ? snap.computedPayouts : draft.amounts;

  return (
    <div className="space-y-5">
      <Section title="Configuration" subtitle="Définissez la nature de la récompense distribuée aux gagnants.">
        <Segmented
          value={draft.type}
          onChange={(v) => commit({ ...draft, type: v, mode: v === 'lots' ? 'manual' : draft.mode, lots: v === 'lots' && draft.lots.length === 0 ? ['', '', ''] : draft.lots })}
          options={[
            { value: 'money', label: 'Monétaire · Montants en cash', disabled: s.isFree },
            { value: 'lots', label: 'Lots · Lots et objets' },
          ]}
        />
      </Section>

      {draft.type === 'money' ? (
        <Section
          title="Répartition"
          subtitle={`Prize pool : ${formatMoney(pool)} · ${snap.stats.totalEntries} entrée(s)`}
          right={
            <button className="btn-ghost btn-sm" onClick={() => commit({ ...draft, mode: 'auto' })} disabled={draft.mode === 'auto'}>
              <RotateCcw size={14} /> Répartition automatique
            </button>
          }
        >
          {s.buyin === 0 && (
            <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
              Pas de calcul automatique : le buy-in est à 0. Si le tournoi n'est pas payant, activez « Gratuit » dans Réglages. Sinon, indiquez le montant du buy-in.
            </p>
          )}
          {draft.mode === 'auto' ? (
            <>
              <p className="mb-3 text-sm text-stone-400">La répartition est recalculée automatiquement selon le nombre d'entrées. Modifiez un montant pour passer en mode manuel.</p>
              {displayed.length === 0 && <p className="text-sm text-stone-400">Ajouter des joueurs pour afficher les places payées</p>}
            </>
          ) : (
            <p className={cx('mb-3 text-sm', Math.round(manualSum) === Math.round(pool) ? 'text-emerald-300' : 'text-amber-300')}>
              {Math.round(manualSum) === Math.round(pool) ? 'Répartition ok' : `Somme des places : ${formatMoney(manualSum)} / prize pool ${formatMoney(pool)} (écart ${formatMoney(manualSum - pool)})`}
            </p>
          )}
          <div className="space-y-2">
            {displayed.map((v, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-24 text-sm font-semibold">{ordinalPrize(i + 1)}</span>
                <NumberField className="w-40" value={v} suffix="€" onCommit={(n) => {
                  const amounts = [...displayed];
                  amounts[i] = n ?? 0;
                  commit({ ...draft, mode: 'manual', amounts });
                }} />
                <span className="text-xs text-stone-500">{pool > 0 ? `${Math.round((v / pool) * 1000) / 10} %` : ''}</span>
                <button className="rounded-lg p-1.5 text-stone-500 hover:text-red-300" onClick={() => commit({ ...draft, mode: 'manual', amounts: displayed.filter((_, j) => j !== i) })} aria-label="Supprimer">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn-ghost btn-sm mt-3" onClick={() => commit({ ...draft, mode: 'manual', amounts: [...displayed, 0] })}>
            <Plus size={14} /> Ajouter une place payée
          </button>
        </Section>
      ) : (
        <Section
          title="Lots"
          subtitle="Un lot par place payée"
          right={
            <button className="btn-ghost btn-sm" onClick={() => commit({ ...draft, lots: ['', '', ''] })}>
              <RotateCcw size={14} /> Réinitialiser les lots
            </button>
          }
        >
          <div className="space-y-2">
            {draft.lots.map((l, i) => (
              <div key={`${i}:${l}:${draft.lots.length}`} className="flex items-center gap-3">
                <span className="w-24 text-sm font-semibold">{ordinalPrize(i + 1)}</span>
                <input
                  className="input"
                  defaultValue={l}
                  placeholder="Ex : Mallette de jetons"
                  maxLength={200}
                  onBlur={(e) => {
                    if (e.target.value === l) return;
                    const lots = [...draft.lots];
                    lots[i] = e.target.value;
                    commit({ ...draft, lots });
                  }}
                />
                <button className="rounded-lg p-1.5 text-stone-500 hover:text-red-300" onClick={() => commit({ ...draft, lots: draft.lots.filter((_, j) => j !== i) })} aria-label="Supprimer">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn-ghost btn-sm mt-3" onClick={() => commit({ ...draft, lots: [...draft.lots, ''] })}>
            <Plus size={14} /> Ajouter une place payée
          </button>
        </Section>
      )}
    </div>
  );
}
