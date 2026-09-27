import { useMutation } from '@tanstack/react-query';
import { CalendarDays, History, LogOut, Menu, PlayCircle, SquareStack, Trophy, User, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLogout, useMe } from '../lib/auth';
import { cx } from './ui';

const NAV = [
  { to: '/lives', label: 'Mes lives', icon: SquareStack },
  { to: '/planning', label: 'Mon planning', icon: CalendarDays },
  { to: '/championships', label: 'Championnats', icon: Trophy },
  { to: '/history', label: 'Historique', icon: History },
  { to: '/account', label: 'Mon compte', icon: User },
];

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const logout = useLogout();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const goLive = useMutation({
    mutationFn: () => api.post<{ id: string }>('/tournaments/current'),
    onSuccess: (r) => nav(`/live/${r.id}`),
  });
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <img src="/favicon.svg" alt="" className="h-9 w-9" />
        <span className="text-xl font-black">
          Poker<span className="text-gold-500">Orga</span>
        </span>
      </div>
      <div className="px-3">
        <button className="btn-primary w-full" onClick={() => goLive.mutate()}>
          <PlayCircle size={18} /> Ouvrir mon timer
        </button>
      </div>
      <nav className="mt-4 flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setOpen(false)}
            className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-gold-500/15 text-gold-300' : 'text-stone-300 hover:bg-white/5')}
          >
            <Icon size={18} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-stone-400">
        <p className="truncate font-medium text-stone-300">{me.data?.pseudo || me.data?.email}</p>
        {me.data?.clubName && <p className="truncate">{me.data.clubName}</p>}
        <button className="mt-3 flex items-center gap-2 text-stone-300 hover:text-white" onClick={logout}>
          <LogOut size={14} /> Déconnexion
        </button>
      </div>
    </div>
  );
  return (
    <div className="bg-felt flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/10 bg-ink-900/80 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-ink-900">{sidebar}</aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X /> : <Menu />}
          </button>
          <span className="font-black">
            Poker<span className="text-gold-500">Orga</span>
          </span>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
