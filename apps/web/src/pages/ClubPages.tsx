import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@pokerorga/shared';
import {
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  ImagePlus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode } from '../components/QrCode';
import { cx, Empty, fmtDate, Loading, Modal, NumberField, PageHeader, Section, Segmented, Toggle, useConfirm, useToast } from '../components/ui';
import { api, ApiError, assetUrl } from '../lib/api';

export interface ClubRole {
  id: string;
  name: string;
  color: string;
}
export interface Club {
  id: string;
  name: string;
  city: string | null;
  description: string | null;
  logoAssetId: string | null;
  roles: ClubRole[];
  published: boolean;
  publicToken: string;
}
export interface Season {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  open: boolean;
  duesAmount: number;
}
type MType = 'live' | 'online' | 'both';
interface Payment {
  id: string;
  kind: 'dues' | 'donation';
  amount: number;
  method: string;
  paidOn: string;
  note: string | null;
  cancelledAt: string | null;
}
export interface Member {
  id: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  note: string | null;
  membershipType: MType;
  roleIds: string[];
  code: string;
  createdAt: string;
  membership: { exempt: boolean; duesExpected: number } | null;
  payments: Payment[];
  paidDues: number;
  donations: number;
  duesStatus: 'none' | 'exempt' | 'paid' | 'partial' | 'unpaid';
  tournaments: number;
}
interface Req {
  id: string;
  pseudo: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  membershipType: MType;
  status: 'pending' | 'accepted' | 'refused';
  createdAt: string;
}

const TYPE_LABEL: Record<MType, string> = { live: 'Live', online: 'Online', both: 'Online + Live' };
const METHOD_LABEL: Record<string, string> = { cash: 'Espèces', check: 'Chèque', transfer: 'Virement', helloasso: 'HelloAsso', other: 'Autre' };
const DUES: Record<Member['duesStatus'], { label: string; cls: string }> = {
  none: { label: 'Non adhérent', cls: 'text-zinc-500' },
  exempt: { label: 'Exonéré', cls: 'text-zinc-300' },
  paid: { label: 'À jour', cls: 'border-emerald-400/40 text-emerald-300' },
  partial: { label: 'Partielle', cls: 'border-amber-400/40 text-amber-300' },
  unpaid: { label: 'Cotisation en attente', cls: 'border-red-400/40 text-red-300' },
};

function useClub() {
  return useQuery({ queryKey: ['club'], queryFn: () => api.get<{ club: Club | null; seasons: Season[]; pendingRequests?: number }>('/club') });
}

export function ClubPage() {
  const q = useClub();
  const [tab, setTab] = useState<'members' | 'requests' | 'settings'>('members');
  const [seasonId, setSeasonId] = useState<string | null>(null);
  if (q.isLoading) return <Loading label="Chargement de votre espace club…" />;
  if (!q.data?.club) return <CreateClub />;
  const { club, seasons } = q.data;
  const season = seasons.find((s) => s.id === seasonId) ?? seasons.find((s) => s.open) ?? seasons[0] ?? null;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {club.logoAssetId && <img src={assetUrl(club.logoAssetId)!} alt="" className="h-10 w-10 rounded-lg object-contain" />}
            {club.name}
          </span>
        }
        subtitle={club.city ?? 'Ville non renseignée'}
        right={
          <>
            {seasons.length > 0 && (
              <select className="input w-auto" value={season?.id ?? ''} onChange={(e) => setSeasonId(e.target.value)} aria-label="Saison affichée">
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.open ? '' : ' (clôturée)'}
                  </option>
                ))}
              </select>
            )}
            {club.published && (
              <a className="btn-ghost" href={`/p/club/${club.publicToken}`} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> Page publique
              </a>
            )}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {(
          [
            ['members', 'Adhérents'],
            ['requests', `Demandes${q.data.pendingRequests ? ` (${q.data.pendingRequests})` : ''}`],
            ['settings', 'Paramètres et page publique'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-accent-500 text-ink-950' : 'bg-white/5 text-zinc-300 hover:bg-white/10')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'members' &&
        (season ? (
          <MembersTab club={club} season={season} seasons={seasons} />
        ) : (
          <Empty title="Aucune saison">Créez une saison dans Paramètres et page publique pour gérer vos adhérents.</Empty>
        ))}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'settings' && <SettingsTab club={club} seasons={seasons} />}
    </>
  );
}

function CreateClub() {
  const qc = useQueryClient();
  const toast = useToast();
  const year = new Date().getFullYear();
  const [f, setF] = useState({ name: '', city: '', description: '', seasonName: `Saison ${year}-${year + 1}`, startsOn: `${year}-09-01`, endsOn: `${year + 1}-08-31`, dues: 20 as number | null });
  const submit = async () => {
    try {
      await api.post('/club', { name: f.name, city: f.city, description: f.description, season: { name: f.seasonName, startsOn: f.startsOn || null, endsOn: f.endsOn || null, duesAmount: f.dues ?? 0 } });
      toast('Club et première saison créés.');
      qc.invalidateQueries({ queryKey: ['club'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  return (
    <>
      <PageHeader title="Mon club" subtitle="Page publique, demandes d'adhésion, annuaire des adhérents, cotisations et cartes membres." />
      <Section title="Créer la fiche de votre club" subtitle="Renseignez le nom du club et la première saison pour démarrer l'espace Mon club.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Nom du club *</label>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Club Poker de la Vallée" maxLength={120} />
          </div>
          <div>
            <label className="label">Ville</label>
            <input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Description</label>
            <textarea className="input min-h-24" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={3000} placeholder="Présentez votre club, son ambiance et son fonctionnement…" />
          </div>
          <div>
            <label className="label">Première saison</label>
            <input className="input" value={f.seasonName} onChange={(e) => setF({ ...f, seasonName: e.target.value })} />
          </div>
          <div>
            <label className="label">Cotisation indicative</label>
            <NumberField value={f.dues} suffix="€" onCommit={(v) => setF({ ...f, dues: v })} />
          </div>
          <div>
            <label className="label">Début</label>
            <input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </div>
          <div>
            <label className="label">Fin</label>
            <input className="input" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </div>
        </div>
        <button className="btn-primary mt-5" onClick={submit} disabled={f.name.trim().length < 2 || !f.seasonName.trim()}>
          Créer mon club
        </button>
      </Section>
    </>
  );
}

function MembersTab({ club, season, seasons }: { club: Club; season: Season; seasons: Season[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['club-members', season.id], queryFn: () => api.get<{ members: Member[] }>(`/club/members?seasonId=${season.id}`) });
  const lives = useQuery({ queryKey: ['lives'], queryFn: () => api.get<{ tournaments: { id: string; title: string }[] }>('/tournaments') });
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'season' | 'all'>('season');
  const [type, setType] = useState<'' | MType>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [enroll, setEnroll] = useState(false);
  const members = q.data?.members ?? [];
  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    return members.filter(
      (m) =>
        (scope === 'all' || m.membership) &&
        (!type || m.membershipType === type) &&
        (!n || `${m.pseudo} ${m.firstName ?? ''} ${m.lastName ?? ''} ${m.email ?? ''}`.toLowerCase().includes(n)),
    );
  }, [members, search, scope, type]);
  const inSeason = members.filter((m) => m.membership);
  const refresh = () => qc.invalidateQueries({ queryKey: ['club-members'] });
  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const openSeason = seasons.find((s) => s.open);
  const sel = [...selected];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Adhérents de la saison', String(inSeason.length)],
          ['À jour', String(inSeason.filter((m) => m.duesStatus === 'paid' || m.duesStatus === 'exempt').length)],
          ['Cotisations en attente', String(inSeason.filter((m) => m.duesStatus === 'unpaid' || m.duesStatus === 'partial').length)],
          ['Dons', formatMoney(inSeason.reduce((a, m) => a + m.donations, 0))],
        ].map(([l, v]) => (
          <div key={l} className="card p-4">
            <p className="eyebrow">{l}</p>
            <p className="mt-1 text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
      <Section
        title={`Adhérents · ${season.name}`}
        subtitle="Le suivi des cotisations et des dons est indicatif et ne constitue pas un justificatif comptable."
        right={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-primary btn-sm" onClick={() => setEditing('new')}>
              <UserPlus size={15} /> Ajouter un adhérent
            </button>
            <a className="btn-ghost btn-sm" href={`/api/club/members.csv?seasonId=${season.id}`}>
              <Download size={15} /> CSV
            </a>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="input pl-9" placeholder="Rechercher un nom ou un pseudo…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'season', label: 'Saison' },
              { value: 'all', label: 'Annuaire complet' },
            ]}
          />
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value as '' | MType)}>
            <option value="">Tous les types d'adhésion</option>
            <option value="live">Live</option>
            <option value="online">Online</option>
            <option value="both">Online + Live</option>
          </select>
        </div>
        {sel.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-accent-500/10 px-3 py-2 text-sm">
            <span className="font-semibold">{sel.length} sélectionné(s)</span>
            <button className="btn-ghost btn-sm" onClick={() => window.open(`/club/cards?season=${season.id}&ids=${sel.join(',')}`, '_blank')}>
              <Printer size={14} /> Imprimer les cartes
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setEnroll(true)}>
              <Users size={14} /> Inscrire au tournoi
            </button>
            {openSeason && (
              <button
                className="btn-ghost btn-sm"
                onClick={async () => {
                  try {
                    const r = await api.post<{ count: number }>('/club/renew', { memberIds: sel, seasonId: openSeason.id });
                    toast(`${r.count} adhésion(s) sur ${openSeason.name}.`);
                    refresh();
                  } catch (e) {
                    toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
                  }
                }}
              >
                <RefreshCw size={14} /> Réinscrire sur {openSeason.name}
              </button>
            )}
            <button className="ml-auto text-xs text-zinc-400 hover:text-white" onClick={() => setSelected(new Set())}>
              Tout désélectionner
            </button>
          </div>
        )}
        {q.isLoading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <Empty icon={<Users size={30} />} title="Aucun adhérent">
            Les adhérents apparaissent ici après acceptation de leur demande. Vous pouvez aussi créer la fiche d’un adhérent qui n’a pas de compte.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-zinc-400">
                  <th className="w-8 py-2">
                    <input type="checkbox" className="accent-[#4ea486]" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((m) => m.id)))} aria-label="Sélectionner tous les adhérents filtrés" />
                  </th>
                  <th className="py-2 pr-2">Adhérent</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Rôles</th>
                  <th className="py-2 pr-2">Cotisation</th>
                  <th className="py-2 pr-2 text-right">Tournois</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => setEditing(m)}>
                    <td className="py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="accent-[#4ea486]"
                        checked={selected.has(m.id)}
                        onChange={() => {
                          const n = new Set(selected);
                          if (n.has(m.id)) n.delete(m.id);
                          else n.add(m.id);
                          setSelected(n);
                        }}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <span className="font-semibold">{m.pseudo}</span>
                      <span className="block text-xs text-zinc-500">{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || '—'}</span>
                    </td>
                    <td className="py-2 pr-2 text-zinc-300">{TYPE_LABEL[m.membershipType]}</td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {m.roleIds.map((rid) => {
                          const r = club.roles.find((x) => x.id === rid);
                          return r ? (
                            <span key={rid} className="chip text-[10px]" style={{ borderColor: r.color + '66', color: r.color }}>
                              {r.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <span className={cx('chip text-[11px]', DUES[m.duesStatus].cls)}>{DUES[m.duesStatus].label}</span>
                      {m.membership && !m.membership.exempt && m.membership.duesExpected > 0 && <span className="ml-1 text-xs text-zinc-500">{formatMoney(m.paidDues)} / {formatMoney(m.membership.duesExpected)}</span>}
                    </td>
                    <td className="py-2 pr-2 text-right tabular">{m.tournaments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {editing && <MemberModal club={club} season={season} member={editing === 'new' ? null : editing} onClose={() => { setEditing(null); refresh(); }} />}
      {enroll && (
        <Modal open onClose={() => setEnroll(false)} title="Sur quel tournoi inscrire ces adhérents ?">
          {(lives.data?.tournaments ?? []).length === 0 ? (
            <p className="text-sm text-zinc-400">Aucun tournoi ouvert. Lancez un live avant d’y inscrire des adhérents.</p>
          ) : (
            <div className="space-y-2">
              {lives.data!.tournaments.map((t) => (
                <button
                  key={t.id}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:border-accent-500/50"
                  onClick={async () => {
                    try {
                      const r = await api.post<{ added: string[]; skipped: string[] }>('/club/enroll', { tournamentId: t.id, memberIds: sel });
                      toast(`${r.added.length} adhérent(s) inscrit(s)${r.skipped.length ? ` · déjà inscrits : ${r.skipped.join(', ')}` : ''}.`);
                      setEnroll(false);
                      setSelected(new Set());
                    } catch (e) {
                      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
                    }
                  }}
                >
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-xs text-zinc-400">Ajouter au tournoi →</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function MemberModal({ club, season, member, onClose }: { club: Club; season: Season; member: Member | null; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({
    pseudo: member?.pseudo ?? '',
    firstName: member?.firstName ?? '',
    lastName: member?.lastName ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    address: member?.address ?? '',
    note: member?.note ?? '',
    membershipType: member?.membershipType ?? ('live' as MType),
    roleIds: member?.roleIds ?? [],
  });
  const [pay, setPay] = useState({ kind: 'dues' as 'dues' | 'donation', amount: season.duesAmount || (null as number | null), method: 'cash', paidOn: new Date().toISOString().slice(0, 10) });
  const [code, setCode] = useState(member?.code ?? '');
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
  const save = async () => {
    try {
      if (member) await api.patch(`/club/members/${member.id}`, f);
      else await api.post('/club/members', { ...f, seasonId: season.open ? season.id : undefined });
      toast(member ? 'Adhérent enregistré.' : 'Adhérent ajouté.');
      onClose();
    } catch (e) {
      err(e);
    }
  };
  const setMembership = async (body: { active: boolean; exempt?: boolean; duesExpected?: number }) => {
    if (!member) return;
    try {
      await api.put(`/club/members/${member.id}/membership`, { seasonId: season.id, ...body });
      toast('Adhésion enregistrée.');
      onClose();
    } catch (e) {
      err(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={member ? `Modifier l'adhérent · ${member.pseudo}` : 'Ajouter un adhérent'}
      size="xl"
      footer={
        <>
          {member && (
            <button
              className="btn-danger mr-auto"
              onClick={async () => {
                if (await confirm({ title: 'Supprimer cet adhérent ?', lines: ['Toutes ses adhésions et cotisations sont supprimées', 'Ses résultats de tournois restent'], confirmLabel: 'Supprimer la fiche', danger: true })) {
                  await api.del(`/club/members/${member.id}`);
                  toast('Adhérent supprimé.');
                  onClose();
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={save} disabled={!f.pseudo.trim()}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <p className="eyebrow">Identité</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Pseudo *</label>
              <input className="input" value={f.pseudo} onChange={(e) => setF({ ...f, pseudo: e.target.value })} data-autofocus />
            </div>
            <div>
              <label className="label">Prénom</label>
              <input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
            </div>
            <div>
              <label className="label">Nom</label>
              <input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Téléphone</label>
              <input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">Type d'adhésion</label>
              <select className="input" value={f.membershipType} onChange={(e) => setF({ ...f, membershipType: e.target.value as MType })}>
                <option value="live">Live</option>
                <option value="online">Online</option>
                <option value="both">Online + Live</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Adresse postale</label>
            <input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </div>
          <div>
            <label className="label">Rôles</label>
            <div className="flex flex-wrap gap-1.5">
              {club.roles.map((r) => {
                const on = f.roleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setF({ ...f, roleIds: on ? f.roleIds.filter((x) => x !== r.id) : [...f.roleIds, r.id] })}
                    className={cx('rounded-full border px-3 py-1 text-xs font-semibold', on ? '' : 'border-white/10 text-zinc-400')}
                    style={on ? { borderColor: r.color, color: r.color, background: r.color + '1f' } : undefined}
                  >
                    {r.name}
                  </button>
                );
              })}
              {club.roles.length === 0 && <span className="text-xs text-zinc-500">Définissez des rôles dans les paramètres.</span>}
            </div>
          </div>
          <div>
            <label className="label">Note interne (visible du club uniquement)</label>
            <textarea className="input min-h-16" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>

          {member && (
            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="eyebrow">Adhésion · {season.name}</p>
              <Toggle checked={!!member.membership} onChange={(v) => setMembership({ active: v })} label={member.membership ? 'Adhérent sur cette saison' : 'Non adhérent sur cette saison'} />
              {member.membership && (
                <>
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="label">Montant attendu</label>
                      <NumberField className="w-32" value={member.membership.duesExpected} suffix="€" onCommit={(v) => setMembership({ active: true, duesExpected: v ?? 0 })} />
                    </div>
                    <Toggle checked={member.membership.exempt} onChange={(v) => setMembership({ active: true, exempt: v })} label="Exonéré de cotisation" />
                  </div>
                  <div className="rounded-xl bg-white/5 p-3">
                    <p className="mb-2 text-sm font-semibold">Enregistrer un paiement</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <select className="input w-auto" value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value as 'dues' | 'donation' })}>
                        <option value="dues">Cotisation</option>
                        <option value="donation">Don</option>
                      </select>
                      <NumberField className="w-28" value={pay.amount} suffix="€" onCommit={(v) => setPay({ ...pay, amount: v })} />
                      <select className="input w-auto" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                        {Object.entries(METHOD_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <input className="input w-auto" type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
                      <button
                        className="btn-ghost btn-sm"
                        disabled={!pay.amount}
                        onClick={async () => {
                          try {
                            await api.post(`/club/members/${member.id}/payments`, { ...pay, seasonId: season.id });
                            toast('Paiement enregistré.');
                            onClose();
                          } catch (e) {
                            err(e);
                          }
                        }}
                      >
                        <Plus size={14} /> Ajouter
                      </button>
                    </div>
                    <ul className="mt-3 space-y-1 text-sm">
                      {member.payments.length === 0 && <li className="text-zinc-500">Aucun montant enregistré.</li>}
                      {member.payments.map((p) => (
                        <li key={p.id} className={cx('flex items-center justify-between gap-2', p.cancelledAt && 'text-zinc-500 line-through')}>
                          <span>
                            {p.kind === 'dues' ? 'Cotisation' : 'Don'} · {formatMoney(p.amount)} · {METHOD_LABEL[p.method]} · {fmtDate(p.paidOn)}
                          </span>
                          {!p.cancelledAt && (
                            <button
                              className="text-xs text-zinc-400 hover:text-red-300"
                              onClick={async () => {
                                if (await confirm({ title: p.kind === 'dues' ? 'Annuler cette cotisation ?' : 'Annuler ce don ?', danger: true })) {
                                  await api.del(`/club/payments/${p.id}`);
                                  onClose();
                                }
                              }}
                            >
                              Annuler
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {member && (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 p-4 text-center">
            <p className="eyebrow">Carte membre</p>
            <div className="rounded-lg bg-white p-2">
              <QrCode value={code} size={150} />
            </div>
            <p className="font-mono text-xs text-zinc-400">{code}</p>
            <button className="btn-ghost btn-sm w-full" onClick={() => window.open(`/club/cards?season=${season.id}&ids=${member.id}`, '_blank')}>
              <CreditCard size={14} /> Imprimer la carte
            </button>
            <button
              className="text-xs text-zinc-400 hover:text-white"
              onClick={async () => {
                if (await confirm({ title: 'Régénérer le QR ?', lines: ["L'ancienne carte ne fonctionnera plus : réimprimez-la."], confirmLabel: 'Régénérer' })) {
                  const m = await api.post<{ code: string }>(`/club/members/${member.id}/regenerate-code`);
                  setCode(m.code);
                }
              }}
            >
              Régénérer le QR
            </button>
            <p className="text-xs text-zinc-500">{member.tournaments} tournoi(s) joué(s) · membre depuis le {fmtDate(member.createdAt)}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RequestsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['club-requests'], queryFn: () => api.get<{ items: Req[] }>('/club/requests') });
  const act = async (id: string, action: 'accept' | 'refuse') => {
    try {
      await api.post(`/club/requests/${id}/${action}`);
      toast(action === 'accept' ? 'Demande acceptée.' : 'Demande refusée.');
      qc.invalidateQueries({ queryKey: ['club-requests'] });
      qc.invalidateQueries({ queryKey: ['club'] });
      qc.invalidateQueries({ queryKey: ['club-members'] });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  const items = q.data?.items ?? [];
  return (
    <Section title="Demandes d'adhésion" subtitle="Acceptez ou refusez les demandes reçues depuis la page publique du club.">
      {items.length === 0 ? (
        <Empty title="Aucune demande">Publiez la page de votre club pour recevoir des demandes.</Empty>
      ) : (
        <div className="divide-y divide-white/5">
          {items.map((r) => (
            <div key={r.id} className={cx('flex flex-wrap items-center gap-3 py-3', r.status !== 'pending' && 'opacity-60')}>
              <div className="min-w-48 flex-1">
                <p className="font-semibold">
                  {r.pseudo} <span className="text-xs font-normal text-zinc-400">{[r.firstName, r.lastName].filter(Boolean).join(' ')}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {r.email} {r.phone && `· ${r.phone}`} · {TYPE_LABEL[r.membershipType]} · reçue le {fmtDate(r.createdAt)}
                </p>
                {r.message && <p className="mt-1 text-sm text-zinc-300">« {r.message} »</p>}
              </div>
              {r.status === 'pending' ? (
                <div className="flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => act(r.id, 'accept')}>
                    <Check size={14} /> Accepter
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => act(r.id, 'refuse')}>
                    <X size={14} /> Refuser
                  </button>
                </div>
              ) : (
                <span className="chip">{r.status === 'accepted' ? 'Acceptée' : 'Refusée'}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SettingsTab({ club, seasons }: { club: Club; seasons: Season[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({ name: club.name, city: club.city ?? '', description: club.description ?? '' });
  const [newSeason, setNewSeason] = useState<{ name: string; duesAmount: number | null } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['club'] });
  const patch = async (body: Partial<Club>, msg?: string) => {
    try {
      await api.patch('/club', body);
      refresh();
      if (msg) toast(msg);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    }
  };
  const publicUrl = `${window.location.origin}/p/club/${club.publicToken}`;
  const openSeason = seasons.find((s) => s.open);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Présentation du club" subtitle="Ces informations alimentent votre page publique.">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {club.logoAssetId ? <img src={assetUrl(club.logoAssetId)!} alt="Logo" className="h-16 w-16 rounded-xl bg-white/5 object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/5 text-zinc-500"><ImagePlus /></div>}
            <label className="btn-ghost btn-sm cursor-pointer">
              Changer le logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const r = await api.upload('logo', file);
                    await patch({ logoAssetId: r.id }, 'Logo enregistré.');
                  } catch (x) {
                    toast(x instanceof ApiError ? x.message : 'Erreur', 'error');
                  }
                }}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nom du club</label>
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Ville</label>
              <input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-32" value={f.description} maxLength={3000} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <p className="mt-1 text-xs text-zinc-500">{f.description.length} / 3000 · min. 20 caractères pour publier</p>
          </div>
          <button className="btn-primary" onClick={() => patch(f, 'Fiche du club enregistrée.')}>
            Enregistrer
          </button>
          <div className="border-t border-white/10 pt-4">
            <Toggle checked={club.published} onChange={(v) => patch({ published: v }, v ? 'Page club publiée.' : 'Page club dépubliée.')} label={club.published ? 'Page publique en ligne' : 'Page publique non publiée'} hint="Présentation du club et formulaire de demande d’adhésion" />
            {club.published && (
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-ghost btn-sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(publicUrl).catch(() => {});
                    toast('Lien copié.');
                  }}
                >
                  <Copy size={14} /> Copier le lien
                </button>
                <a className="btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Voir la page
                </a>
              </div>
            )}
          </div>
        </div>
      </Section>
      <div className="space-y-5">
        <Section
          title="Saisons"
          subtitle="Une seule saison peut être ouverte à la fois."
          right={
            !openSeason && (
              <button className="btn-ghost btn-sm" onClick={() => setNewSeason({ name: '', duesAmount: seasons[0]?.duesAmount ?? 0 })}>
                <Plus size={14} /> Nouvelle saison
              </button>
            )
          }
        >
          <ul className="space-y-2">
            {seasons.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <span className="font-semibold">{s.name}</span>
                <span className={cx('chip text-[10px]', s.open ? 'border-emerald-400/40 text-emerald-300' : '')}>{s.open ? 'Ouverte' : 'Clôturée'}</span>
                <span className="text-xs text-zinc-400">Cotisation {formatMoney(s.duesAmount)}</span>
                <button
                  className="btn-ghost btn-sm ml-auto"
                  onClick={async () => {
                    if (s.open && !(await confirm({ title: `Clôturer ${s.name} ?`, lines: ['Les adhésions restent consultables.', 'Vous pourrez ouvrir une nouvelle saison.'] }))) return;
                    try {
                      await api.patch(`/club/seasons/${s.id}`, { open: !s.open });
                      refresh();
                      toast(s.open ? 'Saison clôturée.' : 'Saison réouverte.');
                    } catch (e) {
                      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
                    }
                  }}
                >
                  {s.open ? 'Clôturer' : 'Réouvrir'}
                </button>
              </li>
            ))}
          </ul>
          {newSeason && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 p-3">
              <div className="flex-1">
                <label className="label">Nom de la saison</label>
                <input className="input" value={newSeason.name} onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })} placeholder="Saison 2027-2028" />
              </div>
              <div>
                <label className="label">Cotisation</label>
                <NumberField className="w-28" value={newSeason.duesAmount} suffix="€" onCommit={(v) => setNewSeason({ ...newSeason, duesAmount: v })} />
              </div>
              <button
                className="btn-primary btn-sm"
                disabled={!newSeason.name.trim()}
                onClick={async () => {
                  try {
                    await api.post('/club/seasons', { name: newSeason.name, duesAmount: newSeason.duesAmount ?? 0 });
                    setNewSeason(null);
                    refresh();
                    toast('Saison créée et ouverte.');
                  } catch (e) {
                    toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
                  }
                }}
              >
                Créer
              </button>
            </div>
          )}
        </Section>
        <RolesEditor club={club} onSave={(roles) => patch({ roles }, 'Rôles mis à jour.')} />
      </div>
    </div>
  );
}

function RolesEditor({ club, onSave }: { club: Club; onSave: (r: ClubRole[]) => void }) {
  const [roles, setRoles] = useState(club.roles);
  const dirty = JSON.stringify(roles) !== JSON.stringify(club.roles);
  return (
    <Section title="Rôles personnalisés" subtitle="Informatifs · plusieurs possibles par adhérent">
      <div className="space-y-2">
        {roles.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2">
            <input type="color" className="h-9 w-10 cursor-pointer rounded-lg border border-white/10 bg-transparent" value={r.color} onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} aria-label="Couleur" />
            <input className="input" value={r.name} maxLength={40} onChange={(e) => setRoles(roles.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button className="rounded-lg p-2 text-zinc-500 hover:text-red-300" onClick={() => setRoles(roles.filter((_, j) => j !== i))} aria-label="Supprimer le rôle">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-ghost btn-sm" onClick={() => setRoles([...roles, { id: crypto.randomUUID(), name: 'Nouveau rôle', color: '#8b95a5' }])}>
          <Plus size={14} /> Ajouter un rôle
        </button>
        <button className="btn-primary btn-sm" disabled={!dirty || roles.some((r) => !r.name.trim())} onClick={() => onSave(roles)}>
          Enregistrer
        </button>
      </div>
    </Section>
  );
}

/** Planche de cartes membres imprimables (format carte bancaire 85,6 × 54 mm). */
export function ClubCardsPage() {
  const [sp] = useSearchParams();
  const ids = (sp.get('ids') ?? '').split(',').filter(Boolean);
  const seasonId = sp.get('season') ?? '';
  const club = useClub();
  const q = useQuery({ queryKey: ['club-members', seasonId], queryFn: () => api.get<{ members: Member[] }>(`/club/members?seasonId=${seasonId}`), enabled: !!seasonId });
  if (club.isLoading || q.isLoading) return <Loading label="Préparation des cartes…" />;
  const c = club.data?.club;
  if (!c) return <Empty title="Club introuvable." />;
  const season = club.data!.seasons.find((s) => s.id === seasonId);
  const list = (q.data?.members ?? []).filter((m) => ids.includes(m.id));
  return (
    <div className="min-h-screen bg-white p-6 text-zinc-900">
      <style>{`@page { size: A4; margin: 10mm; } @media print { body { background: #fff !important; } }`}</style>
      <div className="no-print mb-5 flex items-center gap-3">
        <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => window.print()}>
          <Printer size={15} className="mr-2 inline" /> Imprimer {list.length} carte(s)
        </button>
        <span className="text-sm text-zinc-500">Si le joueur régénère son QR, cette carte ne fonctionnera plus.</span>
      </div>
      <div className="flex flex-wrap gap-[4mm]">
        {list.map((m) => (
          <div key={m.id} className="relative flex overflow-hidden rounded-[3mm] border border-zinc-300" style={{ width: '85.6mm', height: '54mm', breakInside: 'avoid' }}>
            <div className="flex flex-1 flex-col justify-between p-[4mm]">
              <div className="flex items-center gap-[2mm]">
                {c.logoAssetId && <img src={assetUrl(c.logoAssetId)!} alt="" style={{ height: '9mm', width: '9mm', objectFit: 'contain' }} />}
                <div className="leading-tight">
                  <p className="text-[3.2mm] font-extrabold">{c.name}</p>
                  <p className="text-[2.5mm] text-zinc-500">{season?.name ?? ''}</p>
                </div>
              </div>
              <div>
                <p className="text-[2.3mm] uppercase tracking-wider text-zinc-500">Carte membre</p>
                <p className="text-[4.6mm] font-black leading-tight">{m.pseudo}</p>
                <p className="text-[2.8mm] text-zinc-600">{[m.firstName, m.lastName].filter(Boolean).join(' ')}</p>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center bg-zinc-50 px-[3mm]">
              <QrCode value={m.code} size={96} />
              <p className="mt-[1mm] font-mono text-[1.8mm] text-zinc-500">{m.code}</p>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[1.2mm]" style={{ background: '#4ea486' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
