import type { TournamentSnapshot } from '@pokerorga/shared';
import { Repeat, Trophy, UserMinus, UserPlus, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface FeedItem {
  id: number;
  icon: 'bust' | 'reentry' | 'join' | 'table' | 'final';
  text: string;
}

const ICONS = { bust: UserMinus, reentry: Repeat, join: UserPlus, table: Users, final: Trophy };

/** Déduit les événements marquants entre deux snapshots successifs. */
function diff(prev: TournamentSnapshot, next: TournamentSnapshot): Omit<FeedItem, 'id'>[] {
  const out: Omit<FeedItem, 'id'>[] = [];
  const before = new Map(prev.players.map((p) => [p.id, p]));
  const names = new Map(next.players.map((p) => [p.id, p.pseudo]));
  for (const p of next.players) {
    const b = before.get(p.id);
    if (!b) {
      if (prev.players.length > 0) out.push({ icon: 'join', text: `${p.pseudo} rejoint le tournoi` });
      continue;
    }
    if (b.status === 'active' && p.status === 'eliminated') {
      const by = p.eliminatedBy ? names.get(p.eliminatedBy) : null;
      out.push({ icon: 'bust', text: `${p.pseudo} éliminé${p.finishRank ? ` (${p.finishRank}e)` : ''}${by ? ` par ${by}` : ''}` });
    } else if (p.entries > b.entries) {
      out.push({ icon: 'reentry', text: `Re-entry : ${p.pseudo}${p.tableNumber ? ` → table ${p.tableNumber}` : ''}` });
    } else if (p.rebuys > b.rebuys) {
      out.push({ icon: 'reentry', text: `Recave : ${p.pseudo}` });
    } else if (b.status === 'eliminated' && p.status === 'active') {
      out.push({ icon: 'reentry', text: `${p.pseudo} revient en jeu` });
    }
  }
  const tablesBefore = new Set(prev.tables.map((t) => t.number));
  const tablesAfter = new Set(next.tables.map((t) => t.number));
  const becameFinal = next.tables.find((t) => t.isFinal && !prev.tables.find((x) => x.number === t.number)?.isFinal);
  if (becameFinal) out.push({ icon: 'final', text: `Table finale ! Tous à la table ${becameFinal.number}` });
  else for (const n of tablesBefore) if (!tablesAfter.has(n)) out.push({ icon: 'table', text: `Table ${n} cassée` });
  return out;
}

/** Notifications éphémères affichées sur tous les écrans (dont la TV). */
export function LiveFeed({ snap }: { snap: TournamentSnapshot }) {
  const prev = useRef<TournamentSnapshot | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  useEffect(() => {
    const p = prev.current;
    prev.current = snap;
    if (!p || p.tournament.id !== snap.tournament.id || p.tournament.version >= snap.tournament.version) return;
    const events = diff(p, snap).slice(0, 4);
    if (events.length === 0) return;
    const stamped = events.map((e, i) => ({ ...e, id: Date.now() + i + Math.random() }));
    setItems((cur) => [...cur, ...stamped].slice(-4));
    const ids = new Set(stamped.map((e) => e.id));
    setTimeout(() => setItems((cur) => cur.filter((x) => !ids.has(x.id))), 7000);
  }, [snap]);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-6 z-30 flex w-[min(92vw,380px)] flex-col gap-2">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        return (
          <div key={it.id} className="animate-pop flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/90 px-4 py-3 shadow-glass backdrop-blur">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--c-secondary) 20%, transparent)', color: 'var(--c-secondary)' }}>
              <Icon size={16} />
            </span>
            <span className="text-sm font-semibold text-zinc-100">{it.text}</span>
          </div>
        );
      })}
    </div>
  );
}
