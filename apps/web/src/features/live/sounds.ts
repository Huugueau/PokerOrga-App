import type { ThemeConfig } from '@pokerorga/shared';
import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../../lib/api';

export type SoundKey = 'start' | 'warning60' | 'levelEnd';

export interface DeviceSound {
  enabled: boolean;
  volume: number; // 0..1
  alerts: Record<SoundKey, boolean>;
}

const KEY = 'po:sound';
const DEFAULT: DeviceSound = { enabled: true, volume: 0.8, alerts: { start: true, warning60: true, levelEnd: true } };

export function readDeviceSound(): DeviceSound {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw), alerts: { ...DEFAULT.alerts, ...JSON.parse(raw).alerts } };
  } catch {
    /* stockage indisponible */
  }
  return DEFAULT;
}

export function useDeviceSound() {
  const [s, setS] = useState(readDeviceSound);
  const update = (patch: Partial<DeviceSound>) => {
    const next = { ...s, ...patch, alerts: { ...s.alerts, ...(patch.alerts ?? {}) } };
    setS(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('po:sound'));
  };
  useEffect(() => {
    const h = () => setS(readDeviceSound());
    window.addEventListener('po:sound', h);
    return () => window.removeEventListener('po:sound', h);
  }, []);
  return [s, update] as const;
}

let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), a.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

/** Sons par défaut synthétisés (aucun fichier requis). */
function synth(key: SoundKey, vol: number) {
  if (key === 'warning60') {
    tone(880, 0, 0.18, vol * 0.5);
    tone(880, 0.3, 0.18, vol * 0.5);
  } else if (key === 'levelEnd') {
    [0, 0.25, 0.5].forEach((t) => tone(660, t, 0.18, vol * 0.5, 'square'));
    tone(990, 0.8, 0.7, vol * 0.6);
  } else {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.3, vol * 0.45, 'triangle'));
  }
}

export function playSound(key: SoundKey, theme: ThemeConfig | undefined, device: DeviceSound = readDeviceSound()) {
  const vol = Math.max(0, Math.min(1, device.volume));
  const custom = theme?.sounds?.[key];
  try {
    if (custom) {
      const el = new Audio(assetUrl(custom)!);
      el.volume = vol;
      void el.play().catch(() => synth(key, vol));
    } else synth(key, vol);
  } catch {
    /* audio indisponible */
  }
}

/** Déclenche les alertes sonores selon la progression du timer. */
export function useTimerSounds(opts: { levelIndex: number; remainingMs: number; running: boolean; status: string; theme?: ThemeConfig; enabled: boolean }) {
  const prev = useRef<{ level: number; remaining: number; running: boolean; status: string } | null>(null);
  useEffect(() => {
    const device = readDeviceSound();
    const p = prev.current;
    prev.current = { level: opts.levelIndex, remaining: opts.remainingMs, running: opts.running, status: opts.status };
    if (!p || !opts.enabled || !device.enabled) return;
    if (p.status === 'prepared' && opts.status === 'running' && device.alerts.start) return playSound('start', opts.theme, device);
    if (!opts.running) return;
    if (opts.levelIndex > p.level && p.running && device.alerts.levelEnd) return playSound('levelEnd', opts.theme, device);
    if (opts.levelIndex === p.level && p.remaining > 60000 && opts.remainingMs <= 60000 && opts.remainingMs > 55000 && device.alerts.warning60) {
      playSound('warning60', opts.theme, device);
    }
  }, [opts.levelIndex, opts.remainingMs, opts.running, opts.status, opts.theme, opts.enabled]);
}
