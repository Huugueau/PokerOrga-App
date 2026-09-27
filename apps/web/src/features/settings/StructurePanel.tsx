import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  defaultStructure,
  formatDuration,
  generateStructure,
  levelNumberAt,
  makeBreak,
  makeLevel,
  parseStructureCsv,
  resolveClock,
  STRUCTURE_CSV_TEMPLATE,
  uid,
  type GeneratorInput,
  type Level,
  type TournamentSnapshot,
} from '@pokerorga/shared';
import { Coffee, FileUp, GripVertical, Plus, RotateCcw, Save, Sparkles, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx, Modal, NumberField, Section, Toggle, useConfirm, useToast } from '../../components/ui';
import { api, ApiError, downloadText } from '../../lib/api';
import { serverNow } from '../../lib/serverClock';
import { useSave } from './useSave';

interface FavStructure {
  id: string;
  name: string;
  levels: Level[];
}

export function StructurePanel({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const save = useSave(t.id);
  const toast = useToast();
  const confirm = useConfirm();
  const [levels, setLevels] = useState<Level[]>(t.structure);
  const [dirty, setDirty] = useState(false);
  const [gen, setGen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ levels: Level[]; errors: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = resolveClock(t.clock, t.structure, serverNow()).levelIndex;

  useEffect(() => {
    if (!dirty) setLevels(t.structure);
  }, [t.structure, dirty]);

  const update = (next: Level[]) => {
    setLevels(next);
    setDirty(true);
  };
  const patchLevel = (id: string, patch: Partial<Level>) => update(levels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const setLateReg = (id: string, on: boolean) => update(levels.map((l) => ({ ...l, lateRegEnd: l.id === id ? on : false })));
  const addLevel = () => {
    const last = [...levels].reverse().find((l) => l.kind === 'level');
    const bb = last ? Math.round((last.bb * 1.5) / 100) * 100 || last.bb * 2 : 100;
    update([...levels, makeLevel({ sb: bb / 2, bb, ante: last?.ante ? bb : 0, minutes: last?.minutes ?? 20 })]);
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = levels.findIndex((l) => l.id === e.active.id);
    const to = levels.findIndex((l) => l.id === e.over!.id);
    update(arrayMove(levels, from, to));
  };
  const total = levels.reduce((a, l) => a + l.minutes, 0);
  const commit = async () => {
    if (levels.length === 0) return toast('La structure doit contenir au moins un niveau.', 'error');
    if (await save({ structure: levels })) {
      setDirty(false);
      toast('Structure enregistrée.');
    }
  };

  const onCsv = async (f: File | undefined) => {
    if (!f) return;
    setCsvPreview(parseStructureCsv(await f.text()));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-5">
      <Section
        title="Éditeur de structure"
        subtitle={`${levels.filter((l) => l.kind === 'level').length} niveau(x) · ${levels.filter((l) => l.kind === 'break').length} pause(s) · durée totale ${formatDuration(total * 60000)}`}
        right={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost btn-sm" onClick={() => setGen(true)}>
              <Sparkles size={15} /> Générateur
            </button>
            <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={t.status !== 'prepared'} title={t.status !== 'prepared' ? 'Import possible uniquement avant le démarrage du tournoi' : 'CSV : type;sb;bb;ante;duree'}>
              <FileUp size={15} /> Importer CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onCsv(e.target.files?.[0])} />
            <button
              className="btn-ghost btn-sm"
              onClick={async () => {
                if (await confirm({ title: 'Réinitialiser par défaut ?', lines: ['La structure par défaut remplace la structure de l’éditeur.'], confirmLabel: 'Réinitialiser' })) update(defaultStructure());
              }}
            >
              <RotateCcw size={15} />
            </button>
          </div>
        }
      >
        <p className="mb-3 text-xs text-stone-400">
          Glissez les lignes pour réorganiser. « LateReg » : la late registration se termine à la fin de ce niveau.{' '}
          <button className="text-gold-400 underline" onClick={() => downloadText('modele-structure.csv', STRUCTURE_CSV_TEMPLATE)}>
            Modèle CSV
          </button>
        </p>
        <div className="hidden grid-cols-[28px_60px_1fr_1fr_1fr_90px_80px_36px] gap-2 px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-stone-500 md:grid">
          <span />
          <span>Niv.</span>
          <span>SB</span>
          <span>BB</span>
          <span>Ante</span>
          <span>Durée</span>
          <span>LateReg</span>
          <span />
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={levels.map((l) => l.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {levels.map((l, i) => (
                <LevelRow
                  key={l.id}
                  level={l}
                  number={levelNumberAt(levels, i)}
                  current={!dirty && i === current && t.status !== 'prepared'}
                  onPatch={(p) => patchLevel(l.id, p)}
                  onLateReg={(v) => setLateReg(l.id, v)}
                  onDelete={() => update(levels.filter((x) => x.id !== l.id))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-ghost btn-sm" onClick={addLevel}>
            <Plus size={15} /> Ajouter un niveau
          </button>
          <button className="btn-ghost btn-sm" onClick={() => update([...levels, makeBreak(10)])}>
            <Coffee size={15} /> Ajouter une pause
          </button>
          <div className="ml-auto flex gap-2">
            {dirty && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  setLevels(t.structure);
                  setDirty(false);
                }}
              >
                Annuler
              </button>
            )}
            <button className="btn-primary btn-sm" onClick={commit} disabled={!dirty}>
              <Save size={15} /> {dirty ? 'Sauvegarder' : 'Sauvegardé'}
            </button>
          </div>
        </div>
      </Section>

      <FavoriteStructures levels={levels} onLoad={(l) => update(l.map((x) => ({ ...x, id: uid() })))} />

      {gen && (
        <GeneratorModal
          snap={snap}
          onClose={() => setGen(false)}
          onApply={(l) => {
            update(l);
            setGen(false);
            toast('Structure chargée dans l’éditeur. Enregistrez pour l’appliquer au tournoi.', 'info');
          }}
        />
      )}
      {csvPreview && (
        <Modal
          open
          onClose={() => setCsvPreview(null)}
          title="Aperçu de l'import"
          footer={
            <>
              <button className="btn-ghost" onClick={() => setCsvPreview(null)}>
                Fermer
              </button>
              <button
                className="btn-primary"
                disabled={csvPreview.errors.length > 0 || csvPreview.levels.length === 0}
                onClick={() => {
                  update(csvPreview.levels);
                  setCsvPreview(null);
                }}
              >
                Appliquer dans l'éditeur
              </button>
            </>
          }
        >
          {csvPreview.errors.length > 0 ? (
            <ul className="space-y-1 text-sm text-red-300">
              {csvPreview.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mb-2 text-sm text-stone-300">
                {csvPreview.levels.filter((l) => l.kind === 'level').length} niveau(x) · {csvPreview.levels.filter((l) => l.kind === 'break').length} pause(s). Vérifiez la structure puis appliquez-la dans l'éditeur.
              </p>
              <StructureTable levels={csvPreview.levels} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function LevelRow({ level, number, current, onPatch, onLateReg, onDelete }: { level: Level; number: number; current: boolean; onPatch: (p: Partial<Level>) => void; onLateReg: (v: boolean) => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: level.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isBreak = level.kind === 'break';
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(
        'grid grid-cols-[28px_1fr_36px] items-center gap-2 rounded-xl border px-2 py-1.5 md:grid-cols-[28px_60px_1fr_1fr_1fr_90px_80px_36px]',
        isBreak ? 'border-sky-400/20 bg-sky-500/5' : 'border-white/10 bg-white/5',
        current && 'ring-2 ring-gold-500/60',
        isDragging && 'z-10 opacity-80 shadow-glass',
      )}
    >
      <button className="cursor-grab text-stone-500 hover:text-stone-200" {...attributes} {...listeners} aria-label="Glisser pour réorganiser">
        <GripVertical size={16} />
      </button>
      {isBreak ? (
        <div className="flex items-center gap-2 md:col-span-4">
          <Coffee size={15} className="text-sky-300" />
          <span className="font-semibold text-sky-200">Pause</span>
          <span className="md:hidden">
            <NumberField className="w-24" value={level.minutes} min={1} max={600} suffix="min" onCommit={(v) => onPatch({ minutes: v ?? 10 })} />
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 md:contents">
          <span className="self-center font-bold text-stone-300">{number}</span>
          <NumberField value={level.sb} onCommit={(v) => onPatch({ sb: v ?? 0 })} />
          <NumberField value={level.bb} onCommit={(v) => onPatch({ bb: v ?? 0, sb: level.sb === level.bb / 2 ? (v ?? 0) / 2 : level.sb })} />
          <NumberField value={level.ante} onCommit={(v) => onPatch({ ante: v ?? 0 })} />
        </div>
      )}
      <span className="hidden md:block">
        <NumberField value={level.minutes} min={1} max={600} suffix="min" onCommit={(v) => onPatch({ minutes: v ?? 20 })} />
      </span>
      <span className="hidden md:flex md:justify-center">
        <input type="checkbox" className="h-4 w-4 accent-[#c9a449]" checked={level.lateRegEnd} onChange={(e) => onLateReg(e.target.checked)} aria-label="Fin de late registration" />
      </span>
      <button className="rounded-lg p-1.5 text-stone-500 hover:bg-red-500/15 hover:text-red-300" onClick={onDelete} aria-label="Supprimer">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export function StructureTable({ levels }: { levels: Level[] }) {
  return (
    <div className="max-h-[50vh] overflow-y-auto">
      <table className="w-full text-sm tabular">
        <thead>
          <tr className="text-left text-xs uppercase text-stone-400">
            <th className="py-1">Niv.</th>
            <th>SB</th>
            <th>BB</th>
            <th>Ante</th>
            <th>Durée</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l, i) =>
            l.kind === 'break' ? (
              <tr key={l.id} className="border-t border-white/5 text-sky-300">
                <td className="py-1" colSpan={4}>
                  Pause {l.lateRegEnd && <span className="chip ml-2 text-[10px]">Fin late reg</span>}
                </td>
                <td>{l.minutes} min</td>
              </tr>
            ) : (
              <tr key={l.id} className="border-t border-white/5">
                <td className="py-1">{levelNumberAt(levels, i)}</td>
                <td>{l.sb}</td>
                <td>{l.bb}</td>
                <td>{l.ante || ''}</td>
                <td>{l.minutes} min</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function GeneratorModal({ snap, onClose, onApply }: { snap: TournamentSnapshot; onClose: () => void; onApply: (l: Level[]) => void }) {
  const s = snap.tournament.settings;
  const [input, setInput] = useState<GeneratorInput>({
    players: Math.max(snap.stats.totalEntries, 10),
    startStack: s.startStack,
    durationHours: 4,
    levelMinutes: 20,
    smallestChip: 25,
    ante: true,
    breakEvery: 4,
  });
  const res = useMemo(() => generateStructure(input), [input]);
  const set = (p: Partial<GeneratorInput>) => setInput({ ...input, ...p });
  return (
    <Modal
      open
      onClose={onClose}
      title="Générateur de structure"
      size="xl"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary" onClick={() => onApply(res.levels)}>
            Valider
          </button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <Field label="Joueurs (total)">
            <NumberField value={input.players} min={2} max={1000} onCommit={(v) => set({ players: v ?? 10 })} />
          </Field>
          <Field label="Stack départ">
            <NumberField value={input.startStack} min={100} onCommit={(v) => set({ startStack: v ?? 10000 })} />
          </Field>
          <Field label="Durée (heures)">
            <NumberField value={input.durationHours} min={0.5} max={24} step={0.5} onCommit={(v) => set({ durationHours: v ?? 4 })} />
          </Field>
          <Field label="Niveaux (min)">
            <NumberField value={input.levelMinutes} min={1} max={120} onCommit={(v) => set({ levelMinutes: v ?? 20 })} />
          </Field>
          <Field label="Plus petit jeton">
            <select className="input" value={input.smallestChip} onChange={(e) => set({ smallestChip: Number(e.target.value) })}>
              {[1, 5, 10, 25, 50, 100, 500].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pauses tous les (niveaux)">
            <NumberField value={input.breakEvery} min={0} max={20} onCommit={(v) => set({ breakEvery: v ?? 0 })} />
          </Field>
          <Toggle checked={input.ante} onChange={(v) => set({ ante: v })} label="Ante (Big Blind Ante)" />
        </div>
        <div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <SumBox label="Départ" value={`${res.summary.startBB} BB · ${res.summary.startDepth} BB de profondeur`} />
            <SumBox label="Fin estimée (blinde)" value={`${res.summary.endBB}`} />
            <SumBox label="Durée jeu estimée" value={formatDuration(res.summary.estimatedMinutes * 60000)} />
            <SumBox label="Profondeur moyenne finale" value={`${res.summary.finalAverageDepth} BB`} />
          </div>
          <StructureTable levels={res.levels} />
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
function SumBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function FavoriteStructures({ levels, onLoad }: { levels: Level[]; onLoad: (l: Level[]) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['fav-structures'], queryFn: () => api.get<{ items: FavStructure[] }>('/favorites/structures') });
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['fav-structures'] });
  return (
    <Section title="Mes structures favorites" right={<Star size={18} className="text-gold-400" />}>
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Nom de la structure" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button
          className="btn-ghost"
          onClick={async () => {
            try {
              await api.post('/favorites/structures', { name: name.trim() || `Structure #${(q.data?.items.length ?? 0) + 1}`, levels });
              setName('');
              toast('Structure ajoutée aux favoris.');
              refresh();
            } catch (e) {
              toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
            }
          }}
        >
          <Star size={16} /> Ajouter aux favoris
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {q.data?.items.length === 0 && <p className="text-sm text-stone-400">Aucune structure sauvegardée pour le moment.</p>}
        {q.data?.items.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
            <button
              className="font-semibold hover:underline"
              title="Cliquer pour modifier le nom"
              onClick={async () => {
                const n = prompt('Nom de la structure', f.name);
                if (n?.trim()) {
                  await api.patch(`/favorites/structures/${f.id}`, { name: n.trim() });
                  refresh();
                }
              }}
            >
              {f.name}
            </button>
            <span className="flex-1 text-xs text-stone-400">
              {f.levels.filter((l) => l.kind === 'level').length} niveaux · {formatDuration(f.levels.reduce((a, l) => a + l.minutes, 0) * 60000)}
            </span>
            <button className="btn-ghost btn-sm" onClick={() => onLoad(f.levels)}>
              Charger
            </button>
            <button
              className="rounded-lg p-1.5 text-stone-400 hover:text-red-300"
              onClick={async () => {
                if (await confirm({ title: `Supprimer « ${f.name} » ?`, confirmLabel: 'Supprimer', danger: true })) {
                  await api.del(`/favorites/structures/${f.id}`);
                  refresh();
                }
              }}
              aria-label="Supprimer"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}
