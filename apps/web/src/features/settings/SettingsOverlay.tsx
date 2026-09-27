import { useQuery } from '@tanstack/react-query';
import type { TournamentSnapshot } from '@pokerorga/shared';
import {
  CalendarDays,
  Download,
  History,
  Layers,
  Layers3,
  ListOrdered,
  LogOut,
  Medal,
  Palette,
  RotateCcw,
  Settings2,
  Shield,
  SquareStack,
  Trophy,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cx, useConfirm } from '../../components/ui';
import { api } from '../../lib/api';
import { useLogout, useMe } from '../../lib/auth';
import { useLiveAction, type ClockView } from '../live/useLive';
import { GeneralPanel } from './GeneralPanel';
import { PayoutsPanel } from './PayoutsPanel';
import { PlayersPanel } from './PlayersPanel';
import { StructurePanel } from './StructurePanel';
import { ThemePanel } from './ThemePanel';

export type SettingsTab = 'general' | 'theme' | 'players' | 'structure' | 'payouts';

const TABS: { key: SettingsTab; label: string; icon: typeof Settings2 }[] = [
  { key: 'general', label: 'Réglages', icon: Settings2 },
  { key: 'theme', label: 'Personnalisation du timer', icon: Palette },
  { key: 'players', label: 'Gestion des joueurs', icon: Users },
  { key: 'structure', label: 'Éditeur de structure', icon: Layers },
  { key: 'payouts', label: 'Gestion des places payées', icon: Medal },
];

const LINKS = [
  { to: '/lives', label: 'Mes lives', icon: SquareStack },
  { to: '/planning', label: 'Mon planning', icon: CalendarDays },
  { to: '/flights', label: 'Tournois flights', icon: Layers3 },
  { to: '/championships', label: 'Championnats', icon: Trophy },
  { to: '/club', label: 'Mon club', icon: Shield },
  { to: '/history', label: 'Historique', icon: History },
  { to: '/account', label: 'Mon compte', icon: User },
];

export function SettingsOverlay({
  snap,
  clock,
  tab,
  onTab,
  onClose,
  onShowResults,
}: {
  snap: TournamentSnapshot;
  clock: ClockView;
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onClose: () => void;
  onShowResults: () => void;
}) {
  const t = snap.tournament;
  const me = useMe();
  const logout = useLogout();
  const confirm = useConfirm();
  const run = useLiveAction(t.id);
  const navigate = useNavigate();
  const lives = useQuery({ queryKey: ['lives'], queryFn: () => api.get<{ tournaments: { id: string }[] }>('/tournaments') });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const statusLabel =
    t.status === 'prepared'
      ? snap.players.length === 0
        ? 'Préparé · aucun joueur'
        : `Préparé · ${snap.players.length} joueur(s)`
      : clock.running
        ? 'En cours'
        : 'En pause';

  const reset = async () => {
    const ok = await confirm({
      title: 'Réinitialiser ce tournoi ?',
      lines: ['Tous les joueurs seront retirés', 'Structure et chrono à zéro', 'Réglages et thème conservés', 'Action irréversible'],
      confirmLabel: 'Réinitialiser',
      danger: true,
    });
    if (ok) await run(() => api.post(`/tournaments/${t.id}/reset`), 'Tournoi réinitialisé.');
  };
  const finish = async () => {
    const ok = await confirm({
      title: 'Terminer ce tournoi ?',
      lines: ['Le live quitte cet écran', 'Un tournoi vierge le remplace', 'Joueurs et résultats restent dans l’historique'],
      confirmLabel: 'Terminer',
      danger: true,
    });
    if (!ok) return;
    const r = await run(() => api.post<{ nextId: string }>(`/tournaments/${t.id}/finish`));
    if (r) navigate(snap.players.length ? `/history/${t.id}` : `/live/${r.nextId}`);
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Supprimer ce tournoi jamais utilisé ?', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    const r = await run(() => api.del<{ nextId: string }>(`/tournaments/${t.id}`));
    if (r) navigate(`/live/${r.nextId}`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex bg-ink-950/95 backdrop-blur-md" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <aside className="hidden w-72 shrink-0 flex-col border-r border-white/10 bg-ink-900 md:flex">
        <div className="border-b border-white/10 p-4">
          <p className="eyebrow">Tournoi de cet écran</p>
          <p className="mt-1 truncate font-bold">{t.title}</p>
          <p className="text-xs text-zinc-400">{statusLabel}</p>
          {snap.linked.length > 0 && (
            <div className="mt-2 rounded-lg bg-accent-500/10 px-2.5 py-2 text-xs">
              <p className="font-semibold text-accent-300">Horloge liée</p>
              <p className="text-zinc-300">avec {snap.linked.map((l) => l.title).join(', ')}</p>
              <button
                className="mt-1 text-zinc-400 underline hover:text-white"
                onClick={async () => {
                  const ok = await confirm({ title: 'Séparer ce tournoi ?', lines: ['Il garde le niveau et le temps actuels', 'Son timer devient indépendant'], confirmLabel: 'Séparer' });
                  if (ok) await run(() => api.post(`/tournaments/${t.id}/unlink`), 'Horloge séparée.');
                }}
              >
                Séparer l'horloge
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button className="btn-ghost btn-sm" onClick={onShowResults} title="Classement">
              <ListOrdered size={14} />
            </button>
            <a className="btn-ghost btn-sm" href={`/api/tournaments/${t.id}/export.csv`} title="Exporter le tournoi actuel (csv)">
              <Download size={14} />
            </a>
            <button className="btn-ghost btn-sm" onClick={reset} title="Réinitialiser le tournoi">
              <RotateCcw size={14} />
            </button>
            {snap.players.length === 0 && (lives.data?.tournaments.length ?? 0) > 1 ? (
              <button className="btn-danger btn-sm" onClick={remove}>
                Supprimer
              </button>
            ) : (
              <button className="btn-danger btn-sm" onClick={finish} title="Terminer : archive ce live et libère l'écran">
                Terminer
              </button>
            )}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => onTab(key)} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold', tab === key ? 'bg-accent-500/15 text-accent-300' : 'text-zinc-300 hover:bg-white/5')}>
              <Icon size={17} /> {label}
            </button>
          ))}
          <div className="my-2 border-t border-white/10" />
          {LINKS.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-white/5">
              <Icon size={17} /> {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs text-zinc-400">
          <p className="truncate">{me.data?.email}</p>
          <button className="mt-2 flex items-center gap-2 text-zinc-300 hover:text-white" onClick={logout}>
            <LogOut size={14} /> Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-ink-900/90">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <select className="input w-auto md:hidden" value={tab} onChange={(e) => onTab(e.target.value as SettingsTab)}>
            {TABS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <h2 className="hidden text-lg font-bold md:block">{TABS.find((x) => x.key === tab)?.label}</h2>
          <SaveIndicator />
          <button className="ml-auto btn-ghost btn-sm" onClick={onClose}>
            <X size={16} /> Fermer
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-5xl">
            {tab === 'general' && <GeneralPanel snap={snap} />}
            {tab === 'theme' && <ThemePanel snap={snap} />}
            {tab === 'players' && <PlayersPanel snap={snap} lateRegOpen={clock.lateRegOpen} />}
            {tab === 'structure' && <StructurePanel snap={snap} />}
            {tab === 'payouts' && <PayoutsPanel snap={snap} />}
            <div className="mt-8 grid grid-cols-2 gap-2 md:hidden">
              {LINKS.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to} className="btn-ghost">
                  <Icon size={16} /> {label}
                </Link>
              ))}
              <button className="btn-ghost" onClick={reset}>
                <RotateCcw size={16} /> Réinitialiser
              </button>
              <button className="btn-danger" onClick={finish}>
                Terminer le tournoi
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Indicateur global « Enregistrement… / Enregistré ». */
let listeners: ((s: 'idle' | 'saving' | 'saved') => void)[] = [];
export function setSaveState(s: 'idle' | 'saving' | 'saved') {
  listeners.forEach((l) => l(s));
}
function SaveIndicator() {
  const [s, setS] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => {
    const l = (v: typeof s) => setS(v);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  if (s === 'idle') return null;
  return <span className="text-xs text-zinc-400">{s === 'saving' ? 'Enregistrement…' : '✓ Enregistré'}</span>;
}
