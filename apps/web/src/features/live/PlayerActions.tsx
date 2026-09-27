import { formatMoney, tableCapacity, type Player, type SeatRef, type TournamentSnapshot } from '@pokerorga/shared';
import { Gift, Search, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LinkedChip, linkLabel, PlayerSearchInput, type PlayerLink } from '../../components/PlayerSearch';
import { cx, Modal, useConfirm } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useLiveAction } from './useLive';

export type ActionKind = 'bust' | 'rebuy' | 'addon' | 'undo-rebuy' | 'move' | 'add' | 'scan' | null;

export function seatLabel(p: Pick<Player, 'tableNumber' | 'seatNumber'>) {
  return p.tableNumber != null ? `T${p.tableNumber} · S${p.seatNumber}` : '';
}

export function PlayerPicker({
  players,
  onPick,
  empty = 'Aucun joueur disponible',
  exclude,
  extra,
}: {
  players: Player[];
  onPick: (p: Player) => void;
  empty?: string;
  exclude?: string;
  extra?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return players
      .filter((p) => p.id !== exclude)
      .filter((p) => !n || `${p.pseudo} ${p.firstName ?? ''} ${p.lastName ?? ''}`.toLowerCase().includes(n))
      .sort((a, b) => (a.tableNumber ?? 99) - (b.tableNumber ?? 99) || (a.seatNumber ?? 0) - (b.seatNumber ?? 0) || a.pseudo.localeCompare(b.pseudo));
  }, [players, q, exclude]);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input className="input pl-9" placeholder="Rechercher un joueur..." value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
      </div>
      {extra}
      <div className="grid max-h-[50vh] grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {list.map((p) => (
          <button key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:border-accent-500/50 hover:bg-accent-500/10" onClick={() => onPick(p)}>
            <span className="truncate font-semibold">{p.pseudo}</span>
            <span className="shrink-0 text-xs text-zinc-400">{seatLabel(p)}</span>
          </button>
        ))}
        {list.length === 0 && <p className="col-span-full py-6 text-center text-sm text-zinc-400">{q ? `Aucun joueur trouvé pour « ${q} »` : empty}</p>}
      </div>
    </div>
  );
}

/** Flux complet d'élimination : joueur → re-entry ? → éliminateur → résultat. */
export function BustFlow({ snap, open, onClose, lateRegOpen, initialVictim }: { snap: TournamentSnapshot; open: boolean; onClose: () => void; lateRegOpen: boolean; initialVictim?: Player }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const [victim, setVictim] = useState<Player | null>(initialVictim ?? null);
  const [again, setAgain] = useState<boolean | null>(null);
  const [result, setResult] = useState<{ title: string; lines: string[]; envelope?: number } | null>(null);
  const active = snap.players.filter((p) => p.status === 'active');
  const canAgain = t.settings.entryFormat !== 'freezeout' && lateRegOpen && (!victim || t.settings.entryFormat !== 'reentry' || t.settings.reentryLimit < 0 || victim.entries - 1 < t.settings.reentryLimit);
  const askKiller = t.settings.trackKills || t.settings.bounty.type !== 'none';
  const againLabel = t.settings.entryFormat === 'rebuys' ? 'recave' : 're-entry';

  const reset = () => {
    setVictim(null);
    setAgain(null);
    setResult(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async (v: Player, ag: boolean, killer: Player | null) => {
    const r = await run(() =>
      api.post<{ newSeat: SeatRef | null; envelope: { amount: number; group: string } | null }>(`/tournaments/${t.id}/players/${v.id}/bust`, {
        eliminatedBy: killer?.id ?? null,
        again: ag,
      }),
    );
    if (!r) return close();
    const lines: string[] = [];
    if (killer) lines.push(`Éliminé par ${killer.pseudo}`);
    if (r.newSeat) lines.push(`Nouveau siège attribué à ${v.pseudo} : Table ${r.newSeat.table} – Siège ${r.newSeat.seat}`);
    setResult({
      title: ag ? (t.settings.entryFormat === 'rebuys' ? 'RECAVE VALIDÉE' : 'RE-ENTRY VALIDÉ') : `${v.pseudo} est éliminé`,
      lines,
      envelope: r.envelope?.amount,
    });
  };

  const pickVictim = (p: Player) => {
    setVictim(p);
    const ca = t.settings.entryFormat !== 'freezeout' && lateRegOpen && (t.settings.entryFormat !== 'reentry' || t.settings.reentryLimit < 0 || p.entries - 1 < t.settings.reentryLimit);
    if (!ca) {
      setAgain(false);
      if (!askKiller) void submit(p, false, null);
    }
  };
  const pickAgain = (v: boolean) => {
    setAgain(v);
    if (!askKiller && victim) void submit(victim, v, null);
  };

  let body: React.ReactNode;
  let title = 'Qui est éliminé ?';
  if (result) {
    title = result.title;
    body = (
      <div className="space-y-4 py-2 text-center">
        {result.envelope != null && (
          <div className="animate-pop mx-auto flex w-56 flex-col items-center gap-2 rounded-2xl border border-accent-500/50 bg-accent-500/10 p-6">
            <Gift className="text-accent-400" size={40} />
            <p className="eyebrow">Enveloppe Mystery</p>
            <p className="text-4xl font-black text-accent-300">{t.payouts.type === 'lots' || t.settings.isFree ? `${result.envelope} pts` : formatMoney(result.envelope)}</p>
          </div>
        )}
        {result.lines.map((l) => (
          <p key={l} className="text-lg font-semibold">
            {l}
          </p>
        ))}
        <button className="btn-primary w-full" onClick={close} data-autofocus>
          C'EST FAIT 👍
        </button>
      </div>
    );
  } else if (!victim) {
    body = <PlayerPicker players={active} onPick={pickVictim} empty="Aucun joueur actif" />;
  } else if (again === null && canAgain) {
    title = t.settings.entryFormat === 'rebuys' ? 'Faire une recave ?' : 'Faire un re-entry ?';
    body = (
      <div className="space-y-4">
        <p className="text-center text-lg">
          Joueur : <strong>{victim.pseudo}</strong>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-primary py-4 text-base" onClick={() => pickAgain(true)}>
            OUI ({againLabel})
          </button>
          <button className="btn-danger py-4 text-base" onClick={() => pickAgain(false)}>
            NON (Sortant)
          </button>
        </div>
      </div>
    );
  } else {
    title = `Qui a éliminé ${victim.pseudo} ?`;
    body = (
      <PlayerPicker
        players={t.settings.multiSng ? active.filter((p) => p.sngGroup === victim.sngGroup) : active}
        exclude={victim.id}
        onPick={(k) => submit(victim, !!again, k)}
        extra={
          <button className="btn-ghost w-full" onClick={() => submit(victim, !!again, null)}>
            Éliminateur inconnu / passer
          </button>
        }
      />
    );
  }
  return (
    <Modal open={open} onClose={close} title={title} size="lg" footer={victim && !result ? <button className="btn-ghost" onClick={reset}>Retour</button> : undefined}>
      {body}
    </Modal>
  );
}

export function SimplePlayerAction({ snap, kind, onClose }: { snap: TournamentSnapshot; kind: 'rebuy' | 'addon' | 'undo-rebuy'; onClose: () => void }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const titles = { rebuy: 'Qui recave ?', addon: 'Qui prend un add-on ?', 'undo-rebuy': 'Annuler une recave pour qui ?' };
  const success = { rebuy: 'Recave enregistrée pour', addon: 'Add-on enregistré pour', 'undo-rebuy': 'Recave annulée pour' };
  const list =
    kind === 'rebuy'
      ? snap.players.filter((p) => p.status === 'active' || p.status === 'eliminated')
      : kind === 'addon'
        ? snap.players.filter((p) => p.status === 'active' && p.addons === 0)
        : snap.players.filter((p) => p.rebuys > 0);
  return (
    <Modal open onClose={onClose} title={titles[kind]} size="lg">
      <PlayerPicker
        players={list}
        onPick={async (p) => {
          await run(() => api.post(`/tournaments/${t.id}/players/${p.id}/${kind}`), `${success[kind]} ${p.pseudo}`);
          onClose();
        }}
      />
    </Modal>
  );
}

export function AddPlayerModal({ snap, onClose, lateRegOpen }: { snap: TournamentSnapshot; onClose: () => void; lateRegOpen: boolean }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const confirm = useConfirm();
  const [form, setForm] = useState({ pseudo: '', firstName: '', lastName: '' });
  const [link, setLink] = useState<PlayerLink | null>(null);
  const inTournament = useMemo(() => new Set(snap.players.map((p) => p.pseudo.toLowerCase())), [snap.players]);
  const [group, setGroup] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.pseudo.trim()) return setError('Le pseudo est obligatoire.');
    let override = false;
    if (t.status === 'running' && !lateRegOpen) {
      override = await confirm({ title: 'Late registration terminée', lines: ["L'ajout nécessite une dérogation explicite.", 'Le joueur sera ajouté au prize pool.'], confirmLabel: 'Ajouter (dérogation)' });
      if (!override) return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tournaments/${t.id}/players`, { ...form, memberId: link?.memberId ?? null, playerAccountId: link?.playerAccountId ?? null, override, ...(t.settings.multiSng && group !== '' ? { sngGroup: group } : {}) });
      await run(async () => null, `${form.pseudo} ajouté`);
      setForm({ pseudo: '', firstName: '', lastName: '' });
      setLink(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’ajouter le joueur.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Ajouter un joueur">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Pseudo *</label>
          <PlayerSearchInput
            autoFocus
            value={form.pseudo}
            exclude={inTournament}
            placeholder="Pseudo, ou rechercher un joueur connu…"
            onChange={(v) => {
              setForm({ ...form, pseudo: v });
              setLink(null);
            }}
            onPick={(s) => {
              setForm({ pseudo: s.pseudo, firstName: s.firstName ?? '', lastName: s.lastName?.endsWith('.') && s.lastName.length <= 2 ? '' : (s.lastName ?? '') });
              setLink(s.memberId || s.playerAccountId ? { memberId: s.memberId, playerAccountId: s.playerAccountId, label: linkLabel(s) } : null);
            }}
          />
          <LinkedChip link={link} onClear={() => setLink(null)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Prénom</label>
            <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Facultatif" />
          </div>
          <div>
            <label className="label">Nom</label>
            <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Facultatif" />
          </div>
        </div>
        {t.settings.multiSng && (
          <div>
            <label className="label">Sit-and-Go</label>
            <select className="input" value={group} onChange={(e) => setGroup(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Le moins rempli (auto)</option>
              {snap.tables.map((tb) => (
                <option key={tb.number} value={tb.number}>
                  SnG {tb.number} · {snap.players.filter((p) => p.sngGroup === tb.number && p.status === 'active').length}/{t.settings.maxPerTable}
                </option>
              ))}
              <option value={(snap.tables.at(-1)?.number ?? 0) + 1}>Nouveau SnG</option>
            </select>
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fermer
          </button>
          <button className="btn-primary" disabled={busy}>
            <UserPlus size={16} /> Ajouter
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Déplacer un joueur vers un siège libre ou inverser avec un autre joueur. */
export function MoveModal({ snap, onClose, initial }: { snap: TournamentSnapshot; onClose: () => void; initial?: Player | null }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const [player, setPlayer] = useState<Player | null>(initial ?? null);
  const active = snap.players.filter((p) => p.status === 'active');
  const tableNumbers = snap.tables.map((tb) => tb.number);
  if (!player) {
    return (
      <Modal open onClose={onClose} title="Quel joueur déplacer ?" size="lg">
        <PlayerPicker players={active.filter((p) => p.tableNumber != null)} onPick={setPlayer} empty="Aucun joueur placé. Lancez d'abord le tirage des sièges." />
      </Modal>
    );
  }
  const move = async (table: number, seat: number) => {
    await run(() => api.post(`/tournaments/${t.id}/players/${player.id}/move`, { table, seat }), `${player.pseudo} → Table ${table}, siège ${seat}`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Où déplacer ${player.pseudo} ?`} size="xl">
      <div className="grid gap-3 sm:grid-cols-2">
        {tableNumbers.map((n) => (
          <div key={n} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="eyebrow mb-2">Table {n}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: tableCapacity(!!snap.tables.find((x) => x.number === n)?.isFinal, t.settings) }, (_, i) => i + 1).map((s) => {
                const occ = active.find((p) => p.tableNumber === n && p.seatNumber === s);
                const me = occ?.id === player.id;
                return (
                  <button
                    key={s}
                    disabled={me}
                    onClick={() => move(n, s)}
                    title={occ ? `Inverser avec ${occ.pseudo}` : 'Siège libre'}
                    className={cx(
                      'flex h-14 flex-col items-center justify-center rounded-lg border text-[11px] leading-tight',
                      me ? 'border-accent-500 bg-accent-500/20 text-accent-200' : occ ? 'border-white/10 bg-ink-950/50 hover:border-sky-400/60' : 'border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20',
                    )}
                  >
                    <span className="font-bold">S{s}</span>
                    <span className="w-full truncate px-1 text-center text-zinc-300">{me ? 'Vous êtes ici' : occ ? occ.pseudo : 'Libre'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-400">Cliquez un siège libre pour déplacer, ou un siège occupé pour inverser les places.</p>
    </Modal>
  );
}
