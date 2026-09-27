import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  applyAction,
  BOARD_SIZE,
  computeEquity,
  defaultAnteMode,
  describeHand,
  formatBlind,
  handValueOf,
  legalActions,
  nextButton,
  playerChips,
  previewShowdown,
  replayHand,
  resolveClock,
  STREET_LABEL,
  totalPot,
  type AnteMode,
  type Card,
  type HandAction,
  type HandState,
  type Level,
  type Player,
  type TournamentSnapshot,
} from '@pokerorga/shared';
import { ArrowLeft, Ban, BarChart3, Eye, EyeOff, History, Layers, Play, RotateCcw, Undo2, UserMinus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cx, Loading, Modal, NumberField, Segmented, Toggle, useConfirm, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useServerNow } from '../../lib/serverClock';
import { liveKey, useLive } from '../live/useLive';
import { fmt, HandReplay, pct, PotsView, ResultView, stateSeats, type HandRow, type HandSummary } from './HandViews';
import { CardPicker, CardRow, PlayingCard, TableView, type SeatView } from './PokerUi';

type HandData = { hand: HandRow | null; last: HandRow | null };
const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Une erreur est survenue.');

export default function DealerPage() {
  const { id, table } = useParams();
  const live = useLive(id);
  const snap = live.data;
  if (!snap) return <div className="bg-felt min-h-screen">{live.isError ? <p className="p-8 text-center text-red-300">Tournoi introuvable.</p> : <Loading />}</div>;
  return (
    <div className="bg-felt min-h-screen">
      {table ? <DealerTable key={table} snap={snap} table={Number(table)} /> : <TablePicker snap={snap} />}
    </div>
  );
}

// ---------------- Choix de la table ----------------

function TablePicker({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const [chips, setChips] = useState(false);
  const active = snap.players.filter((p) => p.status === 'active');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link to={`/live/${t.id}`} className="btn-ghost btn-sm">
          <ArrowLeft size={16} /> Live
        </Link>
        <button className="btn-ghost btn-sm" onClick={() => setChips(true)}>
          <BarChart3 size={16} /> Chipcount
        </button>
      </div>
      <div>
        <h1 className="text-2xl font-black">Tablette croupier</h1>
        <p className="text-sm text-zinc-400">{t.title} · choisissez la table dont vous êtes le croupier.</p>
      </div>
      {snap.tables.length === 0 ? (
        <p className="card p-6 text-center text-zinc-300">Aucune table : effectuez d'abord le placement des joueurs depuis le live.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {snap.tables.map((tb) => {
            const n = active.filter((p) => p.tableNumber === tb.number).length;
            return (
              <Link key={tb.number} to={`/croupier/${t.id}/${tb.number}`} className="card flex flex-col items-center gap-1 p-6 hover:border-accent-500/60">
                <span className="text-4xl font-black">{tb.number}</span>
                <span className="text-sm text-zinc-400">
                  {tb.isFinal ? 'Table finale · ' : ''}
                  {n} joueur{n > 1 ? 's' : ''}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      <ChipcountModal open={chips} onClose={() => setChips(false)} snap={snap} />
    </div>
  );
}

/** Niveau de blindes en cours (le suivant pendant une pause), rafraîchi toutes les 5 s. */
function useLevel(snap: TournamentSnapshot): { level: Level | null; onBreak: boolean } {
  const now = useServerNow(5000);
  return useMemo(() => {
    const levels = snap.tournament.structure;
    let i = resolveClock(snap.tournament.clock, levels, now).levelIndex;
    const onBreak = levels[i]?.kind === 'break';
    while (levels[i]?.kind === 'break') i++;
    return { level: levels[i] ?? null, onBreak };
  }, [snap, now]);
}

// ---------------- Chipcount ----------------

function ChipcountModal({ open, onClose, snap }: { open: boolean; onClose: () => void; snap: TournamentSnapshot }) {
  const { level } = useLevel(snap);
  const s = snap.tournament.settings;
  const rows = snap.players
    .filter((p) => p.status === 'active')
    .map((p) => ({ p, chips: playerChips(p, s) }))
    .sort((a, b) => b.chips - a.chips);
  const total = rows.reduce((a, r) => a + r.chips, 0);
  const avg = rows.length ? total / rows.length : 0;
  return (
    <Modal open={open} onClose={onClose} title="Classement en jetons" size="lg">
      <p className="mb-2 text-sm text-zinc-400">
        {rows.length} joueurs · moyenne {fmt(Math.round(avg))}
        {level && ` (${Math.round(avg / level.bb)} BB)`} · niveau {level ? `${formatBlind(level.sb)}/${formatBlind(level.bb)}` : '—'}
      </p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="py-1">#</th>
            <th>Joueur</th>
            <th>Table</th>
            <th className="text-right">Jetons</th>
            <th className="text-right">BB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, chips }, i) => (
            <tr key={p.id} className="border-t border-white/5">
              <td className="py-1.5 text-zinc-500">{i + 1}</td>
              <td className="font-semibold">
                {p.pseudo}
                {p.chips == null && <span className="ml-1 text-[10px] font-normal text-zinc-500" title="Aucune main saisie : tapis estimé depuis les entrées">estimé</span>}
              </td>
              <td className="text-zinc-400">{p.tableNumber != null ? `T${p.tableNumber} · S${p.seatNumber}` : '—'}</td>
              <td className="text-right font-bold tabular">{fmt(chips)}</td>
              <td className={cx('text-right tabular', level && chips / level.bb < 10 ? 'text-red-300' : 'text-zinc-300')}>{level ? (chips / level.bb).toFixed(1) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------------- Table ----------------

function DealerTable({ snap, table }: { snap: TournamentSnapshot; table: number }) {
  const t = snap.tournament;
  const id = t.id;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const key = useMemo(() => ['dealer-hand', id, table] as const, [id, table]);
  const q = useQuery({ queryKey: key, queryFn: () => api.get<HandData>(`/tournaments/${id}/tables/${table}/hand`) });
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [history, setHistory] = useState(false);
  const [chips, setChips] = useState(false);
  const [replay, setReplay] = useState<string | null>(null);

  // synchronisation entre appareils
  useEffect(() => {
    const es = new EventSource(`/api/tournaments/${id}/stream`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { type: string; table?: number };
        if ((d.type === 'hand' && d.table === table) || d.type === 'hello') {
          if (pending.current === 0) qc.invalidateQueries({ queryKey: key });
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [id, table, qc, key]);

  const running = q.data?.hand ?? null;
  const last = q.data?.last ?? null;
  const { state, error } = useMemo(() => {
    if (!running) return { state: null, error: null };
    try {
      return { state: replayHand(running.config, running.actions), error: null };
    } catch (e) {
      return { state: null, error: errMsg(e) };
    }
  }, [running]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: liveKey(id) });
    qc.invalidateQueries({ queryKey: ['dealer-hands', id, table] });
  };

  const send = (action: HandAction) => {
    const cur = qc.getQueryData<HandData>(key)?.hand;
    if (!cur) return;
    try {
      applyAction(replayHand(cur.config, cur.actions), action);
    } catch (e) {
      toast(errMsg(e), 'error');
      return;
    }
    qc.setQueryData<HandData>(key, (old) => ({ last: old?.last ?? null, hand: { ...cur, actions: [...cur.actions, action] } }));
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const r = await api.post<{ hand: HandRow }>(`/tournaments/${id}/hands/${cur.id}/actions`, { action, expected: cur.actions.length });
        if (r.hand.status === 'finished') {
          qc.setQueryData<HandData>(key, { hand: null, last: r.hand });
          refreshAll();
        } else qc.setQueryData<HandData>(key, (old) => ({ last: old?.last ?? null, hand: r.hand }));
      } catch (e) {
        toast(errMsg(e), 'error');
        qc.invalidateQueries({ queryKey: key });
      } finally {
        pending.current--;
      }
    });
  };

  const undo = async () => {
    await queue.current;
    const d = qc.getQueryData<HandData>(key);
    const h = d?.hand ?? d?.last;
    if (!h) return;
    if (h.status === 'running' && h.actions.length === 0) return cancel();
    if (h.status === 'finished') {
      const ok = await confirm({ title: `Rouvrir la main #${h.handNumber} ?`, lines: ['La dernière action est annulée et les tapis reviennent à leur valeur d’avant.'], confirmLabel: 'Rouvrir' });
      if (!ok) return;
    }
    try {
      await api.post(`/tournaments/${id}/hands/${h.id}/undo`, { expected: h.actions.length });
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    refreshAll();
  };

  const cancel = async () => {
    if (!running) return;
    const ok = await confirm({ title: 'Maldonne : annuler cette main ?', lines: ['Aucun jeton ne bouge. La main reste visible dans l’historique comme annulée.'], confirmLabel: 'Annuler la main', danger: true });
    if (!ok) return;
    await queue.current;
    try {
      await api.post(`/tournaments/${id}/hands/${running.id}/cancel`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    refreshAll();
  };

  const { level, onBreak } = useLevel(snap);
  const inPlay = state && state.phase !== 'complete' ? state : null;
  const shownHand = inPlay ? running : running ?? last;
  const finished = useMemo(() => state ?? (last ? replayHand(last.config, last.actions) : null), [state, last]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 p-2 sm:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to={`/croupier/${id}`} className="btn-ghost btn-sm" aria-label="Changer de table">
          <ArrowLeft size={16} />
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-lg font-black leading-tight">
            Table {table}
            {shownHand && <span className="text-zinc-400"> · main #{shownHand.handNumber}</span>}
          </h1>
          <p className="text-xs text-zinc-400">
            {inPlay ? (
              <>
                {formatBlind(inPlay.config.sb)}/{formatBlind(inPlay.config.bb)}
                {inPlay.config.ante > 0 && ` · ante ${formatBlind(inPlay.config.ante)} (${inPlay.config.anteMode === 'bb' ? 'BBA' : 'classique'})`} · <b className="text-accent-300">{STREET_LABEL[inPlay.phase]}</b>
              </>
            ) : level ? (
              `Niveau en cours : ${formatBlind(level.sb)}/${formatBlind(level.bb)}${level.ante ? ` · ante ${formatBlind(level.ante)}` : ''}${onBreak ? ' (après la pause)' : ''}`
            ) : (
              t.title
            )}
          </p>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setChips(true)}>
          <BarChart3 size={16} /> <span className="hidden sm:inline">Chipcount</span>
        </button>
        <button className="btn-ghost btn-sm" onClick={() => setHistory(true)}>
          <History size={16} /> <span className="hidden sm:inline">Historique</span>
        </button>
        {(running || last) && (
          <button className="btn-ghost btn-sm" onClick={undo} title="Annuler la dernière action">
            <Undo2 size={16} /> <span className="hidden sm:inline">Annuler</span>
          </button>
        )}
        {running && (
          <button className="btn-danger btn-sm" onClick={cancel} title="Maldonne">
            <Ban size={16} /> <span className="hidden sm:inline">Maldonne</span>
          </button>
        )}
      </header>

      {q.isLoading ? (
        <Loading />
      ) : error ? (
        <p className="card p-4 text-red-300">Main illisible : {error}</p>
      ) : inPlay ? (
        <HandInPlay s={inPlay} send={send} />
      ) : (
        <Setup snap={snap} table={table} level={level} finished={finished} lastHand={last} onStarted={(h) => qc.setQueryData<HandData>(key, (old) => ({ last: old?.last ?? null, hand: h }))} onBusted={refreshAll} />
      )}

      <HistoryModal open={history} onClose={() => setHistory(false)} tournamentId={id} table={table} onPick={setReplay} />
      <HandReplay tournamentId={id} handId={replay} onClose={() => setReplay(null)} />
      <ChipcountModal open={chips} onClose={() => setChips(false)} snap={snap} />
    </div>
  );
}

// ---------------- Avant la main ----------------

function Setup({
  snap,
  table,
  level,
  finished,
  lastHand,
  onStarted,
  onBusted,
}: {
  snap: TournamentSnapshot;
  table: number;
  level: Level | null;
  finished: HandState | null;
  lastHand: HandRow | null;
  onStarted: (h: HandRow) => void;
  onBusted: () => void;
}) {
  const t = snap.tournament;
  const s = t.settings;
  const toast = useToast();
  const seated = snap.players
    .filter((p) => p.status === 'active' && p.tableNumber === table && p.seatNumber != null)
    .sort((a, b) => a.seatNumber! - b.seatNumber!);
  const [excluded, setExcluded] = useState<number[]>([]);
  const eligible = seated.filter((p) => playerChips(p, s) > 0 && !excluded.includes(p.seatNumber!)).map((p) => p.seatNumber!);
  const lastButton = lastHand?.config.button ?? null;
  const [button, setButton] = useState<number | null>(null);
  useEffect(() => setButton(null), [lastHand?.id]);
  const btn = button != null && eligible.includes(button) ? button : nextButton(lastButton, eligible);
  const [anteMode, setAnteMode] = useState<AnteMode | null>(null);
  const mode = level && level.ante > 0 ? (anteMode ?? defaultAnteMode(level.ante, level.bb)) : 'none';
  const [menu, setMenu] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (btn == null) return;
    setBusy(true);
    try {
      const r = await api.post<{ hand: HandRow }>(`/tournaments/${t.id}/hands`, { table, button: btn, anteMode: mode, exclude: excluded });
      onStarted(r.hand);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const seats: SeatView[] = seated.map((p) => {
    const chips = playerChips(p, s);
    const out = excluded.includes(p.seatNumber!);
    return {
      seat: p.seatNumber!,
      name: p.pseudo,
      stack: chips,
      bb: level ? chips / level.bb : undefined,
      folded: out || chips === 0,
      note: chips === 0 ? <b className="text-red-300">à éliminer</b> : out ? 'absent' : p.chips == null ? <span className="text-zinc-500">estimé</span> : null,
      onClick: () => setMenu(p),
    };
  });

  const maxSeats = Math.max(s.maxPerTable, ...seated.map((p) => p.seatNumber!));
  const busted = finished?.result
    ? finished.players.filter((p) => p.playerId && finished.result!.finalStacks[p.seat] === 0 && snap.players.find((x) => x.id === p.playerId)?.status === 'active')
    : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-3">
        <TableView
          seats={seats}
          maxSeats={maxSeats}
          button={btn}
          center={
            seated.length < 2 ? (
              <p className="text-sm text-white/80">Moins de 2 joueurs à cette table.</p>
            ) : (
              <>
                <span className="text-xs text-white/70">Touchez un joueur pour déplacer le bouton ou corriger son tapis.</span>
                {level && (
                  <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-bold">
                    {formatBlind(level.sb)}/{formatBlind(level.bb)}
                    {level.ante > 0 && ` · ante ${formatBlind(level.ante)}`}
                  </span>
                )}
              </>
            )
          }
        />
        <div className="card flex flex-col gap-3 p-4">
          {level && level.ante > 0 && (
            <div>
              <span className="label">Ante</span>
              <Segmented
                value={mode}
                onChange={(v) => setAnteMode(v)}
                options={[
                  { value: 'bb', label: 'Big blind ante', hint: 'La grosse blinde paie l’ante pour toute la table' },
                  { value: 'all', label: 'Ante classique', hint: 'Chaque joueur paie l’ante' },
                ]}
              />
            </div>
          )}
          <button className="btn-primary py-4 text-lg" disabled={busy || btn == null || eligible.length < 2 || !level} onClick={start}>
            <Play size={20} /> Distribuer la main #{(lastHand?.handNumber ?? 0) + 1}
          </button>
          {!level && <p className="text-sm text-red-300">Aucun niveau de blindes défini.</p>}
        </div>
      </div>

      <aside className="flex flex-col gap-3">
        {busted.length > 0 && <BustedPanel snap={snap} hand={finished!} busted={busted} onDone={onBusted} />}
        {finished?.result ? (
          <div className="card p-4">
            <h2 className="mb-2 font-bold">Main #{lastHand?.handNumber ?? ''} — résultat</h2>
            <div className="mb-2 flex justify-center">
              <CardRow cards={finished.board} size="sm" />
            </div>
            <ResultView s={finished} />
          </div>
        ) : (
          <div className="card p-4 text-sm text-zinc-400">
            <p className="font-semibold text-zinc-200">Comment ça marche</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Vérifiez le bouton et les tapis, puis distribuez.</li>
              <li>Saisissez chaque action : parole, mise, relance, tapis, couché. Les blindes, antes, relances minimales et side pots sont calculés automatiquement.</li>
              <li>À l’abattage, saisissez le board et les cartes montrées : l’application désigne les gagnants de chaque pot et explique le départage.</li>
              <li>Les tapis sont mis à jour à la fin de la main. « Annuler » revient une action en arrière, même après la fin de la main.</li>
            </ol>
          </div>
        )}
      </aside>

      <SeatMenu
        player={menu}
        snap={snap}
        isButton={menu?.seatNumber === btn}
        excluded={menu ? excluded.includes(menu.seatNumber!) : false}
        onClose={() => setMenu(null)}
        onButton={() => {
          setButton(menu!.seatNumber!);
          setMenu(null);
        }}
        onExclude={(v) => setExcluded(v ? [...excluded, menu!.seatNumber!] : excluded.filter((x) => x !== menu!.seatNumber))}
      />
    </div>
  );
}

function SeatMenu({ player, snap, isButton, excluded, onClose, onButton, onExclude }: { player: Player | null; snap: TournamentSnapshot; isButton: boolean; excluded: boolean; onClose: () => void; onButton: () => void; onExclude: (v: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const saveChips = async (v: number | null) => {
    if (!player) return;
    try {
      await api.patch(`/tournaments/${snap.tournament.id}/players/${player.id}/chips`, { chips: v });
      await qc.invalidateQueries({ queryKey: liveKey(snap.tournament.id) });
      toast('Tapis mis à jour.');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  if (!player) return null;
  const chips = playerChips(player, snap.tournament.settings);
  return (
    <Modal open onClose={onClose} title={`${player.pseudo} · siège ${player.seatNumber}`} size="sm">
      <div className="flex flex-col gap-4">
        <button className="btn-ghost" disabled={isButton} onClick={onButton}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-ink-950">D</span>
          {isButton ? 'Bouton sur ce joueur' : 'Mettre le bouton ici'}
        </button>
        <div>
          <span className="label">Tapis (recomptage)</span>
          <NumberField value={chips} onCommit={(v) => saveChips(v)} />
          {player.chips != null && (
            <button className="mt-1 text-xs text-zinc-400 underline" onClick={() => saveChips(null)}>
              Revenir à l’estimation depuis les entrées
            </button>
          )}
        </div>
        <Toggle checked={excluded} onChange={onExclude} label="Absent pour la prochaine main" hint="Ne reçoit pas de cartes (ne paie ni blinde ni ante)." />
      </div>
    </Modal>
  );
}

function BustedPanel({ snap, hand, busted, onDone }: { snap: TournamentSnapshot; hand: HandState; busted: HandState['players']; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const s = snap.tournament.settings;
  const canAgain = s.entryFormat !== 'freezeout' && snap.lateRegOpen;
  const killerOf = (seat: number) => {
    const pots = hand.result!.pots.filter((p) => p.eligible.includes(seat));
    const w = pots[pots.length - 1]?.winners[0];
    return hand.players.find((p) => p.seat === w) ?? null;
  };
  const bust = async (pid: string, killerId: string | null, again: boolean) => {
    setBusy(true);
    try {
      const r = await api.post<{ envelope: { amount: number } | null }>(`/tournaments/${snap.tournament.id}/players/${pid}/bust`, { eliminatedBy: killerId, again });
      toast(again ? (s.entryFormat === 'rebuys' ? 'Recave enregistrée.' : 'Re-entry enregistré.') : 'Joueur éliminé.');
      if (r.envelope) toast(`Enveloppe mystery : ${r.envelope.amount} €`);
      onDone();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card border-red-400/30 p-4">
      <h2 className="mb-2 flex items-center gap-2 font-bold">
        <UserMinus size={18} /> Joueurs sans jetons
      </h2>
      <ul className="flex flex-col gap-2">
        {busted.map((p) => {
          const k = killerOf(p.seat);
          return (
            <li key={p.seat} className="rounded-xl bg-white/5 p-2">
              <p className="text-sm">
                <b>{p.name}</b>
                {k && <span className="text-zinc-400"> — éliminé par {k.name}</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button className="btn-danger btn-sm" disabled={busy} onClick={() => bust(p.playerId!, k?.playerId ?? null, false)}>
                  Éliminer
                </button>
                {canAgain && (
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => bust(p.playerId!, k?.playerId ?? null, true)}>
                    <RotateCcw size={14} /> {s.entryFormat === 'rebuys' ? 'Recave' : 'Re-entry'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------- Main en cours ----------------

function HandInPlay({ s, send }: { s: HandState; send: (a: HandAction) => void }) {
  const [picker, setPicker] = useState<{ kind: 'board' } | { kind: 'hole'; seat: number } | null>(null);
  const [seatMenu, setSeatMenu] = useState<number | null>(null);
  const need = BOARD_SIZE[s.phase];
  const holesKnown = s.players.filter((p) => !p.folded).every((p) => p.cards?.length === 2);
  const equity = useMemo(() => {
    if (s.board.length === 5 || !holesKnown || !s.players.some((p) => p.allIn)) return null;
    const inHand = s.players.filter((p) => !p.folded);
    const e = computeEquity(inHand.map((p) => p.cards!), s.board, { iterations: 6000 });
    return Object.fromEntries(inHand.map((p, i) => [p.seat, e.equity[i]]));
  }, [s, holesKnown]);
  const la = legalActions(s);
  const used = (except: Card[]) => [...s.board, ...s.players.flatMap((p) => p.cards ?? [])].filter((c) => !except.includes(c));
  const holePlayer = picker?.kind === 'hole' ? s.players.find((p) => p.seat === picker.seat) : null;
  const menuPlayer = seatMenu != null ? s.players.find((p) => p.seat === seatMenu) : null;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-2">
        <TableView
          seats={stateSeats(s, { equity: equity ?? undefined, onSeat: (seat) => !s.players.find((p) => p.seat === seat)?.folded && setSeatMenu(seat) })}
          maxSeats={Math.max(...s.config.seats.map((x) => x.seat), 6)}
          button={s.config.button}
          center={
            <>
              <span className="text-[10px] font-black uppercase tracking-widest text-white/70">{STREET_LABEL[s.phase]}</span>
              {need > 0 ? <CardRow cards={s.board} slots={need} size="md" onClick={() => setPicker({ kind: 'board' })} /> : <span className="text-xs text-white/60">Pas encore de board</span>}
              <PotsView s={s} />
            </>
          }
        />
        {s.phase !== 'showdown' && need > 0 && s.board.length < need && (
          <button className="btn-ghost self-center" onClick={() => setPicker({ kind: 'board' })}>
            <Layers size={16} /> Saisir {s.phase === 'flop' ? 'le flop' : s.phase === 'turn' ? 'la turn' : 'la river'} (facultatif, utile pour le replay)
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {la && <ActionPanel s={s} send={send} />}
        {s.phase === 'showdown' && <ShowdownPanel s={s} send={send} onBoard={() => setPicker({ kind: 'board' })} onHole={(seat) => setPicker({ kind: 'hole', seat })} equity={equity} />}
        <ActionLog s={s} />
      </div>

      <CardPicker
        open={picker?.kind === 'board'}
        title={`Board — ${STREET_LABEL[s.phase]}`}
        counts={[3, 4, 5].filter((n) => n <= need)}
        initial={s.board}
        used={used(s.board)}
        onClose={() => setPicker(null)}
        onSave={(cards) => {
          send({ type: 'board', cards });
          setPicker(null);
        }}
      />
      <CardPicker
        open={!!holePlayer}
        title={`Cartes de ${holePlayer?.name ?? ''}`}
        counts={[2]}
        initial={holePlayer?.cards ?? []}
        used={used(holePlayer?.cards ?? [])}
        onClose={() => setPicker(null)}
        onSave={(cards) => {
          send({ type: 'show', seat: holePlayer!.seat, cards });
          setPicker(null);
        }}
      />
      <Modal open={!!menuPlayer} onClose={() => setSeatMenu(null)} title={menuPlayer ? `${menuPlayer.name} · siège ${menuPlayer.seat}` : ''} size="sm">
        {menuPlayer && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-400">
              Tapis {fmt(menuPlayer.stack)} · engagé {fmt(menuPlayer.committed)}
            </p>
            <button
              className="btn-ghost"
              onClick={() => {
                setSeatMenu(null);
                setPicker({ kind: 'hole', seat: menuPlayer.seat });
              }}
            >
              <Eye size={16} /> {menuPlayer.cards ? 'Modifier les cartes' : 'Cartes retournées (saisir)'}
            </button>
            {s.phase === 'showdown' && !menuPlayer.mucked && (
              <button
                className="btn-ghost"
                onClick={() => {
                  send({ type: 'muck', seat: menuPlayer.seat });
                  setSeatMenu(null);
                }}
              >
                <EyeOff size={16} /> Jette sa main
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ActionPanel({ s, send }: { s: HandState; send: (a: HandAction) => void }) {
  const la = legalActions(s)!;
  const p = s.players.find((x) => x.seat === la.seat)!;
  const unit = s.config.sb > 0 ? s.config.sb : 1;
  const clamp = (v: number) => Math.min(la.maxTo, Math.max(la.minTo, Math.round(v / unit) * unit));
  const [to, setTo] = useState(la.minTo);
  useEffect(() => setTo(la.minTo), [s.step, la.minTo]);
  const pot = totalPot(s);
  const potTo = (f: number) => clamp(s.currentBet + f * (pot + la.toCall));
  const presets = [
    { label: 'Min', v: la.minTo },
    { label: '½ pot', v: potTo(0.5) },
    { label: '¾ pot', v: potTo(0.75) },
    { label: 'Pot', v: potTo(1) },
  ];
  const big = 'flex-1 rounded-2xl py-4 text-base font-black transition disabled:opacity-40 sm:text-lg';
  return (
    <div className="card flex flex-col gap-3 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-lg font-black">
          <span className="text-amber-300">{p.name}</span> <span className="text-sm font-semibold text-zinc-400">siège {p.seat}</span>
        </p>
        <p className="text-sm tabular text-zinc-300">
          tapis {fmt(p.stack)}
          {la.toCall > 0 && <> · à suivre <b className="text-white">{fmt(la.toCall)}</b></>}
        </p>
      </div>
      <div className="flex gap-2">
        <button className={cx(big, 'bg-red-500/20 text-red-200 hover:bg-red-500/30')} onClick={() => send({ type: 'fold', seat: p.seat })}>
          Couché
        </button>
        {la.canCheck ? (
          <button className={cx(big, 'bg-white/10 hover:bg-white/15')} onClick={() => send({ type: 'check', seat: p.seat })}>
            Parole
          </button>
        ) : (
          <button className={cx(big, 'bg-sky-500/25 text-sky-100 hover:bg-sky-500/35')} onClick={() => send({ type: 'call', seat: p.seat })}>
            Suit {fmt(la.toCall)}
            {la.callIsAllIn && <span className="block text-xs">(tapis)</span>}
          </button>
        )}
      </div>
      {la.canRaise && (
        <div className="flex flex-col gap-2 rounded-2xl bg-black/20 p-2">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((x) => (
              <button key={x.label} className={cx('btn-ghost btn-sm flex-1', to === x.v && 'border-accent-500/70 text-accent-300')} onClick={() => setTo(x.v)}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost btn-sm" onClick={() => setTo(clamp(to - s.config.bb))} aria-label="Moins">
              −
            </button>
            <input type="range" min={la.minTo} max={la.maxTo} step={unit} value={to} onChange={(e) => setTo(+e.target.value)} className="flex-1 accent-accent-500" aria-label="Montant" />
            <button className="btn-ghost btn-sm" onClick={() => setTo(clamp(to + s.config.bb))} aria-label="Plus">
              +
            </button>
          </div>
          <div className="flex gap-2">
            <input
              className="input w-32 text-center text-lg font-bold tabular"
              inputMode="numeric"
              value={to}
              onChange={(e) => setTo(Number(e.target.value.replace(/\D/g, '')) || 0)}
              aria-label={la.isBet ? 'Mise' : 'Relance à'}
            />
            <button className={cx(big, 'bg-accent-500 py-3 text-ink-950 hover:bg-accent-400')} disabled={to < la.minTo && to !== la.maxTo} onClick={() => send(to >= la.maxTo ? { type: 'allin', seat: p.seat } : { type: 'bet', seat: p.seat, to })}>
              {to >= la.maxTo ? 'Tapis' : la.isBet ? 'Mise' : 'Relance à'} {fmt(to)}
            </button>
          </div>
          <button className="rounded-2xl bg-red-600/80 py-3 font-black text-white hover:bg-red-600" onClick={() => send({ type: 'allin', seat: p.seat })}>
            TAPIS ({fmt(la.maxTo)})
          </button>
          <p className="text-center text-[11px] text-zinc-500">
            Montants « à » : total misé sur ce tour. {la.isBet ? 'Mise' : 'Relance'} minimum {fmt(la.minTo)}.
          </p>
        </div>
      )}
      {!la.canRaise && la.canCall && la.toCall < p.stack && <p className="text-center text-xs text-zinc-400">Relance impossible (enchères non rouvertes ou adversaires à tapis) : suivre ou se coucher.</p>}
    </div>
  );
}

function ShowdownPanel({ s, send, onBoard, onHole, equity }: { s: HandState; send: (a: HandAction) => void; onBoard: () => void; onHole: (seat: number) => void; equity: Record<number, number> | null }) {
  const inHand = s.players.filter((p) => !p.folded);
  const preview = previewShowdown(s);
  const done = preview.result ? applyAction(s, { type: 'resolve' }) : null;
  return (
    <div className="card flex flex-col gap-3 p-3">
      <h2 className="font-black">Abattage</h2>
      <button className="flex items-center justify-between gap-2 rounded-xl bg-white/5 p-2 hover:bg-white/10" onClick={onBoard}>
        <span className="text-sm font-semibold">Board</span>
        <CardRow cards={s.board} slots={5} size="sm" />
      </button>
      <ul className="flex flex-col gap-1.5">
        {inHand.map((p) => {
          const v = handValueOf(s, p.seat);
          return (
            <li key={p.seat} className={cx('flex items-center gap-2 rounded-xl bg-white/5 p-2', p.mucked && 'opacity-50')}>
              <button onClick={() => onHole(p.seat)} className="flex gap-1" aria-label={`Cartes de ${p.name}`}>
                <PlayingCard card={p.cards?.[0] ?? null} size="sm" />
                <PlayingCard card={p.cards?.[1] ?? null} size="sm" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {p.name} {p.allIn && <span className="text-[10px] text-red-300">TAPIS</span>}
                </p>
                <p className="truncate text-xs text-zinc-300">
                  {p.mucked ? 'Main jetée' : v ? describeHand(v) : p.cards ? (equity?.[p.seat] != null ? `${pct(equity[p.seat])} de chances` : '') : 'Cartes à saisir'}
                </p>
              </div>
              {p.mucked ? (
                <button className="btn-ghost btn-sm" onClick={() => onHole(p.seat)}>
                  Montre
                </button>
              ) : (
                <button className="btn-ghost btn-sm" onClick={() => send({ type: 'muck', seat: p.seat })}>
                  Jette
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {done ? (
        <>
          <ResultView s={done} />
          <button className="btn-primary py-3 text-base" onClick={() => send({ type: 'resolve' })}>
            Valider et payer les pots
          </button>
        </>
      ) : (
        <p className="rounded-xl bg-amber-400/10 p-2 text-sm text-amber-200">{preview.error}</p>
      )}
    </div>
  );
}

function ActionLog({ s }: { s: HandState }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [s.events.length]);
  return (
    <ol ref={ref} className="card max-h-56 overflow-y-auto p-2 text-xs text-zinc-300">
      {s.events.map((e, i) => (
        <li key={i} className={cx('px-1 py-0.5', e.kind === 'street' && 'mt-1 font-black uppercase tracking-wider text-accent-300')}>
          {e.text}
        </li>
      ))}
    </ol>
  );
}

// ---------------- Historique ----------------

function HistoryModal({ open, onClose, tournamentId, table, onPick }: { open: boolean; onClose: () => void; tournamentId: string; table: number; onPick: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const q = useQuery({
    queryKey: ['dealer-hands', tournamentId, all ? 0 : table],
    queryFn: () => api.get<{ hands: HandSummary[] }>(`/tournaments/${tournamentId}/hands${all ? '' : `?table=${table}`}`),
    enabled: open,
  });
  return (
    <Modal open={open} onClose={onClose} title="Historique des mains" size="lg">
      <div className="mb-3">
        <Segmented
          size="sm"
          value={all ? 'all' : 'table'}
          onChange={(v) => setAll(v === 'all')}
          options={[
            { value: 'table', label: `Table ${table}` },
            { value: 'all', label: 'Toutes les tables' },
          ]}
        />
      </div>
      {!q.data ? (
        <Loading />
      ) : q.data.hands.length === 0 ? (
        <p className="py-6 text-center text-zinc-400">Aucune main enregistrée.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {q.data.hands.map((h) => (
            <li key={h.id}>
              <button
                className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                onClick={() => {
                  onPick(h.id);
                }}
              >
                <span className="w-16 shrink-0 text-xs text-zinc-400">
                  {all && `T${h.tableNumber} · `}#{h.handNumber}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {h.status === 'running' ? (
                    <span className="text-amber-200">En cours…</span>
                  ) : (
                    <>
                      <b>{h.winners.join(', ')}</b> {h.winners.length > 1 ? 'se partagent' : 'remporte'} {fmt(h.pot)}
                      {h.hand && <span className="text-zinc-400"> — {h.hand}</span>}
                    </>
                  )}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatBlind(h.sb)}/{formatBlind(h.bb)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
