import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@pokerorga/shared';
import { CalendarDays, Compass, IdCard, LogOut, MapPin, RefreshCw, Trophy, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { QrCode } from '../components/QrCode';
import { cx, Empty, fmtDate, Loading, Toggle, useConfirm, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';

export interface PlayerAccount {
  id: string;
  email: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  qrCode: string;
  discoverable: boolean;
}

export function usePlayer() {
  return useQuery({ queryKey: ['player-me'], queryFn: async () => (await api.get<{ player: PlayerAccount | null }>('/player/me')).player, staleTime: 30_000 });
}

export function Frame({ children, subtitle = 'espace joueur', wide }: { children: React.ReactNode; subtitle?: string; wide?: boolean }) {
  const me = usePlayer();
  return (
    <div className="bg-felt min-h-screen">
      <div className={cx('mx-auto px-4 py-8', wide ? 'max-w-5xl' : 'max-w-3xl')}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/tournois" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-9 w-9" />
            <span className="text-xl font-black">
              Poker<span className="text-accent-500">Orga</span> <span className="hidden text-sm font-semibold text-zinc-400 sm:inline">· {subtitle}</span>
            </span>
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link to="/tournois" className="btn-ghost btn-sm">
              <Compass size={14} /> <span className="whitespace-nowrap">Tournois<span className="hidden sm:inline"> & clubs</span></span>
            </Link>
            <Link to={me.data ? '/joueur/espace' : '/joueur'} className="btn-ghost btn-sm">
              <UserRound size={14} /> <span className="max-w-32 truncate whitespace-nowrap">{me.data ? me.data.pseudo : 'Espace joueur'}</span>
            </Link>
          </nav>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Connexion / inscription d'un joueur. */
export function PlayerAuthPage() {
  const me = usePlayer();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>(sp.get('mode') === 'register' ? 'register' : 'login');
  const [f, setF] = useState({ email: '', password: '', pseudo: '', firstName: '', lastName: '' });
  const [err, setErr] = useState<string | null>(null);
  if (me.isLoading) return <Loading />;
  if (me.data) return <Navigate to={sp.get('next') || '/joueur/espace'} replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api.post<{ player: PlayerAccount }>(mode === 'login' ? '/player/login' : '/player/register', mode === 'login' ? { email: f.email, password: f.password } : f);
      qc.setQueryData(['player-me'], r.player);
      nav(sp.get('next') || '/joueur/espace', { replace: true });
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Erreur réseau.');
    }
  };
  return (
    <Frame>
      <div className="card mx-auto max-w-md p-6">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink-950/60 p-1">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx('rounded-lg py-2 text-sm font-semibold', mode === m ? 'bg-accent-500 text-ink-950' : 'text-zinc-300')}>
              {m === 'login' ? 'Connexion' : 'Créer mon compte'}
            </button>
          ))}
        </div>
        <p className="mb-4 text-sm text-zinc-400">Un compte joueur gratuit : un QR personnel pour pointer à l'accueil, vos préinscriptions et vos résultats au même endroit.</p>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <>
              <div>
                <label className="label">Pseudo *</label>
                <input className="input" value={f.pseudo} onChange={(e) => setF({ ...f, pseudo: e.target.value })} maxLength={40} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Prénom</label>
                  <input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
                </div>
                <div>
                  <label className="label">Nom</label>
                  <input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
                </div>
              </div>
            </>
          )}
          <div>
            <label className="label">Email *</label>
            <input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Mot de passe *</label>
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
          <button className="btn-primary w-full py-3">{mode === 'login' ? 'Se connecter' : 'Créer mon compte joueur'}</button>
        </form>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Vous organisez des tournois ? <Link to="/login" className="text-zinc-300 underline">Espace organisateur</Link>
        </p>
      </div>
    </Frame>
  );
}

interface MyTournaments {
  clubs: { name: string; city: string | null; pseudo: string; code: string; publicToken: string | null }[];
  registrations: { code: string | null; status: string; present: boolean; eventName: string; eventDate: string | null; eventTime: string | null; location: string | null; eventStatus: string; organizer: string | null }[];
  results: { tournament: string; date: string | null; rank: number; players: number; prize: number | null; prizeLabel: string | null; kills: number }[];
}

const REG_STATUS: Record<string, string> = { pending: 'À valider', validated: 'Validée', waitlist: "Liste d'attente", refused: 'Refusée', cancelled: 'Annulée' };

export function PlayerSpacePage() {
  const me = usePlayer();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const t = useQuery({ queryKey: ['player-tournaments'], queryFn: () => api.get<MyTournaments>('/player/me/tournaments'), enabled: !!me.data });
  const [f, setF] = useState({ pseudo: '', firstName: '', lastName: '' });
  useEffect(() => {
    if (me.data) setF({ pseudo: me.data.pseudo, firstName: me.data.firstName ?? '', lastName: me.data.lastName ?? '' });
  }, [me.data]);
  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/joueur" replace />;
  const p = me.data;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      qc.invalidateQueries({ queryKey: ['player-me'] });
      qc.invalidateQueries({ queryKey: ['player-tournaments'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  return (
    <Frame>
      <div className="space-y-5">
        <div className="card flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-3">
              <QrCode value={p.qrCode} size={180} />
            </div>
            <p className="font-mono text-xs text-zinc-500">{p.qrCode}</p>
            <button
              className="text-xs text-zinc-400 hover:text-white"
              onClick={async () => {
                if (await confirm({ title: 'Régénérer mon QR ?', lines: ["L'ancien QR (et une carte membre imprimée avec) ne fonctionnera plus."], confirmLabel: 'Régénérer' }))
                  await act(() => api.post('/player/me/regenerate-qr'), 'QR régénéré.');
              }}
            >
              <RefreshCw size={12} className="mr-1 inline" /> Régénérer
            </button>
          </div>
          <div className="w-full flex-1 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="break-words text-2xl font-black">{p.pseudo}</h1>
                <p className="break-all text-sm text-zinc-400">{p.email}</p>
              </div>
              <button
                className="btn-ghost btn-sm"
                onClick={async () => {
                  await api.post('/player/logout');
                  qc.setQueryData(['player-me'], null);
                  nav('/joueur');
                }}
              >
                <LogOut size={14} /> Déconnexion
              </button>
            </div>
            <p className="text-sm text-zinc-300">Présentez ce QR à l'accueil : l'organisateur vous pointe en un scan.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input" value={f.pseudo} onChange={(e) => setF({ ...f, pseudo: e.target.value })} placeholder="Pseudo" />
              <input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder="Prénom" />
              <input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="Nom" />
            </div>
            <button className="btn-ghost btn-sm" disabled={!f.pseudo.trim()} onClick={() => act(() => api.patch('/player/me', f), 'Profil mis à jour.')}>
              Enregistrer
            </button>
            <div className="border-t border-white/10 pt-3">
              <Toggle
                checked={p.discoverable}
                onChange={(v) => act(() => api.patch('/player/me', { discoverable: v }), v ? 'Les organisateurs peuvent vous trouver.' : 'Vous n’apparaissez plus dans la recherche.')}
                label="Les organisateurs peuvent me trouver par mon pseudo"
                hint="Pour vous ajouter directement à leur club ou à un tournoi. Seuls votre pseudo, votre prénom et l’initiale de votre nom sont visibles, jamais votre email."
              />
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="mb-3 font-bold">Mes tournois</h2>
          {!t.data?.registrations.length ? (
            <Empty title="Aucune préinscription">
              Trouvez un tournoi dans{' '}
              <Link to="/tournois" className="text-accent-300 underline">
                l’annuaire des tournois
              </Link>{' '}
              ou utilisez le lien partagé par un organisateur, en restant connecté.
            </Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {t.data.registrations.map((r, i) => (
                <li key={r.code ?? i} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-48 flex-1">
                    <p className="font-semibold">{r.eventName}</p>
                    <p className="flex flex-wrap gap-3 text-xs text-zinc-400">
                      <span>
                        <CalendarDays size={12} className="mr-1 inline" />
                        {r.eventDate ? fmtDate(r.eventDate) : 'Date à définir'}
                        {r.eventTime ? ` · ${r.eventTime}` : ''}
                      </span>
                      {r.location && (
                        <span>
                          <MapPin size={12} className="mr-1 inline" />
                          {r.location}
                        </span>
                      )}
                      {r.organizer && <span>{r.organizer}</span>}
                    </p>
                  </div>
                  <span className={cx('chip', r.status === 'validated' && 'border-emerald-400/40 text-emerald-300')}>
                    {REG_STATUS[r.status] ?? r.status}
                    {r.present ? ' · présent' : ''}
                  </span>
                  {r.code && r.eventStatus !== 'imported' && r.status !== 'cancelled' && r.status !== 'refused' && (
                    <button
                      className="text-xs text-zinc-400 hover:text-red-300"
                      onClick={async () => {
                        if (await confirm({ title: 'Annuler mon inscription ?', danger: true, confirmLabel: 'Annuler mon inscription' })) await act(() => api.post(`/player/me/registrations/${r.code}/cancel`), 'Inscription annulée.');
                      }}
                    >
                      Annuler
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!!t.data?.clubs.length && (
          <div className="card p-6">
            <h2 className="mb-3 font-bold">Mes clubs</h2>
            <ul className="divide-y divide-white/5">
              {t.data.clubs.map((c) => (
                <li key={c.code} className="flex flex-wrap items-center gap-3 py-3">
                  <IdCard size={18} className="text-accent-400" />
                  <div className="min-w-40 flex-1">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs text-zinc-400">
                      Adhérent · {c.pseudo}
                      {c.city ? ` · ${c.city}` : ''}
                    </p>
                  </div>
                  {c.publicToken && (
                    <Link to={`/p/club/${c.publicToken}`} className="btn-ghost btn-sm">
                      Page du club
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-zinc-500">Votre QR ci-dessus sert aussi de carte membre à l’accueil.</p>
          </div>
        )}

        <div className="card p-6">
          <h2 className="mb-3 font-bold">Mes résultats</h2>
          {!t.data?.results.length ? (
            <p className="text-sm text-zinc-400">Vos résultats apparaîtront ici après vos tournois.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {t.data.results.map((r, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-2 font-semibold">
                      {r.rank === 1 && <Trophy size={13} className="mr-1 inline text-accent-400" />}
                      {r.tournament}
                    </td>
                    <td className="text-zinc-400">{fmtDate(r.date)}</td>
                    <td className="tabular">
                      {r.rank}
                      <span className="text-zinc-500">/{r.players}</span>
                    </td>
                    <td className="text-right tabular">{r.prizeLabel ?? (r.prize ? formatMoney(r.prize) : '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Frame>
  );
}
