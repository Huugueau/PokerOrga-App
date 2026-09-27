import { useQuery } from '@tanstack/react-query';
import { IdCard, History, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { cx } from './ui';

export type PlayerSuggestion = {
  key: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  memberId: string | null;
  playerAccountId: string | null;
  sources: ('member' | 'past' | 'account')[];
  tournaments: number;
};

export type PlayerLink = { memberId: string | null; playerAccountId: string | null; label: string };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const fullName = (s: { firstName: string | null; lastName: string | null }) => [s.firstName, s.lastName].filter(Boolean).join(' ');

export function linkLabel(s: PlayerSuggestion) {
  if (s.memberId) return 'Adhérent du club';
  if (s.playerAccountId) return 'Compte joueur';
  return 'Joueur de vos tournois';
}

/**
 * Champ « pseudo » avec suggestions : adhérents, joueurs des tournois passés et comptes joueurs.
 * La saisie libre reste possible ; choisir une suggestion appelle onPick.
 */
export function PlayerSearchInput({
  value,
  onChange,
  onPick,
  exclude,
  accountsOnly,
  hideMembers,
  placeholder = 'Pseudo ou nom…',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: PlayerSuggestion) => void;
  /** pseudos (minuscules) à masquer, ex. déjà inscrits */
  exclude?: Set<string>;
  accountsOnly?: boolean;
  /** masque les joueurs déjà adhérents du club */
  hideMembers?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const q = useDebounced(value.trim(), 200);
  const box = useRef<HTMLDivElement>(null);
  const { data, isFetching } = useQuery({
    queryKey: ['directory-players', q],
    queryFn: () => api.get<{ players: PlayerSuggestion[] }>(`/directory/players?q=${encodeURIComponent(q)}`),
    enabled: open,
    staleTime: 30_000,
  });
  const list = (data?.players ?? []).filter((s) => !exclude?.has(s.pseudo.toLowerCase()) && (!accountsOnly || s.playerAccountId) && (!hideMembers || !s.memberId)).slice(0, 8);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setHi(0), [q]);

  const pick = (s: PlayerSuggestion) => {
    onPick(s);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        className="input"
        value={value}
        maxLength={40}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && list.length > 0}
        aria-autocomplete="list"
        data-autofocus={autoFocus || undefined}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || list.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => (h + 1) % list.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => (h - 1 + list.length) % list.length);
          } else if (e.key === 'Enter' && value.trim() && list[hi]) {
            // Entrée choisit la suggestion surlignée seulement si elle correspond exactement ; sinon soumission libre
            if (list[hi].pseudo.toLowerCase() === value.trim().toLowerCase()) {
              e.preventDefault();
              pick(list[hi]);
            }
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (list.length > 0 || (isFetching && !data)) && (
        <ul role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-ink-600 bg-ink-800 py-1 shadow-xl">
          {list.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">Recherche…</li>}
          {list.map((s, i) => (
            <li
              key={s.key}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setHi(i)}
              className={cx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', i === hi && 'bg-ink-700')}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-zinc-100">{s.pseudo}</div>
                {fullName(s) && <div className="truncate text-xs text-zinc-400">{fullName(s)}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400">
                {s.sources.includes('member') && (
                  <span className="chip gap-1 !py-0.5" title="Adhérent de votre club">
                    <IdCard size={12} /> <span className="hidden sm:inline">Adhérent</span>
                  </span>
                )}
                {s.tournaments > 0 && (
                  <span className="chip gap-1 !py-0.5" title="Tournois joués chez vous">
                    <History size={12} /> {s.tournaments}
                  </span>
                )}
                {s.playerAccountId && (
                  <span className="chip gap-1 !py-0.5 text-accent-300" title="Possède un compte joueur : ses résultats apparaîtront dans son espace">
                    <UserRound size={12} /> <span className="hidden sm:inline">Compte</span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pastille « lié à … » affichée sous le champ après un choix. */
export function LinkedChip({ link, onClear }: { link: PlayerLink | null; onClear: () => void }) {
  if (!link) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs text-accent-300">
      <UserRound size={13} />
      <span>Lié : {link.label}</span>
      <button type="button" className="text-zinc-500 hover:text-zinc-200" onClick={onClear} aria-label="Retirer le lien">
        <X size={13} />
      </button>
    </div>
  );
}
