import { useQuery } from '@tanstack/react-query';
import {
  BOARD_SIZE,
  computeEquity,
  computePots,
  replayHand,
  STREET_LABEL,
  totalPot,
  type Card,
  type HandAction,
  type HandConfig,
  type HandResult,
  type HandState,
} from '@pokerorga/shared';
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx, Loading, Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { CardRow, TableView, type SeatView } from './PokerUi';

export interface HandRow {
  id: string;
  tournamentId: string;
  tableNumber: number;
  handNumber: number;
  status: 'running' | 'finished' | 'cancelled';
  config: HandConfig;
  actions: HandAction[];
  result: HandResult | null;
  levelIndex: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface HandSummary {
  id: string;
  tableNumber: number;
  handNumber: number;
  status: HandRow['status'];
  sb: number;
  bb: number;
  players: number;
  pot: number;
  winners: string[];
  hand: string | null;
  showdown: boolean;
  startedAt: string;
}

export const fmt = (n: number) => n.toLocaleString('fr-FR');
export const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)} %`;

/** Sièges d'une main pour l'affichage sur la table. */
export function stateSeats(s: HandState, opts: { reveal?: Record<number, Card[] | null>; onSeat?: (seat: number) => void; equity?: Record<number, number> } = {}): SeatView[] {
  const done = s.phase === 'complete';
  return s.players.map((p) => {
    const stack = done ? (s.result?.finalStacks[p.seat] ?? p.stack) : p.stack;
    const cards = p.cards ?? opts.reveal?.[p.seat] ?? null;
    const won = s.result?.collected[p.seat] ?? 0;
    const badges = [p.seat === s.sbSeat && s.players.length > 2 ? 'SB' : null, p.seat === s.bbSeat ? 'BB' : null].filter(Boolean) as string[];
    const eq = opts.equity?.[p.seat];
    return {
      seat: p.seat,
      name: p.name,
      stack,
      bb: stack / s.config.bb,
      bet: done ? 0 : p.streetBet,
      cards: p.folded ? null : cards,
      hidden: !p.folded && !cards && !p.mucked,
      folded: p.folded || p.mucked,
      allIn: p.allIn && !done,
      active: s.toAct === p.seat,
      winner: done && won > 0,
      badges,
      note: done ? (stack - p.startStack !== 0 ? <b className={stack > p.startStack ? 'text-accent-300' : 'text-red-300'}>{stack > p.startStack ? '+' : ''}{fmt(stack - p.startStack)}</b> : null) : eq != null ? <b className="text-amber-200">{pct(eq)}</b> : null,
      onClick: opts.onSeat ? () => opts.onSeat!(p.seat) : undefined,
    };
  });
}

export function PotsView({ s }: { s: HandState }) {
  if (s.phase === 'complete') return null;
  const { pots } = computePots(s);
  const name = (seat: number) => s.players.find((p) => p.seat === seat)?.name ?? seat;
  const inFront = s.players.reduce((a, p) => a + p.streetBet, 0);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="rounded-full bg-black/40 px-3 py-0.5 text-sm font-black tabular text-amber-200 sm:text-base">Pot {fmt(totalPot(s))}</span>
      {pots.length > 1 &&
        s.players.some((p) => p.allIn && !p.folded) &&
        pots.map((p, i) => (
          <span key={i} className="text-[10px] font-semibold text-zinc-200 sm:text-xs" title={p.eligible.map(name).join(', ')}>
            {i === 0 ? 'Principal' : `Side ${i}`} : {fmt(p.amount)} <span className="text-zinc-400">({p.eligible.length} j.)</span>
          </span>
        ))}
      {inFront > 0 && <span className="text-[10px] text-zinc-400">dont {fmt(inFront)} en mises</span>}
    </div>
  );
}

/** Détail de la distribution des pots et du départage. */
export function ResultView({ s }: { s: HandState }) {
  const r = s.result;
  if (!r) return null;
  const name = (seat: number) => s.players.find((p) => p.seat === seat)?.name ?? `Siège ${seat}`;
  return (
    <div className="flex flex-col gap-2">
      {r.pots.map((p, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              {p.label} · {fmt(p.amount)}
            </span>
            <span className="text-xs text-zinc-500">Joueurs en lice : {p.eligible.map(name).join(', ')}</span>
          </div>
          <p className="mt-1 font-bold text-accent-300">
            {p.winners.map((w) => `${name(w)} (+${fmt(p.shares[w])})`).join(' · ')}
            {p.hand && <span className="font-semibold text-zinc-200"> — {p.hand}</span>}
          </p>
          {p.reason && <p className="text-sm text-amber-200">{p.reason}</p>}
          {!p.hand && <p className="text-sm text-zinc-400">{p.eligible.length > 1 ? 'Les autres joueurs ont jeté leur main.' : 'Remporté sans abattage.'}</p>}
        </div>
      ))}
      {r.returned.map((x) => (
        <p key={x.seat} className="text-sm text-zinc-400">
          Mise non suivie rendue à {name(x.seat)} : {fmt(x.amount)}
        </p>
      ))}
      {Object.keys(r.hands).length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(r.hands).map(([seat, h]) => (
            <div key={seat} className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5">
              <CardRow cards={h.cards} size="xs" />
              <span className="min-w-0 text-xs">
                <b>{name(+seat)}</b>
                <br />
                <span className="text-zinc-300">{h.description}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Replay ----------------

/** Équités de chaque joueur en lice si toutes les cartes sont connues (board de 0, 3 ou 4 cartes). */
function useEquity(s: HandState | null, holes: Record<number, Card[] | null>, board: Card[]) {
  return useMemo(() => {
    if (!s || s.phase === 'complete' || board.length === 5) return null;
    const inHand = s.players.filter((p) => !p.folded);
    if (inHand.length < 2 || inHand.some((p) => (holes[p.seat]?.length ?? 0) !== 2)) return null;
    const e = computeEquity(inHand.map((p) => holes[p.seat]!), board, { iterations: board.length === 0 ? 4000 : 10000 });
    return Object.fromEntries(inHand.map((p, i) => [p.seat, e.equity[i]]));
  }, [s, holes, board]);
}

export function HandReplay({ tournamentId, handId, onClose }: { tournamentId: string; handId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['hand-detail', tournamentId, handId],
    queryFn: () => api.get<{ hand: HandRow }>(`/tournaments/${tournamentId}/hands/${handId}`),
    enabled: !!handId,
  });
  const h = q.data?.hand;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const final = useMemo(() => (h ? replayHand(h.config, h.actions) : null), [h]);
  useEffect(() => {
    if (h) setStep(0);
  }, [h]);
  const total = h?.actions.length ?? 0;
  useEffect(() => {
    if (!playing) return;
    if (step >= total) return setPlaying(false);
    const t = setTimeout(() => setStep((x) => x + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const cur = useMemo(() => (h ? replayHand(h.config, h.actions.slice(0, step)) : null), [h, step]);
  // cartes connues en fin de main, révélées dès le début du replay
  const holes = useMemo(() => Object.fromEntries((final?.players ?? []).map((p) => [p.seat, p.cards])), [final]);
  const board = useMemo(() => {
    if (!cur || !final) return [];
    const n = cur.phase === 'complete' ? Math.max(cur.board.length, BOARD_SIZE[lastStreet(cur)]) : BOARD_SIZE[cur.phase];
    return final.board.slice(0, n);
  }, [cur, final]);
  const equity = useEquity(cur, holes, board);
  const events = final?.events.filter((e) => e.action < step) ?? [];

  return (
    <Modal open={!!handId} onClose={onClose} title={h ? `Replay — main #${h.handNumber} · table ${h.tableNumber}` : 'Replay'} size="xl">
      {!h || !cur || !final ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-3">
          <TableView
            seats={stateSeats(cur, { reveal: holes, equity: equity ?? undefined })}
            maxSeats={Math.max(...h.config.seats.map((x) => x.seat), 6)}
            button={h.config.button}
            center={
              <>
                <span className="text-[10px] font-black uppercase tracking-widest text-white/70">{STREET_LABEL[cur.phase]}</span>
                <CardRow cards={board} size="md" />
                <PotsView s={cur} />
              </>
            }
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button className="btn-ghost btn-sm" onClick={() => setStep(0)} aria-label="Début">
              <SkipBack size={16} />
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setStep(Math.max(0, step - 1))} aria-label="Précédent">
              <ChevronLeft size={16} />
            </button>
            <button className="btn-primary btn-sm min-w-24" onClick={() => (step >= total ? (setStep(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? 'Pause' : 'Lecture'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setStep(Math.min(total, step + 1))} aria-label="Suivant">
              <ChevronRight size={16} />
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setStep(total)} aria-label="Fin">
              <SkipForward size={16} />
            </button>
            <input type="range" min={0} max={total} value={step} onChange={(e) => setStep(+e.target.value)} className="w-full accent-accent-500 sm:w-60" aria-label="Position dans la main" />
            <span className="text-xs tabular text-zinc-400">
              {step} / {total}
            </span>
          </div>
          {equity && <p className="text-center text-xs text-zinc-400">Pourcentages : chances de gagner à ce moment de la main (cartes révélées à l'abattage).</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <ol className="max-h-64 overflow-y-auto rounded-xl bg-black/20 p-2 text-sm">
              {events.map((e, i) => (
                <li key={i} className={cx('px-1 py-0.5', e.kind === 'street' && 'mt-1 font-black uppercase tracking-wider text-accent-300', e.kind === 'win' && 'font-bold text-amber-200', i === events.length - 1 && 'rounded bg-white/10')}>
                  {e.text}
                </li>
              ))}
            </ol>
            <div>{cur.phase === 'complete' ? <ResultView s={cur} /> : <p className="text-sm text-zinc-400">Avancez jusqu'à la fin de la main pour voir la distribution des pots.</p>}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Dernier tour d'enchères atteint (pour afficher le bon board dans une main finie). */
function lastStreet(s: HandState) {
  const streets = s.events.filter((e) => e.kind === 'street');
  const last = streets[streets.length - 1];
  if (!last) return 'preflop' as const;
  return last.phase;
}
