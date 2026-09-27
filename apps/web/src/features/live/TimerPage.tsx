import {
  formatBlind,
  formatChips,
  formatMoney,
  formatMs,
  levelNumberAt,
  ordinalPrize,
  type ThemeConfig,
  type TournamentSnapshot,
} from '@pokerorga/shared';
import {
  ArrowLeftRight,
  Coins,
  QrCode as QrIcon,
  Expand,
  Minimize,
  Monitor,
  Pause,
  Play,
  PlusCircle,
  Settings,
  SkipBack,
  SkipForward,
  Trophy,
  UserMinus,
  UserPlus,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cx, Loading, useConfirm } from '../../components/ui';
import { api, assetUrl } from '../../lib/api';
import { SettingsOverlay, type SettingsTab } from '../settings/SettingsOverlay';
import { AddPlayerModal, BustFlow, MoveModal, SimplePlayerAction, type ActionKind } from './PlayerActions';
import { ResultsModal } from './ResultsModal';
import { LiveFeed } from './LiveFeed';
import { ScanModal } from './ScanModal';
import { useDeviceSound, useTimerSounds } from './sounds';
import { useClockView, useLive, useLiveAction, type ClockView } from './useLive';

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

export function themeStyle(theme: ThemeConfig): React.CSSProperties {
  return {
    ['--c-primary' as string]: theme.primary,
    ['--c-secondary' as string]: theme.secondary,
    ['--c-title' as string]: theme.title,
    ['--glass-opacity' as string]: String(theme.glassOpacity),
    ['--glass-blur' as string]: `${theme.glassBlur}px`,
    ['--font-timer' as string]: `'${theme.font}'`,
    ...(theme.backgroundAssetId
      ? { backgroundImage: `linear-gradient(rgba(8,10,12,.6), rgba(8,10,12,.6)), url(${assetUrl(theme.backgroundAssetId)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : {}),
  };
}

export function Logo({ theme, className }: { theme: ThemeConfig; className?: string }) {
  if (theme.logoAssetId) return <img src={assetUrl(theme.logoAssetId)!} alt="Logo" className={cx('object-contain', className)} />;
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <img src="/favicon.svg" alt="" className="h-full max-h-12 w-auto" />
      <span className="text-lg font-black tracking-tight">
        Poker<span className="accent">Orga</span>
      </span>
    </div>
  );
}

function LocalClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>;
}

export default function TimerPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tv = sp.get('tv') === '1';
  const live = useLive(id);
  const snap = live.data;
  const clock = useClockView(snap);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [action, setAction] = useState<ActionKind>(null);
  const [showResults, setShowResults] = useState(false);
  const [dismissedFinish, setDismissedFinish] = useState(false);
  const [device, setDevice] = useDeviceSound();
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const run = useLiveAction(id);
  const confirm = useConfirm();
  const navigate = useNavigate();

  useTimerSounds({
    levelIndex: clock?.levelIndex ?? 0,
    remainingMs: clock?.remainingMs ?? 0,
    running: clock?.running ?? false,
    status: snap?.tournament.status ?? 'prepared',
    theme: snap?.tournament.theme,
    enabled: !!snap,
  });

  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  useEffect(() => {
    if (snap) document.title = `${snap.tournament.title} - PokerOrga`;
  }, [snap?.tournament.title]);

  useEffect(() => {
    if (snap?.tournament.status === 'finished') navigate(`/history/${snap.tournament.id}`, { replace: true });
  }, [snap?.tournament.status]);

  const clockAction = useCallback(
    async (a: 'play' | 'pause' | 'next' | 'prev') => {
      if (!snap || !clock) return;
      if (a === 'next' || a === 'prev') {
        const idx = a === 'next' ? clock.levelIndex + 1 : clock.levelIndex - 1;
        const lv = snap.tournament.structure[idx];
        if (!lv) return;
        const ok = await confirm({
          title: lv.kind === 'break' ? (a === 'next' ? 'Passer à la pause ?' : 'Revenir à la pause ?') : `${a === 'next' ? 'Passer' : 'Revenir'} au niveau ${levelNumberAt(snap.tournament.structure, idx)} ?`,
          lines: lv.kind === 'level' ? [`Blindes ${formatBlind(lv.sb)} / ${formatBlind(lv.bb)}${lv.ante ? ` · Ante ${formatBlind(lv.ante)}` : ''}`] : [`Pause de ${lv.minutes} min`],
        });
        if (!ok) return;
        return run(() => api.post(`/tournaments/${snap.tournament.id}/clock`, { action: a, expectedLevel: clock.levelIndex }));
      }
      return run(() => api.post(`/tournaments/${snap.tournament.id}/clock`, { action: a }));
    },
    [snap, clock, run, confirm],
  );

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const setTv = (v: boolean) => {
    const next = new URLSearchParams(sp);
    if (v) next.set('tv', '1');
    else next.delete('tv');
    setSp(next, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsTab || action || showResults) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('[role=dialog]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void clockAction(clock?.running ? 'pause' : 'play');
      } else if (e.key === 'ArrowRight') void clockAction('next');
      else if (e.key === 'ArrowLeft') void clockAction('prev');
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key.toLowerCase() === 't') setTv(!tv);
      else if (e.key === 'Escape' && tv) setTv(false);
      else if (e.key.toLowerCase() === 's' && !tv) setAction('bust');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clockAction, clock?.running, settingsTab, action, showResults, tv]);

  if (live.isError) return <div className="p-10 text-center text-red-300">Impossible de charger le tournoi. Vérifiez votre connexion puis rechargez.</div>;
  if (!snap || !clock) return <div className="bg-felt min-h-screen"><Loading label="Chargement de votre tournoi" /></div>;

  const t = snap.tournament;
  const active = snap.stats.activePlayers;
  const finished = snap.players.length >= 2 && active === 1 && t.status === 'running';
  const controls = !tv;

  return (
    <div className="timer-root bg-felt min-h-screen" style={themeStyle(t.theme)}>
      {!live.connected && (
        <div className="fixed left-1/2 top-2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500/80 px-3 py-1 text-xs font-semibold">
          <WifiOff size={14} /> Reconnexion…
        </div>
      )}
      {isMobile && !tv ? (
        <MobileTimer snap={snap} clock={clock} onClock={clockAction} onAction={setAction} onSettings={() => setSettingsTab('general')} />
      ) : (
        <DesktopTimer
          snap={snap}
          clock={clock}
          tv={tv}
          controls={controls}
          onClock={clockAction}
          onAction={setAction}
          onSettings={() => setSettingsTab('general')}
          onTv={() => setTv(!tv)}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
          soundOn={device.enabled}
          onSound={() => setDevice({ enabled: !device.enabled })}
        />
      )}

      <LiveFeed snap={snap} />

      {t.pendingMoves.length > 0 && (
        <BalanceBanner snap={snap} onDone={() => run(() => api.post(`/tournaments/${t.id}/seating/ack`))} readOnly={tv} />
      )}

      {finished && !dismissedFinish && !tv && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(96vw,560px)] items-center justify-between gap-3 rounded-2xl border border-accent-500/50 bg-ink-900/95 px-5 py-4 shadow-glass animate-pop">
          <div className="flex items-center gap-3">
            <Trophy className="text-accent-400" />
            <div>
              <p className="font-bold">Tournoi terminé !</p>
              <p className="text-sm text-zinc-400">Vainqueur : {snap.players.find((p) => p.finishRank === 1)?.pseudo}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setShowResults(true)}>
              Voir le classement
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setDismissedFinish(true)}>
              ✕
            </button>
          </div>
        </div>
      )}

      {action === 'bust' && <BustFlow snap={snap} open onClose={() => setAction(null)} lateRegOpen={clock.lateRegOpen} />}
      {(action === 'rebuy' || action === 'addon' || action === 'undo-rebuy') && <SimplePlayerAction snap={snap} kind={action} onClose={() => setAction(null)} />}
      {action === 'add' && <AddPlayerModal snap={snap} onClose={() => setAction(null)} lateRegOpen={clock.lateRegOpen} />}
      {action === 'move' && <MoveModal snap={snap} onClose={() => setAction(null)} />}
      {action === 'scan' && <ScanModal tournamentId={t.id} onClose={() => setAction(null)} />}
      {showResults && (
        <ResultsModal
          snap={snap}
          onClose={() => setShowResults(false)}
          onFinish={async () => {
            const ok = await confirm({ title: 'Terminer ce tournoi ?', lines: ['Le live quitte cet écran', 'Un tournoi vierge le remplace', 'Joueurs et résultats restent dans l’historique'], confirmLabel: 'Terminer' });
            if (!ok) return;
            const r = await run(() => api.post<{ nextId: string }>(`/tournaments/${t.id}/finish`));
            if (r) navigate(`/history/${t.id}`);
          }}
        />
      )}
      {settingsTab && <SettingsOverlay snap={snap} clock={clock} tab={settingsTab} onTab={setSettingsTab} onClose={() => setSettingsTab(null)} onShowResults={() => setShowResults(true)} />}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: React.ReactNode; big?: boolean }) {
  return (
    <div className="text-center">
      <p className="eyebrow !text-zinc-300/80">{label}</p>
      <p className={cx('font-extrabold tabular title-color', big ? 'text-[clamp(1.6rem,3vw,3rem)]' : 'text-[clamp(1.2rem,2.2vw,2.2rem)]')}>{value}</p>
    </div>
  );
}

function money(snap: TournamentSnapshot, n: number) {
  return formatMoney(n);
}

function PayoutList({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  if (t.settings.hidePayout) return null;
  if (t.settings.isFree) return <p className="text-center text-sm text-zinc-400">Tournoi gratuit</p>;
  const lots = t.payouts.type === 'lots';
  const items = lots ? t.payouts.lots.filter(Boolean) : snap.computedPayouts;
  if (snap.players.length === 0) return <p className="text-center text-sm text-zinc-400">Ajouter des joueurs pour afficher les places payées</p>;
  if (items.length === 0) return <p className="text-center text-sm text-zinc-400">Aucune place payée configurée.</p>;
  const active = snap.stats.activePlayers;
  return (
    <ul className="space-y-1.5">
      {items.map((v, i) => {
        const winner = snap.players.find((p) => p.finishRank === i + 1 && p.status === 'eliminated');
        const bubble = i + 1 === active;
        return (
          <li key={i} className={cx('flex items-center justify-between gap-2 rounded-lg px-3 py-1.5', winner ? 'bg-white/5 text-zinc-400' : bubble ? 'bg-[color:var(--c-secondary)]/15' : 'bg-white/5')}>
            <span className="text-sm font-semibold">{ordinalPrize(i + 1)}</span>
            <span className="truncate text-right text-sm font-bold tabular">
              {winner ? <span className="mr-2 text-xs font-normal">{winner.pseudo}</span> : null}
              {lots ? String(v) : money(snap, Number(v))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DesktopTimer({
  snap,
  clock,
  tv,
  controls,
  onClock,
  onAction,
  onSettings,
  onTv,
  fullscreen,
  onFullscreen,
  soundOn,
  onSound,
}: {
  snap: TournamentSnapshot;
  clock: ClockView;
  tv: boolean;
  controls: boolean;
  onClock: (a: 'play' | 'pause' | 'next' | 'prev') => void;
  onAction: (a: ActionKind) => void;
  onSettings: () => void;
  onTv: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  soundOn: boolean;
  onSound: () => void;
}) {
  const t = snap.tournament;
  const s = snap.stats;
  const cur = clock.current;
  const isBreak = cur?.kind === 'break';
  const lastMinute = clock.running && clock.remainingMs <= 60000;
  const [seek, setSeek] = useState<number | null>(null);
  const run = useLiveAction(t.id);
  const pct = Math.round((seek ?? clock.progress) * 1000) / 10;
  const f = t.settings.entryFormat;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-3 p-3 lg:p-5">
      {/* en-tête */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="h-14">
          <Logo theme={t.theme} className="h-14 max-w-[220px]" />
        </div>
        <div className="flex flex-col items-center">
          <h1 className="title-color text-center text-[clamp(1.4rem,3vw,3rem)] font-black uppercase leading-tight tracking-wide">{t.title}</h1>
          {controls && snap.linked.length > 0 && <p className="text-xs font-semibold text-zinc-400">Horloge liée avec {snap.linked.map((l) => l.title).join(', ')}</p>}
          {controls && (
            <div className="mt-1 flex items-center gap-2" aria-label="Contrôles du timer">
              <button className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30" onClick={() => onClock('prev')} disabled={clock.levelIndex === 0} aria-label="Niveau précédent">
                <SkipBack size={20} />
              </button>
              <button className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-ink-950 hover:bg-white" onClick={() => onClock(clock.running ? 'pause' : 'play')} aria-label={clock.running ? 'Pause' : 'Reprendre'}>
                {clock.running ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
              </button>
              <button className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30" onClick={() => onClock('next')} disabled={clock.levelIndex >= t.structure.length - 1} aria-label="Niveau suivant">
                <SkipForward size={20} />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-start justify-end gap-2">
          {t.settings.showLocalClock && (
            <span className="mr-2 self-center text-2xl font-bold tabular title-color">
              <LocalClock />
            </span>
          )}
          {controls && (
            <>
              <button className="btn-ghost btn-sm" onClick={onSound} title={soundOn ? 'Couper les sons' : 'Activer les sons'}>
                {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button className="btn-ghost btn-sm" onClick={onSettings}>
                <Settings size={16} /> RÉGLAGES
              </button>
            </>
          )}
          <button className="btn-ghost btn-sm no-print" onClick={onTv} title={tv ? 'Revenir au mode desktop' : 'Activer le mode TV / Projecteur'}>
            <Monitor size={16} /> {tv ? 'QUITTER TV' : 'TV'}
          </button>
          <button className="btn-ghost btn-sm" onClick={onFullscreen} title={fullscreen ? 'Quitter le plein écran' : 'Passer en plein écran'}>
            {fullscreen ? <Minimize size={16} /> : <Expand size={16} />}
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(0,2.6fr)_minmax(220px,1.1fr)]">
        {/* stats */}
        <aside className="glass flex flex-row flex-wrap items-center justify-around gap-4 rounded-2xl p-4 lg:flex-col lg:justify-evenly">
          <Stat label="Joueurs" value={`${s.activePlayers} / ${s.totalEntries + (f === 'rebuys' ? 0 : 0)}`} />
          <Stat label="Moyenne" value={<>{formatChips(s.averageStack)}{cur?.kind === 'level' && cur.bb > 0 && s.averageStack > 0 && <span className="block text-[0.5em] font-semibold text-zinc-400">{Math.round(s.averageStack / cur.bb)} BB</span>}</>} />
          {!t.settings.isFree && !t.settings.hidePayout && <Stat label="Prizepool" value={formatMoney(s.prizePool)} />}
          {f === 'rebuys' && <Stat label="Recaves" value={s.totalRebuys} />}
          {t.settings.addonsEnabled && <Stat label="Add-ons" value={s.totalAddons} />}
          {t.settings.bounty.type !== 'none' && <Stat label="Bounties" value={t.settings.isFree ? `${s.bountyPool} pts` : formatMoney(s.bountyPool)} />}
        </aside>

        {/* horloge */}
        <section className="flex flex-col gap-3">
          <div className="glass flex flex-1 flex-col items-center justify-center rounded-2xl px-4 py-6">
            <p className="eyebrow !text-sm !text-zinc-200">{clock.finished ? 'Structure terminée' : 'Temps restant :'}</p>
            <p className={cx('title-color font-black leading-none tabular', lastMinute && 'text-red-400', 'text-[clamp(4.5rem,13vw,13rem)]')} style={lastMinute ? { color: '#f87171' } : undefined}>
              {clock.finished ? 'FIN' : formatMs(clock.remainingMs)}
            </p>
            {!clock.running && !clock.finished && <span className="animate-blink mt-1 rounded-md bg-[color:var(--c-secondary)] px-3 py-0.5 text-xs font-black tracking-widest text-ink-950">PAUSE</span>}
            {controls && (
              <input
                type="range"
                className="progress mt-5 w-full max-w-3xl"
                aria-label="Progression du niveau en cours"
                min={0}
                max={1000}
                value={Math.round((seek ?? clock.progress) * 1000)}
                style={{ ['--pct' as string]: `${pct}%` }}
                onChange={(e) => setSeek(Number(e.target.value) / 1000)}
                onPointerUp={() => {
                  if (seek == null) return;
                  const remainingMs = Math.round(clock.total * (1 - seek));
                  setSeek(null);
                  void run(() => api.post(`/tournaments/${t.id}/clock`, { action: 'seek', remainingMs }));
                }}
                onKeyUp={() => {
                  if (seek == null) return;
                  const remainingMs = Math.round(clock.total * (1 - seek));
                  setSeek(null);
                  void run(() => api.post(`/tournaments/${t.id}/clock`, { action: 'seek', remainingMs }));
                }}
              />
            )}
            {!controls && <div className="mt-5 h-2 w-full max-w-3xl overflow-hidden rounded-full bg-white/10"><div className="h-full" style={{ width: `${pct}%`, background: 'var(--c-secondary)' }} /></div>}
          </div>
          <div className="glass rounded-2xl px-4 py-5 text-center">
            {isBreak ? (
              <p className="title-color text-[clamp(2.5rem,6vw,6rem)] font-black tracking-widest">PAUSE</p>
            ) : (
              <>
                <p className="eyebrow !text-sm !text-zinc-200">Niveau {clock.levelNumber}</p>
                <p className="title-color text-[clamp(2.5rem,6.5vw,6.5rem)] font-black leading-none tabular">
                  {formatBlind(cur?.sb ?? 0)} / {formatBlind(cur?.bb ?? 0)}
                </p>
                {!!cur?.ante && <p className="accent mt-1 text-[clamp(1.1rem,2vw,2rem)] font-bold">Ante : {formatBlind(cur.ante)}</p>}
              </>
            )}
            <p className="mt-2 text-[clamp(.9rem,1.4vw,1.4rem)] font-semibold text-zinc-300">
              Niveau suivant :{' '}
              <span className="title-color font-bold tabular">
                {clock.nextLevel ? `${formatBlind(clock.nextLevel.sb)} / ${formatBlind(clock.nextLevel.bb)}${clock.nextLevel.ante ? ` (${formatBlind(clock.nextLevel.ante)})` : ''}` : '—'}
              </span>
            </p>
          </div>
        </section>

        {/* colonne droite */}
        <aside className="flex flex-col gap-3">
          <div className="glass grid grid-cols-2 gap-2 rounded-2xl p-4">
            <Stat label="Pause dans" value={clock.breakIn ?? '—'} />
            <Stat label={clock.lateRegOpen ? 'Fin enr. tardif' : 'Enr. tardif'} value={clock.lateRegOpen ? (clock.lateRegIn ?? '—') : 'Terminé'} />
          </div>
          {controls && (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn col-span-2 border border-red-400/40 bg-red-500/15 py-3 text-base text-red-100 hover:bg-red-500/25" onClick={() => onAction('bust')}>
                <UserMinus size={18} /> Sortant
              </button>
              <button className="btn-ghost" onClick={() => onAction('add')}>
                <UserPlus size={16} /> Joueur
              </button>
              <button className="btn-ghost" onClick={() => onAction('move')} disabled={snap.tables.length === 0}>
                <ArrowLeftRight size={16} /> Déplacer
              </button>
              <button className="btn-ghost col-span-2" onClick={() => onAction('scan')}>
                <QrIcon size={16} /> Scan QR code
              </button>
              {f === 'rebuys' && (
                <button className="btn-ghost" onClick={() => onAction('rebuy')}>
                  <Coins size={16} /> Recave
                </button>
              )}
              {t.settings.addonsEnabled && (
                <button className="btn-ghost" onClick={() => onAction('addon')}>
                  <PlusCircle size={16} /> Add-on
                </button>
              )}
            </div>
          )}
          <div className="glass flex-1 rounded-2xl p-4">
            <p className="eyebrow mb-3 text-center">{t.settings.multiSng ? 'Sit-and-Go' : 'Places payées'}</p>
            {t.settings.multiSng ? <SngStatus snap={snap} /> : <PayoutList snap={snap} />}
          </div>
        </aside>
      </main>
      <footer className="text-center text-[11px] text-zinc-500 no-print">Espace : pause/reprise · ←/→ : niveaux · S : sortant · T : mode TV · F : plein écran</footer>
    </div>
  );
}

function MobileTimer({
  snap,
  clock,
  onClock,
  onAction,
  onSettings,
}: {
  snap: TournamentSnapshot;
  clock: ClockView;
  onClock: (a: 'play' | 'pause' | 'next' | 'prev') => void;
  onAction: (a: ActionKind) => void;
  onSettings: () => void;
}) {
  const t = snap.tournament;
  const cur = clock.current;
  const f = t.settings.entryFormat;
  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 pb-6">
      <div className="flex items-center justify-between">
        <Logo theme={t.theme} className="h-9 max-w-[140px]" />
        <button className="btn-ghost btn-sm" onClick={onSettings}>
          <Settings size={16} /> Réglages
        </button>
      </div>
      <h1 className="title-color text-center text-2xl font-black uppercase">{t.title}</h1>
      <div className="glass rounded-2xl p-4 text-center">
        <p className="title-color text-6xl font-black tabular">{clock.finished ? 'FIN' : formatMs(clock.remainingMs)}</p>
        {!clock.running && <span className="text-xs font-black tracking-widest accent">PAUSE</span>}
        <SeekBar tournamentId={t.id} clock={clock} className="mt-3" />
        <p className="mt-2 text-xl font-bold tabular">{cur?.kind === 'break' ? 'PAUSE' : `Niv. ${clock.levelNumber} · ${formatBlind(cur?.sb ?? 0)} / ${formatBlind(cur?.bb ?? 0)}${cur?.ante ? ` (${formatBlind(cur.ante)})` : ''}`}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-300">
          <span>
            Joueurs
            <br />
            <b className="text-base text-white">
              {snap.stats.activePlayers}/{snap.stats.totalEntries}
            </b>
          </span>
          <span>
            Moyenne
            <br />
            <b className="text-base text-white">{formatChips(snap.stats.averageStack)}</b>
          </span>
          <span>
            Pause dans
            <br />
            <b className="text-base text-white">{clock.breakIn ?? '—'}</b>
          </span>
        </div>
      </div>
      <button className="btn min-h-24 flex-1 rounded-2xl border border-red-400/40 bg-red-500/15 text-2xl text-red-100" onClick={() => onAction('bust')}>
        <UserMinus size={28} /> Sortant
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost py-4" onClick={() => onAction('add')}>
          <UserPlus size={18} /> Ajouter joueur
        </button>
        <button className="btn-ghost py-4" onClick={() => onAction('move')} disabled={snap.tables.length === 0}>
          <ArrowLeftRight size={18} /> Déplacer
        </button>
        <button className="btn-ghost col-span-2 py-4" onClick={() => onAction('scan')}>
          <QrIcon size={18} /> Scan QR code
        </button>
        {f === 'rebuys' && (
          <button className="btn-ghost py-4" onClick={() => onAction('rebuy')}>
            <Coins size={18} /> Recave
          </button>
        )}
        {t.settings.addonsEnabled && (
          <button className="btn-ghost py-4" onClick={() => onAction('addon')}>
            <PlusCircle size={18} /> Add-on
          </button>
        )}
      </div>
      <div className="glass flex items-center justify-around rounded-2xl p-3">
        <button className="rounded-full p-3 disabled:opacity-30" onClick={() => onClock('prev')} disabled={clock.levelIndex === 0} aria-label="Niveau précédent">
          <SkipBack />
        </button>
        <button className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 text-ink-950" onClick={() => onClock(clock.running ? 'pause' : 'play')} aria-label={clock.running ? 'Pause' : 'Reprendre'}>
          {clock.running ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
        </button>
        <button className="rounded-full p-3 disabled:opacity-30" onClick={() => onClock('next')} disabled={clock.levelIndex >= t.structure.length - 1} aria-label="Niveau suivant">
          <SkipForward />
        </button>
      </div>
    </div>
  );
}

function BalanceBanner({ snap, onDone, readOnly }: { snap: TournamentSnapshot; onDone: () => void; readOnly: boolean }) {
  const moves = snap.tournament.pendingMoves;
  const names = useMemo(() => new Map(snap.players.map((p) => [p.id, p.pseudo])), [snap.players]);
  return (
    <div className="fixed inset-x-0 top-3 z-40 mx-auto w-[min(96vw,640px)] rounded-2xl border border-amber-400/60 bg-ink-900/95 p-4 shadow-glass animate-pop">
      <p className="mb-2 text-center font-black tracking-wide text-amber-300">⚠️ ÉQUILIBRAGE NÉCESSAIRE</p>
      <ul className="mb-3 max-h-60 space-y-1 overflow-y-auto">
        {moves.map((m, i) => (
          <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
            <span className="font-bold">{names.get(m.playerId) ?? m.pseudo ?? 'Joueur'}</span>
            <span className="tabular text-zinc-300">
              {m.from ? `T${m.from.table} S${m.from.seat}` : '—'} → <b className="text-white">Table {m.to.table} · Siège {m.to.seat}</b>
            </span>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <button className="btn-primary w-full" onClick={onDone}>
          C'EST FAIT 👍
        </button>
      )}
    </div>
  );
}

/** Barre d'avancement du niveau, déplaçable (desktop et mobile). */
function SeekBar({ tournamentId, clock, className }: { tournamentId: string; clock: ClockView; className?: string }) {
  const [seek, setSeek] = useState<number | null>(null);
  const run = useLiveAction(tournamentId);
  const pct = Math.round((seek ?? clock.progress) * 1000) / 10;
  const commit = () => {
    if (seek == null) return;
    const remainingMs = Math.round(clock.total * (1 - seek));
    setSeek(null);
    void run(() => api.post(`/tournaments/${tournamentId}/clock`, { action: 'seek', remainingMs }));
  };
  return (
    <input
      type="range"
      className={cx('progress w-full', className)}
      aria-label="Progression du niveau en cours"
      min={0}
      max={1000}
      value={Math.round((seek ?? clock.progress) * 1000)}
      style={{ ['--pct' as string]: `${pct}%` }}
      onChange={(e) => setSeek(Number(e.target.value) / 1000)}
      onPointerUp={commit}
      onKeyUp={commit}
      onTouchEnd={commit}
    />
  );
}

function SngStatus({ snap }: { snap: TournamentSnapshot }) {
  if (snap.tables.length === 0) return <p className="text-center text-sm text-zinc-400">Ajoutez des joueurs pour créer les SnG.</p>;
  return (
    <ul className="space-y-1.5">
      {snap.tables.map((tb) => {
        const ps = snap.players.filter((p) => p.sngGroup === tb.number);
        const active = ps.filter((p) => p.status === 'active');
        const winner = active.length === 1 && ps.length > 1 ? active[0] : null;
        return (
          <li key={tb.number} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm">
            <span className="font-semibold">SnG {tb.number}</span>
            <span className="tabular">{winner ? <span className="accent font-bold">🏆 {winner.pseudo}</span> : `${active.length}/${ps.length} en jeu`}</span>
          </li>
        );
      })}
    </ul>
  );
}
