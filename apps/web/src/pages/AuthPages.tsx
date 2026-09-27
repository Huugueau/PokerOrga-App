import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { cx, Loading } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<{ allowRegistration: boolean }>('/auth/config') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me.isLoading) return <Loading />;
  if (me.data) return <Navigate to={sp.get('next') || '/'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email || !password) return setErr('Veuillez remplir les deux champs.');
    if (mode === 'register' && !terms) return setErr('Vous devez accepter les CGU pour vous inscrire.');
    setBusy(true);
    try {
      const r = await api.post<{ user: unknown }>(mode === 'login' ? '/auth/login' : '/auth/register', mode === 'login' ? { email, password } : { email, password, acceptTerms: true });
      qc.setQueryData(['me'], r.user);
      nav(sp.get('next') || (mode === 'register' ? '/account?welcome=1' : '/'), { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erreur réseau. Vérifiez votre connexion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-felt flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md p-7">
        <div className="mb-5 flex flex-col items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-14 w-14" />
          <p className="text-2xl font-black">
            Poker<span className="text-gold-500">Orga</span>
          </p>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-ink-950/60 p-1">
          <Link to="/login" className={cx('rounded-lg py-2 text-center text-sm font-semibold', mode === 'login' ? 'bg-gold-500 text-ink-950' : 'text-stone-300')}>
            Connexion
          </Link>
          {cfg.data?.allowRegistration !== false && (
            <Link to="/register" className={cx('rounded-lg py-2 text-center text-sm font-semibold', mode === 'register' ? 'bg-gold-500 text-ink-950' : 'text-stone-300')}>
              Inscription
            </Link>
          )}
        </div>
        <h1 className="text-center text-lg font-bold">{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h1>
        <p className="mb-5 text-center text-sm text-stone-400">{mode === 'login' ? 'Connectez-vous pour lancer votre timer.' : 'Inscrivez-vous pour organiser vos tournois.'}</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Email *</label>
            <input className="input" type="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Mot de passe *</label>
            <div className="relative">
              <input className="input pr-10" type={show ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {mode === 'register' && (
            <label className="flex items-start gap-2 text-sm text-stone-300">
              <input type="checkbox" className="mt-1 accent-[#c9a449]" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              J'accepte les conditions d'utilisation de cette instance PokerOrga.
            </label>
          )}
          {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
          <button className="btn-primary w-full py-3" disabled={busy}>
            {busy ? 'Patientez...' : mode === 'login' ? 'Se connecter →' : "S'inscrire →"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-stone-400">
          {mode === 'login' ? (
            cfg.data?.allowRegistration !== false && (
              <>
                Pas encore de compte ? <Link to="/register" className="text-gold-400">S'inscrire</Link>
              </>
            )
          ) : (
            <>
              Déjà un compte ? <Link to="/login" className="text-gold-400">Se connecter</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
