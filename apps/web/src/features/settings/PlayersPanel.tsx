import { parsePlayersFile, PLAYER_CSV_TEMPLATE, type Player, type PlayerRow, type TournamentSnapshot } from '@pokerorga/shared';
import {
  ArrowLeftRight,
  Dices,
  ExternalLink,
  FileUp,
  LayoutGrid,
  List,
  Lock,
  LockOpen,
  MoreHorizontal,
  Plus,
  Scale,
  Trash2,
  Trophy,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cx, Empty, Modal, Section, Segmented, useConfirm, useToast } from '../../components/ui';
import { api, ApiError, downloadText } from '../../lib/api';
import { AddPlayerModal, BustFlow, MoveModal } from '../live/PlayerActions';
import { useLiveAction } from '../live/useLive';

export function PlayersPanel({ snap, lateRegOpen }: { snap: TournamentSnapshot; lateRegOpen: boolean }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const confirm = useConfirm();
  const [view, setView] = useState<'list' | 'tables'>('list');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [bust, setBust] = useState(false);
  const [moving, setMoving] = useState<Player | null>(null);
  const [editing, setEditing] = useState<Player | null>(null);
  const [importRows, setImportRows] = useState<PlayerRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const seated = snap.tables.length > 0;
  const active = snap.players.filter((p) => p.status === 'active');
  const unseated = active.filter((p) => p.tableNumber == null).length;

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return snap.players
      .filter((p) => !n || `${p.pseudo} ${p.firstName ?? ''} ${p.lastName ?? ''}`.toLowerCase().includes(n))
      .sort((a, b) => (a.status === b.status ? a.pseudo.localeCompare(b.pseudo, 'fr') : a.status === 'active' ? -1 : 1));
  }, [snap.players, q]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) return toast('Les fichiers Excel (.xlsx) ne sont pas pris en charge. Enregistrez la liste en CSV ou TXT (une ligne par joueur), puis réimportez.', 'error');
    if (!/\.(csv|txt)$/i.test(f.name)) return toast('Seuls les fichiers CSV ou TXT sont acceptés.', 'error');
    const res = parsePlayersFile(await f.text());
    if (res.error && res.rows.length === 0) return toast(res.error, 'error');
    if (res.error) toast(res.error, 'warning');
    setImportRows(res.rows);
    if (fileRef.current) fileRef.current.value = '';
  };

  const draw = async () => {
    if (seated) {
      const ok = await confirm({ title: 'Retirage des sièges', lines: [t.status === 'running' ? 'Le tournoi est en cours. Les placements actuels seront remplacés.' : 'Les placements actuels seront remplacés.', 'Les sièges verrouillés sont conservés.'], confirmLabel: 'Valider' });
      if (!ok) return;
    }
    await run(() => api.post(`/tournaments/${t.id}/seating/draw`), 'Tirage des sièges effectué.');
    setView('tables');
  };

  return (
    <div className="space-y-5">
      <Section
        title="Gestion des joueurs"
        subtitle={`${active.length} actif(s) · ${snap.players.length - active.length} éliminé(s) · ${snap.stats.totalEntries} entrée(s)`}
        right={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-primary btn-sm" onClick={() => setAdding(true)}>
              <UserPlus size={15} /> Ajouter
            </button>
            <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
              <FileUp size={15} /> Importer une liste
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        }
      >
        <p className="mb-4 text-xs text-stone-400">
          Import : CSV ou TXT uniquement (pas de .xlsx). Une ligne par joueur. Prénom et nom facultatifs.{' '}
          <button className="text-gold-400 underline" onClick={() => downloadText('modele-joueurs.csv', PLAYER_CSV_TEMPLATE)}>
            Modèle CSV
          </button>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={draw} disabled={active.length === 0}>
            <Dices size={15} /> {seated ? 'Retirer les sièges (redraw)' : 'Tirage des sièges'}
          </button>
          {seated && (
            <>
              <button className="btn-ghost btn-sm" onClick={() => run(async () => {
                const r = await api.post<{ moves: unknown[] }>(`/tournaments/${t.id}/seating/balance`);
                if (r.moves.length === 0) toast('Les tables sont parfaitement équilibrées !');
                return r;
              })}>
                <Scale size={15} /> Équilibrer
              </button>
              <button className="btn-ghost btn-sm" onClick={() => run(() => api.post(`/tournaments/${t.id}/tables`), 'Table ajoutée.')}>
                <Plus size={15} /> Ajouter une table
              </button>
              <a className="btn-ghost btn-sm" href={`/p/plan/${t.publicToken}`} target="_blank" rel="noreferrer" title="Ouvre le plan des tables dans un nouvel onglet (lien valable jusqu’à la fin ou la réinit du live)">
                <ExternalLink size={15} /> Plan des tables
              </a>
            </>
          )}
          <button className="btn-danger btn-sm" onClick={() => setBust(true)} disabled={active.length === 0}>
            <UserMinus size={15} /> Sortant
          </button>
          <div className="ml-auto">
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: <span className="flex items-center gap-1"><List size={14} /> Liste</span> },
                { value: 'tables', label: <span className="flex items-center gap-1"><LayoutGrid size={14} /> Tables</span> },
              ]}
            />
          </div>
        </div>
        {seated && unseated > 0 && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{unseated} joueur(s) actif(s) sans siège : relancez le tirage ou déplacez-les.</p>}
      </Section>

      {view === 'list' ? (
        <Section title="Joueurs" right={<input className="input w-56" placeholder="Rechercher un joueur..." value={q} onChange={(e) => setQ(e.target.value)} />}>
          {snap.players.length === 0 ? (
            <Empty icon={<UserPlus size={32} />} title="Aucun joueur">
              Ajoutez des joueurs un par un ou importez une liste.
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-stone-400">
                    <th className="py-2 pr-2">Joueur</th>
                    <th className="py-2 pr-2">Place</th>
                    <th className="py-2 pr-2">Entrées</th>
                    {t.settings.entryFormat === 'rebuys' && <th className="py-2 pr-2">Recaves</th>}
                    {t.settings.addonsEnabled && <th className="py-2 pr-2">Add-on</th>}
                    <th className="py-2 pr-2">Kills</th>
                    <th className="py-2 pr-2">Statut</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <PlayerRowView key={p.id} snap={snap} p={p} lateRegOpen={lateRegOpen} onEdit={() => setEditing(p)} onMove={() => setMoving(p)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : (
        <TablesView snap={snap} onMove={setMoving} />
      )}

      {adding && <AddPlayerModal snap={snap} onClose={() => setAdding(false)} lateRegOpen={lateRegOpen} />}
      {bust && <BustFlow snap={snap} open onClose={() => setBust(false)} lateRegOpen={lateRegOpen} />}
      {moving && <MoveModal snap={snap} initial={moving} onClose={() => setMoving(null)} />}
      {editing && <EditPlayer snap={snap} player={editing} onClose={() => setEditing(null)} />}
      {importRows && (
        <Modal
          open
          onClose={() => setImportRows(null)}
          title="Importer ces joueurs ?"
          footer={
            <>
              <button className="btn-ghost" onClick={() => setImportRows(null)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  const r = await run(() => api.post<{ added: string[]; skipped: string[] }>(`/tournaments/${t.id}/players/import`, { rows: importRows }));
                  if (r) toast(`${r.added.length} joueur(s) importé(s)${r.skipped.length ? ` · Ignorés (pseudo déjà inscrit) : ${r.skipped.join(', ')}` : ''}`, r.added.length ? 'success' : 'warning');
                  setImportRows(null);
                }}
              >
                Importer {importRows.length} joueur(s)
              </button>
            </>
          }
        >
          <div className="flex max-h-80 flex-wrap gap-1.5 overflow-y-auto">
            {importRows.map((r) => (
              <span key={r.pseudo} className="chip">
                {r.pseudo}
                {r.firstName || r.lastName ? <span className="text-stone-500"> · {[r.firstName, r.lastName].filter(Boolean).join(' ')}</span> : null}
              </span>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function PlayerRowView({ snap, p, lateRegOpen, onEdit, onMove }: { snap: TournamentSnapshot; p: Player; lateRegOpen: boolean; onEdit: () => void; onMove: () => void }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const confirm = useConfirm();
  const [menu, setMenu] = useState(false);
  const post = (op: string, msg?: string) => run(() => api.post(`/tournaments/${t.id}/players/${p.id}/${op}`), msg);
  const eliminated = p.status === 'eliminated';
  const canReentry = eliminated && t.settings.entryFormat === 'reentry' && lateRegOpen && (t.settings.reentryLimit < 0 || p.entries - 1 < t.settings.reentryLimit);
  const items: { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }[] = [
    { label: 'Modifier', onClick: onEdit },
    { label: 'Déplacer', onClick: onMove, hidden: eliminated || snap.tables.length === 0 },
    { label: p.seatLocked ? 'Déverrouiller le siège' : 'Verrouiller sur ce siège', onClick: () => run(() => api.patch(`/tournaments/${t.id}/players/${p.id}`, { seatLocked: !p.seatLocked })), hidden: eliminated || p.tableNumber == null },
    { label: 'Annuler l’élimination', onClick: () => post('undo-bust', `Élimination de ${p.pseudo} annulée`), hidden: !eliminated },
    { label: 'Re-entry', onClick: () => post('reentry', `Re-entry pour ${p.pseudo}`), hidden: !canReentry },
    { label: 'Recave', onClick: () => post('rebuy', `Recave enregistrée pour ${p.pseudo}`), hidden: t.settings.entryFormat !== 'rebuys' || !lateRegOpen },
    { label: 'Annuler recave', onClick: () => post('undo-rebuy'), hidden: p.rebuys === 0 },
    { label: 'Add-on', onClick: () => post('addon', `Add-on enregistré pour ${p.pseudo}`), hidden: !t.settings.addonsEnabled || eliminated || p.addons > 0 },
    { label: 'Annuler add-on', onClick: () => post('undo-addon'), hidden: p.addons === 0 },
    { label: p.present ? 'Annuler la présence' : 'Pointer la présence', onClick: () => post('present'), hidden: !p.registrationId },
    {
      label: 'Supprimer',
      danger: true,
      onClick: async () => {
        if (await confirm({ title: 'Supprimer ce joueur ?', lines: ['Il sera retiré définitivement du tournoi.'], confirmLabel: 'Supprimer définitivement', danger: true })) {
          await run(() => api.del(`/tournaments/${t.id}/players/${p.id}`), 'Joueur supprimé.');
        }
      },
    },
  ];
  return (
    <tr className={cx('border-t border-white/5', eliminated && 'text-stone-500')}>
      <td className="py-2 pr-2">
        <span className="font-semibold text-stone-100">{p.pseudo}</span>
        {(p.firstName || p.lastName) && <span className="ml-2 text-xs text-stone-500">{[p.firstName, p.lastName].filter(Boolean).join(' ')}</span>}
        {p.registrationId && <span className={cx('ml-2 chip text-[10px]', p.present && 'border-emerald-400/40 text-emerald-300')}>{p.present ? '✓ Présent' : 'Préinscrit'}</span>}
      </td>
      <td className="py-2 pr-2 tabular">
        {p.tableNumber != null ? (
          <span className="flex items-center gap-1">
            T{p.tableNumber} · S{p.seatNumber} {p.seatLocked && <Lock size={12} className="text-gold-400" />}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="py-2 pr-2 tabular">{p.entries}</td>
      {t.settings.entryFormat === 'rebuys' && <td className="py-2 pr-2 tabular">{p.rebuys}</td>}
      {t.settings.addonsEnabled && <td className="py-2 pr-2 tabular">{p.addons ? '✓' : ''}</td>}
      <td className="py-2 pr-2 tabular">{p.kills}</td>
      <td className="py-2 pr-2">
        {eliminated ? (
          <span className="chip">{p.finishRank ? `${p.finishRank}e` : 'Éliminé'}</span>
        ) : p.finishRank === 1 ? (
          <span className="chip border-gold-500/50 text-gold-300">
            <Trophy size={12} /> Vainqueur
          </span>
        ) : (
          <span className="chip border-emerald-400/30 text-emerald-300">En lice</span>
        )}
      </td>
      <td className="relative py-2 text-right">
        <button className="rounded-lg p-1.5 hover:bg-white/10" onClick={() => setMenu(!menu)} aria-label="Actions">
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-white/10 bg-ink-950 py-1 text-left shadow-glass">
              {items
                .filter((i) => !i.hidden)
                .map((i) => (
                  <button
                    key={i.label}
                    className={cx('block w-full px-3 py-2 text-left text-sm hover:bg-white/10', i.danger ? 'text-red-300' : 'text-stone-200')}
                    onClick={() => {
                      setMenu(false);
                      i.onClick();
                    }}
                  >
                    {i.label}
                  </button>
                ))}
            </div>
          </>
        )}
      </td>
    </tr>
  );
}

function TablesView({ snap, onMove }: { snap: TournamentSnapshot; onMove: (p: Player) => void }) {
  const t = snap.tournament;
  const run = useLiveAction(t.id);
  const confirm = useConfirm();
  const max = t.settings.maxPerTable;
  if (snap.tables.length === 0) {
    return (
      <Empty icon={<Dices size={32} />} title="Aucune table">
        Lancez le tirage des sièges pour répartir les joueurs.
      </Empty>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {snap.tables.map((tb) => {
        const players = snap.players.filter((p) => p.status === 'active' && p.tableNumber === tb.number);
        return (
          <div key={tb.id} className={cx('card p-4', tb.isFinal && 'border-gold-500/50')}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="font-bold">
                {tb.isFinal ? 'Table finale' : `Table ${tb.number}`} <span className="text-sm font-normal text-stone-400">· {players.length}/{max}</span>
              </h4>
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm" title={tb.locked ? 'Déverrouiller la table' : 'Verrouiller la table'} onClick={() => run(() => api.patch(`/tournaments/${t.id}/tables/${tb.number}`, { locked: !tb.locked }))}>
                  {tb.locked ? <Lock size={14} className="text-gold-400" /> : <LockOpen size={14} />}
                </button>
                <button className="btn-ghost btn-sm" title={tb.isFinal ? 'Déverrouiller la table finale' : 'Verrouiller comme table finale'} onClick={() => run(() => api.patch(`/tournaments/${t.id}/tables/${tb.number}`, { isFinal: !tb.isFinal }))}>
                  <Trophy size={14} className={tb.isFinal ? 'text-gold-400' : ''} />
                </button>
                {players.length === 0 && (
                  <button
                    className="btn-ghost btn-sm"
                    title="Supprimer la table"
                    onClick={async () => {
                      if (await confirm({ title: `Supprimer la table ${tb.number} ?`, confirmLabel: 'Supprimer', danger: true })) await run(() => api.del(`/tournaments/${t.id}/tables/${tb.number}`));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Array.from({ length: max }, (_, i) => i + 1).map((s) => {
                const p = players.find((x) => x.seatNumber === s);
                return (
                  <button
                    key={s}
                    disabled={!p}
                    onClick={() => p && onMove(p)}
                    className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm', p ? 'border-white/10 bg-white/5 hover:border-gold-500/40' : 'border-dashed border-white/10 text-stone-600')}
                  >
                    <span className="w-6 text-xs font-bold text-stone-400">S{s}</span>
                    <span className="flex-1 truncate font-semibold">{p ? p.pseudo : 'Libre'}</span>
                    {p?.seatLocked && <Lock size={12} className="text-gold-400" />}
                    {p && <ArrowLeftRight size={12} className="text-stone-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditPlayer({ snap, player, onClose }: { snap: TournamentSnapshot; player: Player; onClose: () => void }) {
  const run = useLiveAction(snap.tournament.id);
  const [f, setF] = useState({ pseudo: player.pseudo, firstName: player.firstName ?? '', lastName: player.lastName ?? '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Modifier le joueur"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn-primary"
            onClick={async () => {
              if (!f.pseudo.trim()) return setErr('Le pseudo est obligatoire.');
              try {
                await api.patch(`/tournaments/${snap.tournament.id}/players/${player.id}`, f);
                await run(async () => null, 'Joueur modifié.');
                onClose();
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : "Impossible d'enregistrer.");
              }
            }}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Pseudo</label>
          <input className="input" value={f.pseudo} onChange={(e) => setF({ ...f, pseudo: e.target.value })} data-autofocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Prénom (facultatif)</label>
            <input className="input" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />
          </div>
          <div>
            <label className="label">Nom (facultatif)</label>
            <input className="input" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />
          </div>
        </div>
        {err && <p className="text-sm text-red-300">{err}</p>}
      </div>
    </Modal>
  );
}
