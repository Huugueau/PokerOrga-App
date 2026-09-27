import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@pokerorga/shared';
import { CalendarDays, Check, Clock, MapPin, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cx, Empty, Loading, Segmented } from '../components/ui';
import { api, assetUrl } from '../lib/api';
import { Frame } from './PlayerPages';

interface DirEvent {
  name: string;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  description: string | null;
  financialMode: 'money' | 'lots' | 'free';
  buyin: number;
  capacity: number | null;
  taken: number;
  status: 'open' | 'closed';
  publicToken: string;
  organizer: string | null;
  clubToken: string | null;
  mine: { code: string | null; status: string } | null;
}
interface DirClub {
  name: string;
  city: string | null;
  description: string | null;
  logoAssetId: string | null;
  publicToken: string;
  upcoming: number;
}

const MINE: Record<string, string> = { pending: 'Inscrit · à valider', validated: 'Inscrit', waitlist: "Liste d'attente", refused: 'Refusé' };

function DateBlock({ date }: { date: string | null }) {
  if (!date) return <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-ink-950/60 text-center text-[11px] text-zinc-400">Date à venir</div>;
  const d = new Date(date + 'T12:00:00');
  return (
    <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-ink-950/60">
      <span className="text-[11px] font-semibold uppercase text-accent-400">{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
      <span className="text-2xl font-black leading-none">{d.getDate()}</span>
      <span className="text-[11px] uppercase text-zinc-400">{d.toLocaleDateString('fr-FR', { month: 'short' })}</span>
    </div>
  );
}

/** Annuaire public : tournois ouverts et clubs que les organisateurs ont choisi d'afficher. */
export function DirectoryPage() {
  const [tab, setTab] = useState<'events' | 'clubs'>('events');
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['public-directory'], queryFn: () => api.get<{ events: DirEvent[]; clubs: DirClub[] }>('/public/directory') });
  const norm = q.trim().toLowerCase();
  const events = useMemo(
    () => (data?.events ?? []).filter((e) => !norm || [e.name, e.location, e.organizer].some((x) => x?.toLowerCase().includes(norm))),
    [data, norm],
  );
  const clubs = useMemo(() => (data?.clubs ?? []).filter((c) => !norm || [c.name, c.city].some((x) => x?.toLowerCase().includes(norm))), [data, norm]);

  return (
    <Frame subtitle="tournois & clubs" wide>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'events', label: `Tournois${data ? ` (${data.events.length})` : ''}` },
            { value: 'clubs', label: `Clubs${data ? ` (${data.clubs.length})` : ''}` },
          ]}
        />
        <div className="relative min-w-52 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'events' ? 'Nom, lieu, organisateur…' : 'Nom du club, ville…'} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : tab === 'events' ? (
        events.length === 0 ? (
          <Empty icon={<CalendarDays size={28} />} title="Aucun tournoi à venir">
            {norm ? 'Aucun résultat pour cette recherche.' : 'Les organisateurs n’ont pas encore publié de tournoi dans l’annuaire.'}
          </Empty>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {events.map((e) => {
              const full = e.capacity != null && e.taken >= e.capacity;
              return (
                <li key={e.publicToken} className="card flex gap-4 p-4">
                  <DateBlock date={e.eventDate} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-lg font-bold" title={e.name}>
                      {e.name}
                    </p>
                    <p className="truncate text-sm text-zinc-400">
                      {e.clubToken ? (
                        <Link to={`/p/club/${e.clubToken}`} className="hover:text-zinc-200 hover:underline">
                          {e.organizer}
                        </Link>
                      ) : (
                        e.organizer
                      )}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                      {e.eventTime && (
                        <span>
                          <Clock size={12} className="mr-1 inline" />
                          {e.eventTime}
                        </span>
                      )}
                      {e.location && (
                        <span className="max-w-full truncate">
                          <MapPin size={12} className="mr-1 inline" />
                          {e.location}
                        </span>
                      )}
                      <span>
                        <Users size={12} className="mr-1 inline" />
                        {e.capacity != null ? `${e.taken}/${e.capacity} places` : `${e.taken} inscrit(s)`}
                      </span>
                      <span className="font-semibold text-zinc-300">{e.financialMode === 'money' ? (e.buyin > 0 ? formatMoney(e.buyin) : 'Gratuit') : e.financialMode === 'lots' ? 'Lots' : 'Gratuit'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {e.mine && e.mine.status !== 'cancelled' ? (
                        <Link to={e.mine.code ? `/p/inscription/${e.mine.code}` : '/joueur/espace'} className="chip gap-1 border-emerald-400/40 text-emerald-300">
                          <Check size={12} /> {MINE[e.mine.status] ?? 'Inscrit'}
                        </Link>
                      ) : e.status === 'open' ? (
                        <Link to={`/p/register/${e.publicToken}`} className="btn-primary btn-sm">
                          {full ? "S'inscrire en liste d'attente" : "S'inscrire"}
                        </Link>
                      ) : (
                        <span className="chip text-zinc-400">Inscriptions closes</span>
                      )}
                      <Link to={`/p/register/${e.publicToken}`} className={cx('text-xs text-zinc-400 hover:text-zinc-200', e.status === 'open' && !e.mine && 'hidden')}>
                        Détails
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : clubs.length === 0 ? (
        <Empty icon={<Users size={28} />} title="Aucun club">
          {norm ? 'Aucun résultat pour cette recherche.' : 'Aucun club n’est encore affiché dans l’annuaire.'}
        </Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {clubs.map((c) => (
            <li key={c.publicToken}>
              <Link to={`/p/club/${c.publicToken}`} className="card flex gap-4 p-4 transition hover:border-accent-500/40">
                {c.logoAssetId ? (
                  <img src={assetUrl(c.logoAssetId) ?? undefined} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-ink-950/60 object-contain" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-ink-950/60 text-2xl font-black text-accent-400">{c.name.charAt(0).toUpperCase()}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">{c.name}</p>
                  <p className="text-sm text-zinc-400">
                    {c.city ?? 'Ville non précisée'}
                    {c.upcoming > 0 && <span className="text-accent-300"> · {c.upcoming} tournoi(s) à venir</span>}
                  </p>
                  {c.description && <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{c.description}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-center text-xs text-zinc-500">
        Vous organisez des tournois ?{' '}
        <Link to="/login" className="text-zinc-300 underline">
          Espace organisateur
        </Link>
      </p>
    </Frame>
  );
}
