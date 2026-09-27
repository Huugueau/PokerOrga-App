import { DEFAULT_THEME, TIMER_FONTS, type ThemeConfig, type TournamentSnapshot } from '@pokerorga/shared';
import { ImagePlus, Music, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx, Section, Segmented, Toggle, useConfirm, useToast } from '../../components/ui';
import { api, ApiError, assetUrl } from '../../lib/api';
import { playSound, useDeviceSound, type SoundKey } from '../live/sounds';
import { Logo, themeStyle } from '../live/TimerPage';
import { useSave } from './useSave';

export function ThemePanel({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const theme = t.theme;
  const save = useSave(t.id);
  const confirm = useConfirm();
  const setTheme = (patch: Partial<ThemeConfig>) => save({ theme: patch });
  const isDefault = JSON.stringify({ ...theme, sounds: null }) === JSON.stringify({ ...DEFAULT_THEME, sounds: null });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Section title="Couleurs & verre" subtitle="Teinte des blocs, accents et titre">
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField label="Couleur principale" hint="Fond des blocs du timer" value={theme.primary} onChange={(v) => setTheme({ primary: v })} />
            <ColorField label="Couleur secondaire" hint="Liserés, badges et barre de progression" value={theme.secondary} onChange={(v) => setTheme({ secondary: v })} />
            <ColorField label="Couleur du titre" hint="Textes principaux du timer" value={theme.title} onChange={(v) => setTheme({ title: v })} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <RangeField label="Opacité" value={theme.glassOpacity} min={0} max={1} step={0.05} display={(v) => `${Math.round(v * 100)} %`} onCommit={(v) => setTheme({ glassOpacity: v })} />
            <RangeField label="Flou" value={theme.glassBlur} min={0} max={40} step={1} display={(v) => `${v} px`} onCommit={(v) => setTheme({ glassBlur: v })} />
          </div>
        </Section>

        <Section title="Typographie & médias" subtitle="Police du timer, image de fond et logo">
          <label className="label">Police du timer</label>
          <Segmented size="sm" value={theme.font} onChange={(v) => setTheme({ font: v })} options={TIMER_FONTS.map((f) => ({ value: f, label: <span style={{ fontFamily: f }}>{f}</span> }))} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <AssetDrop label="Image de fond" kind="background" value={theme.backgroundAssetId} onChange={(id) => setTheme({ backgroundAssetId: id })} />
            <AssetDrop label="Logo" kind="logo" value={theme.logoAssetId} onChange={(id) => setTheme({ logoAssetId: id })} />
          </div>
        </Section>

        <SoundsSection snap={snap} />
      </div>

      <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <Section title="Aperçu en direct" subtitle="Le timer tel qu'il s'affichera à l'écran">
          <div className="timer-root overflow-hidden rounded-xl bg-felt p-3" style={themeStyle(theme)}>
            <div className="mb-2 flex items-center justify-between">
              <Logo theme={theme} className="h-7 max-w-[110px] text-xs" />
              <span className="title-color text-sm font-black uppercase">{t.title}</span>
            </div>
            <div className="glass rounded-xl p-3 text-center">
              <p className="text-[9px] font-bold uppercase tracking-widest text-stone-300">Temps restant</p>
              <p className="title-color text-4xl font-black tabular">18:42</p>
              <div className="mx-auto mt-2 h-1.5 w-4/5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-2/5" style={{ background: 'var(--c-secondary)' }} />
              </div>
            </div>
            <div className="glass mt-2 rounded-xl p-2 text-center">
              <p className="title-color text-xl font-black">200 / 400</p>
              <p className="accent text-xs font-bold">Ante : 400</p>
            </div>
          </div>
        </Section>
        <button
          className="btn-ghost w-full"
          disabled={isDefault}
          onClick={async () => {
            const ok = await confirm({ title: 'Réinitialiser le thème ?', lines: ['Couleurs, effet verre et police par défaut', 'Image de fond et logo supprimés', 'Les sons ne sont pas modifiés'], confirmLabel: 'Réinitialiser' });
            if (ok) setTheme({ ...DEFAULT_THEME, sounds: theme.sounds });
          }}
        >
          <RotateCcw size={16} /> {isDefault ? 'Le thème est déjà celui par défaut' : 'Réinitialiser le thème'}
        </button>
      </div>
    </div>
  );
}

function ColorField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          className="h-10 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== value && onChange(v)}
          aria-label={label}
        />
        <input className="input font-mono uppercase" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => /^#[0-9a-f]{6}$/i.test(v) && v !== value && onChange(v)} />
      </div>
      <p className="mt-1 text-xs text-stone-500">{hint}</p>
    </div>
  );
}

function RangeField({ label, value, min, max, step, display, onCommit }: { label: string; value: number; min: number; max: number; step: number; display: (v: number) => string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <label className="label flex justify-between">
        <span>{label}</span>
        <span className="text-stone-300">{display(v)}</span>
      </label>
      <input type="range" className="w-full accent-[#c9a449]" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)} />
    </div>
  );
}

function AssetDrop({ label, kind, value, onChange }: { label: string; kind: 'logo' | 'background'; value: string | null; onChange: (id: string | null) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Format non pris en charge : choisissez une image.', 'error');
    if (file.size > 2 * 1024 * 1024) return toast('Image trop volumineuse (> 2 Mo).', 'error');
    setBusy(true);
    try {
      const r = await api.upload(kind, file);
      onChange(r.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Échec de l'import de l'image.", 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label className="label">{label}</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        className={cx('flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm', over ? 'border-gold-400 bg-gold-500/10' : 'border-white/15 bg-white/5 hover:bg-white/10')}
      >
        {value ? (
          <img src={assetUrl(value)!} alt="" className={cx('max-h-24 max-w-full rounded', kind === 'background' && 'w-full object-cover')} />
        ) : (
          <>
            <ImagePlus className="text-stone-400" />
            <span className="text-stone-400">{busy ? 'Import en cours…' : 'Importer une image (ou glisser-déposer)'}</span>
            <span className="text-xs text-stone-500">PNG, JPG, SVG ou WebP · 2 Mo max</span>
          </>
        )}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      {value && (
        <button className="mt-2 text-xs text-stone-400 hover:text-red-300" onClick={() => onChange(null)}>
          {kind === 'logo' ? 'Revenir au logo par défaut' : 'Revenir au fond par défaut'}
        </button>
      )}
    </div>
  );
}

const SOUND_ROWS: { key: SoundKey; label: string; hint: string }[] = [
  { key: 'start', label: 'Shuffle up and deal', hint: 'Au lancement du tournoi' },
  { key: 'warning60', label: 'Alerte 1 min', hint: 'Une minute avant la fin du niveau' },
  { key: 'levelEnd', label: 'Fin de niveau', hint: 'Au changement de niveau' },
];

function SoundsSection({ snap }: { snap: TournamentSnapshot }) {
  const t = snap.tournament;
  const save = useSave(t.id);
  const toast = useToast();
  const [device, setDevice] = useDeviceSound();
  const upload = async (key: SoundKey, file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('Fichier trop volumineux (> 2 Mo)', 'error');
    try {
      const r = await api.upload('sound', file);
      await save({ theme: { sounds: { ...t.theme.sounds, [key]: r.id } } });
      toast('Fichier importé');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Fichier invalide', 'error');
    }
  };
  return (
    <Section title="Sons du timer" subtitle="Activation et volume sont propres à cet appareil. Les fichiers importés suivent le tournoi.">
      <div className="space-y-4">
        <Toggle checked={device.enabled} onChange={(v) => setDevice({ enabled: v })} label="Activer les sons" hint="Écoute : sur cet appareil" />
        <div>
          <label className="label flex justify-between">
            <span>Volume</span>
            <span>{Math.round(device.volume * 100)} %</span>
          </label>
          <input type="range" className="w-full accent-[#c9a449]" min={0} max={1} step={0.05} value={device.volume} onChange={(e) => setDevice({ volume: Number(e.target.value) })} />
        </div>
        <div className="divide-y divide-white/5 rounded-xl bg-white/5">
          {SOUND_ROWS.map((r) => {
            const custom = t.theme.sounds[r.key];
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-40 flex-1">
                  <Toggle checked={device.alerts[r.key]} onChange={(v) => setDevice({ alerts: { ...device.alerts, [r.key]: v } })} label={r.label} hint={r.hint} />
                </div>
                <span className="chip">{custom ? 'Perso' : 'Défaut'}</span>
                <button className="btn-ghost btn-sm" onClick={() => playSound(r.key, t.theme, { ...device, enabled: true })} title="Écouter le son">
                  <Play size={14} /> Tester
                </button>
                <label className="btn-ghost btn-sm cursor-pointer" title="Importer un fichier (MP3, WAV ou M4A · 2 Mo max)">
                  <Music size={14} /> Importer
                  <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a" className="hidden" onChange={(e) => upload(r.key, e.target.files?.[0])} />
                </label>
                {custom && (
                  <button className="rounded-lg p-1.5 text-stone-400 hover:text-red-300" title="Revenir au son par défaut" onClick={() => save({ theme: { sounds: { ...t.theme.sounds, [r.key]: null } } })}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
