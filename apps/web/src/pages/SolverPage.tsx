import { bestHand, computeEquity, describeHand, explainWin, type Card, type HandValue } from '@pokerorga/shared';
import { Plus, RotateCcw, Trophy, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cx } from '../components/ui';
import { CardPicker, CardRow, PlayingCard } from '../features/dealer/PokerUi';
import { ToolsFrame } from './ToolsPages';

interface Seat {
  name: string;
  cards: Card[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

/** Outil « Qui gagne ? » : départage de mains à l'abattage et équité sur board incomplet. */
export function SolverPage() {
  const [board, setBoard] = useState<Card[]>([]);
  const [seats, setSeats] = useState<Seat[]>([
    { name: 'Joueur 1', cards: [] },
    { name: 'Joueur 2', cards: [] },
  ]);
  const [picker, setPicker] = useState<'board' | number | null>(null);

  const used = (except: Card[]) => [...board, ...seats.flatMap((s) => s.cards)].filter((c) => !except.includes(c));
  const ready = seats.filter((s) => s.cards.length === 2);
  const boardOk = [0, 3, 4, 5].includes(board.length);

  const analysis = useMemo(() => {
    const ready = seats.filter((s) => s.cards.length === 2);
    if (ready.length < 2 || !boardOk) return null;
    if (board.length === 5) {
      const vals = ready.map((s) => ({ s, v: bestHand([...s.cards, ...board]) }));
      const sorted = vals.slice().sort((a, b) => b.v.score - a.v.score);
      const top = sorted[0].v.score;
      const winners = sorted.filter((x) => x.v.score === top);
      const firstLoser = sorted.find((x) => x.v.score < top);
      return { kind: 'showdown' as const, sorted, top, winners, reason: firstLoser ? explainWin(winners[0].v, firstLoser.v) : null };
    }
    const e = computeEquity(
      ready.map((s) => s.cards),
      board,
      { iterations: board.length === 0 ? 30000 : 20000 },
    );
    return { kind: 'equity' as const, e };
  }, [seats, board, boardOk]);

  const setSeat = (i: number, p: Partial<Seat>) => setSeats(seats.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const pickerSeat = typeof picker === 'number' ? seats[picker] : null;

  return (
    <ToolsFrame tab="solver">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card flex flex-col gap-4 p-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label">Board</span>
              {board.length > 0 && (
                <button className="text-xs text-zinc-400 hover:text-white" onClick={() => setBoard([])}>
                  Effacer
                </button>
              )}
            </div>
            <button className="rounded-xl bg-[#1c533f] p-3" onClick={() => setPicker('board')}>
              <CardRow cards={board} slots={5} size="lg" />
            </button>
            {!boardOk && <p className="mt-1 text-xs text-amber-300">Le board doit comporter 0, 3, 4 ou 5 cartes.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <span className="label">Mains des joueurs</span>
            {seats.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-white/5 p-2">
                <button onClick={() => setPicker(i)} className="flex gap-1" aria-label={`Cartes de ${s.name}`}>
                  <PlayingCard card={s.cards[0] ?? null} size="md" />
                  <PlayingCard card={s.cards[1] ?? null} size="md" />
                </button>
                <input className="input" value={s.name} onChange={(e) => setSeat(i, { name: e.target.value })} aria-label="Nom" />
                {seats.length > 2 && (
                  <button className="rounded-lg p-2 text-zinc-400 hover:bg-white/10" onClick={() => setSeats(seats.filter((_, k) => k !== i))} aria-label="Retirer">
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" disabled={seats.length >= 10} onClick={() => setSeats([...seats, { name: `Joueur ${seats.length + 1}`, cards: [] }])}>
                <Plus size={14} /> Ajouter un joueur
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  setBoard([]);
                  setSeats(seats.map((s) => ({ ...s, cards: [] })));
                }}
              >
                <RotateCcw size={14} /> Tout effacer
              </button>
            </div>
          </div>
        </div>

        <div className="card p-5">
          {!analysis ? (
            <p className="py-10 text-center text-zinc-400">Saisissez au moins deux mains (et éventuellement le board) pour voir qui gagne.</p>
          ) : analysis.kind === 'showdown' ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-accent-500/40 bg-accent-500/10 p-4">
                <p className="flex items-center gap-2 text-lg font-black text-accent-300">
                  <Trophy size={20} />
                  {analysis.winners.length > 1 ? `Partage : ${analysis.winners.map((w) => w.s.name).join(' et ')}` : `${analysis.winners[0].s.name} gagne`}
                </p>
                <p className="font-semibold">{describeHand(analysis.winners[0].v)}</p>
                {analysis.reason && <p className="mt-1 text-sm text-amber-200">{analysis.reason}</p>}
                {analysis.winners.length > 1 && <p className="mt-1 text-sm text-zinc-300">Mêmes 5 meilleures cartes : le pot est partagé à parts égales.</p>}
              </div>
              <ol className="flex flex-col gap-1.5">
                {analysis.sorted.map(({ s, v }, i) => (
                  <HandLine key={i} name={s.name} v={v} win={v.score === analysis.top} rank={analysis.sorted.findIndex((x) => x.v.score === v.score) + 1} />
                ))}
              </ol>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-zinc-400">
                Chances de gagner {board.length === 0 ? 'préflop' : board.length === 3 ? 'au flop' : 'au turn'} ({analysis.e.exact ? 'calcul exact' : `${analysis.e.samples.toLocaleString('fr-FR')} tirages simulés`}).
              </p>
              {ready.map((s, i) => (
                <div key={i} className="rounded-xl bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-bold">
                      <CardRow cards={s.cards} size="sm" /> {s.name}
                    </span>
                    <span className="text-xl font-black tabular">{pct(analysis.e.equity[i])}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-accent-500" style={{ width: `${analysis.e.equity[i] * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    Gagne {pct(analysis.e.win[i])} · partage {pct(analysis.e.tie[i])}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CardPicker
        open={picker === 'board'}
        title="Board"
        counts={[0, 3, 4, 5]}
        initial={board}
        used={used(board)}
        onClose={() => setPicker(null)}
        onSave={(c) => {
          setBoard(c);
          setPicker(null);
        }}
      />
      <CardPicker
        open={pickerSeat != null}
        title={`Cartes de ${pickerSeat?.name ?? ''}`}
        counts={[0, 2]}
        initial={pickerSeat?.cards ?? []}
        used={used(pickerSeat?.cards ?? [])}
        onClose={() => setPicker(null)}
        onSave={(c) => {
          setSeat(picker as number, { cards: c });
          setPicker(null);
        }}
      />
    </ToolsFrame>
  );
}

function HandLine({ name, v, win, rank }: { name: string; v: HandValue; win: boolean; rank: number }) {
  return (
    <li className={cx('flex items-center gap-3 rounded-xl p-2', win ? 'bg-accent-500/15' : 'bg-white/5')}>
      <span className="w-5 text-center font-black text-zinc-400">{rank}</span>
      <CardRow cards={v.cards} size="sm" />
      <span className="min-w-0 text-sm">
        <b>{name}</b>
        <br />
        <span className="text-zinc-300">{describeHand(v)}</span>
      </span>
    </li>
  );
}
