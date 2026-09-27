import { FULL_DECK, parseCards, RANKS, SUIT_SYMBOL, SUITS, type Card } from '@pokerorga/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { cx, Modal } from '../../components/ui';

/** Jeu 4 couleurs, plus lisible sur tablette. */
const SUIT_COLOR: Record<string, string> = { s: 'text-zinc-900', h: 'text-red-600', d: 'text-blue-600', c: 'text-green-700' };
const rankText = (r: string) => (r === 'T' ? '10' : r);

export function PlayingCard({ card, size = 'md', dim, onClick, highlight }: { card: Card | null; size?: 'xs' | 'sm' | 'md' | 'lg'; dim?: boolean; onClick?: () => void; highlight?: boolean }) {
  const box = {
    xs: 'h-7 w-5 text-[11px] rounded',
    sm: 'h-10 w-7 text-sm rounded-md',
    md: 'h-14 w-10 text-lg rounded-lg',
    lg: 'h-20 w-14 text-2xl rounded-lg',
  }[size];
  const Tag = onClick ? 'button' : 'div';
  if (!card) {
    return (
      <Tag
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={cx(box, 'flex shrink-0 items-center justify-center border border-dashed border-white/25 bg-white/5 text-zinc-500', onClick && 'hover:bg-white/10')}
      >
        {onClick ? '+' : ''}
      </Tag>
    );
  }
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        box,
        'flex shrink-0 flex-col items-center justify-center bg-white font-black leading-none shadow',
        SUIT_COLOR[card[1]],
        dim && 'opacity-40',
        highlight && 'ring-2 ring-amber-400',
      )}
    >
      <span>{rankText(card[0])}</span>
      <span className="text-[0.8em]">{SUIT_SYMBOL[card[1]]}</span>
    </Tag>
  );
}

export function CardBack({ size = 'sm' }: { size?: 'xs' | 'sm' | 'md' }) {
  const box = { xs: 'h-7 w-5 rounded', sm: 'h-10 w-7 rounded-md', md: 'h-14 w-10 rounded-lg' }[size];
  return <div className={cx(box, 'shrink-0 border border-white/30 bg-[repeating-linear-gradient(45deg,#2c6a55_0_4px,#1f4d3e_4px_8px)] shadow')} />;
}

export function CardRow({ cards, size, slots = 0, onClick, highlight }: { cards: Card[]; size?: 'xs' | 'sm' | 'md' | 'lg'; slots?: number; onClick?: () => void; highlight?: Card[] }) {
  const empty = Math.max(0, slots - cards.length);
  return (
    <div className={cx('flex gap-1', onClick && 'cursor-pointer')} onClick={onClick}>
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} highlight={highlight?.includes(c)} />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <PlayingCard key={`e${i}`} card={null} size={size} />
      ))}
    </div>
  );
}

/** Sélecteur de cartes (grille 52 cartes + saisie clavier « AsKd »). */
export function CardPicker({
  open,
  title,
  counts,
  initial,
  used,
  onClose,
  onSave,
  extra,
}: {
  open: boolean;
  title: ReactNode;
  /** Nombres de cartes acceptés (ex. [2] ou [3, 4, 5]). */
  counts: number[];
  initial: Card[];
  /** Cartes déjà utilisées ailleurs. */
  used: Card[];
  onClose: () => void;
  onSave: (cards: Card[]) => void;
  extra?: ReactNode;
}) {
  const [sel, setSel] = useState<Card[]>(initial);
  const [text, setText] = useState('');
  const max = Math.max(...counts);
  useEffect(() => {
    if (open) {
      setSel(initial);
      setText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const toggle = (c: Card) => {
    if (sel.includes(c)) setSel(sel.filter((x) => x !== c));
    else if (sel.length < max) setSel([...sel, c]);
  };
  const typed = (v: string) => {
    setText(v);
    const cards = parseCards(v);
    if (cards && cards.length <= max && cards.every((c) => !used.includes(c)) && new Set(cards).size === cards.length) setSel(cards);
  };
  const ok = counts.includes(sel.length);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          {extra}
          <button className="btn-ghost" onClick={() => setSel([])}>
            Effacer
          </button>
          <button className="btn-primary" disabled={!ok} onClick={() => onSave(sel)}>
            Valider {sel.length > 0 && `(${sel.length})`}
          </button>
        </>
      }
    >
      <div className="mb-3 flex min-h-20 flex-wrap items-center gap-2">
        {Array.from({ length: max }, (_, i) => (
          <PlayingCard key={i} card={sel[i] ?? null} size="lg" onClick={sel[i] ? () => toggle(sel[i]) : undefined} />
        ))}
        <input className="input ml-auto max-w-40 font-mono" placeholder="ex. AsKd" value={text} onChange={(e) => typed(e.target.value)} aria-label="Saisie rapide des cartes" />
      </div>
      <div className="grid gap-1.5">
        {[...SUITS].map((s) => (
          <div key={s} className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1">
            {[...RANKS]
              .reverse()
              .map((r) => r + s)
              .map((c) => {
                const taken = used.includes(c);
                const on = sel.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={taken}
                    onClick={() => toggle(c)}
                    className={cx(
                      'flex h-12 flex-col items-center justify-center rounded-md bg-white font-black leading-none transition disabled:opacity-15 sm:h-14',
                      SUIT_COLOR[s],
                      on ? 'ring-4 ring-accent-400' : 'hover:brightness-90',
                    )}
                    aria-label={c}
                  >
                    <span className="text-sm sm:text-base">{rankText(c[0])}</span>
                    <span className="text-xs">{SUIT_SYMBOL[s]}</span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">{FULL_DECK.length - used.length} cartes disponibles · touchez une carte sélectionnée pour la retirer.</p>
    </Modal>
  );
}

// ---------------- Table ----------------

export interface SeatView {
  seat: number;
  name: string;
  stack: number;
  bet?: number;
  bb?: number;
  cards?: Card[] | null;
  /** Cartes face cachée (joueur en main sans cartes connues). */
  hidden?: boolean;
  folded?: boolean;
  allIn?: boolean;
  active?: boolean;
  winner?: boolean;
  badges?: string[];
  note?: ReactNode;
  onClick?: () => void;
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

/** Position d'un siège sur l'ovale : le croupier est en bas, le siège 1 à sa gauche. */
function seatPos(index: number, total: number, k = 1) {
  const a = ((90 + ((index + 0.5) * 360) / total) * Math.PI) / 180;
  // rayons en variables CSS : ovale vertical sur téléphone, horizontal sur tablette
  return { left: `calc(50% + ${k * Math.cos(a)} * var(--rx))`, top: `calc(50% + ${k * Math.sin(a)} * var(--ry))` };
}

export function TableView({ seats, maxSeats, button, center }: { seats: SeatView[]; maxSeats: number; button?: number | null; center?: ReactNode }) {
  const total = Math.max(maxSeats, ...seats.map((s) => s.seat), 2);
  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-4xl [--rx:34%] [--ry:40%] sm:aspect-[16/9] sm:[--rx:39%] sm:[--ry:38%]">
      <div className="absolute inset-[10%_16%] rounded-[50%] border-[6px] border-[#5a3a22] bg-[radial-gradient(ellipse_at_center,#2c7a5c_0%,#1c533f_70%,#153f30_100%)] shadow-[inset_0_0_40px_rgba(0,0,0,.5)] sm:inset-[9%_7%]" />
      <div className="absolute inset-[30%_24%] flex flex-col items-center justify-center gap-1.5 text-center sm:inset-[22%_20%]">{center}</div>
      {seats.map((s) => {
        const pos = seatPos(s.seat - 1, total);
        return (
          <div key={s.seat} className="absolute -translate-x-1/2 -translate-y-1/2" style={pos}>
            <button
              type="button"
              onClick={s.onClick}
              disabled={!s.onClick}
              className={cx(
                'relative flex w-[92px] flex-col items-center gap-0.5 rounded-xl border px-1.5 py-1 text-center shadow-glass transition sm:w-[128px] sm:px-2 sm:py-1.5',
                s.active ? 'border-amber-300 bg-amber-400/25 ring-2 ring-amber-300' : s.winner ? 'border-accent-400 bg-accent-500/25' : 'border-white/15 bg-ink-900/90',
                s.folded && 'opacity-45',
                s.onClick && 'hover:border-white/40',
              )}
            >
              {(!!s.cards?.length || s.hidden) && (
                <div className="mb-0.5 flex gap-0.5">
                  {s.cards?.length ? s.cards.map((c) => <PlayingCard key={c} card={c} size="xs" />) : !s.folded && [0, 1].map((i) => <CardBack key={i} size="xs" />)}
                </div>
              )}
              <span className="w-full truncate text-[11px] font-bold sm:text-sm">
                <span className="text-zinc-500">{s.seat}.</span> {s.name}
              </span>
              <span className="text-[11px] font-semibold tabular text-zinc-200 sm:text-xs">
                {s.allIn ? <span className="font-black text-red-300">TAPIS</span> : fmt(s.stack)}
                {s.bb != null && !s.allIn && <span className="text-zinc-400"> · {s.bb < 10 ? s.bb.toFixed(1) : Math.round(s.bb)} BB</span>}
              </span>
              {s.note && <span className="text-[10px] leading-tight text-zinc-300 sm:text-[11px]">{s.note}</span>}
              {(button === s.seat || !!s.badges?.length) && (
                <div className="absolute -right-2 -top-2 flex gap-0.5">
                  {button === s.seat && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-ink-950 shadow">D</span>}
                  {s.badges?.map((b) => (
                    <span key={b} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[9px] font-black text-white shadow">
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </button>
          </div>
        );
      })}
      {seats
        .filter((s) => !!s.bet)
        .map((s) => (
          <div
            key={`bet${s.seat}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-dashed border-white/70 bg-amber-300 px-2 py-0.5 text-[11px] font-black tabular text-ink-950 shadow sm:text-xs"
            style={seatPos(s.seat - 1, total, 0.58)}
          >
            {fmt(s.bet!)}
          </div>
        ))}
    </div>
  );
}
