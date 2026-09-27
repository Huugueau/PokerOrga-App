import jsQR from 'jsqr';
import { Camera, CheckCircle2, Keyboard } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, useConfirm } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useLiveAction } from './useLive';

interface CheckinResult {
  kind: 'member' | 'registration';
  pseudo: string;
  state: 'added' | 'present' | 'already' | 'checked' | 'waitlist' | 'needs-override';
  event?: string;
}

const MESSAGES: Record<CheckinResult['state'], string> = {
  added: 'ajouté au tournoi',
  present: 'présence confirmée',
  already: 'présence déjà confirmée',
  checked: 'présence enregistrée (préinscription)',
  waitlist: "est en liste d'attente",
  'needs-override': 'late registration terminée',
};

/** Scan des QR (cartes membres, préinscriptions) avec la caméra, ou saisie du code. */
export function ScanModal({ tournamentId, onClose }: { tournamentId: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const busy = useRef(false);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useLiveAction(tournamentId);
  const confirm = useConfirm();

  const submit = useCallback(
    async (code: string, extra: { add?: boolean; override?: boolean } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      try {
        const r = await api.post<CheckinResult>(`/tournaments/${tournamentId}/checkin`, { code, ...extra });
        if (r.state === 'needs-override') {
          const ok = await confirm({ title: `Ajouter ${r.pseudo} ?`, lines: ["La late registration est terminée. L'ajout nécessite une dérogation explicite."], confirmLabel: 'Ajouter (dérogation)' });
          busy.current = false;
          if (ok) return submit(code, { ...extra, override: true });
          return;
        }
        if (r.state === 'checked' || r.state === 'waitlist') {
          const ok = await confirm({ title: `${r.pseudo} ${MESSAGES[r.state]}`, lines: [`Inscrit à « ${r.event} ».`, 'Ajouter directement le joueur à ce tournoi ?'], confirmLabel: 'Ajouter au tournoi' });
          busy.current = false;
          if (ok) return submit(code, { ...extra, add: true });
          setResult(r);
          return;
        }
        setResult(r);
        await run(async () => null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Erreur lors de la lecture du QR.');
      } finally {
        busy.current = false;
      }
    },
    [tournamentId, confirm, run],
  );

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamError("La caméra n'est pas disponible sur ce navigateur. Utilisez la saisie manuelle.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) {
        const name = (e as { name?: string }).name;
        return setCamError(name === 'NotAllowedError' ? 'Accès caméra refusé. Autorisez la caméra dans les réglages du navigateur, puis réessayez.' : "Impossible d'accéder à la caméra. Utilisez la saisie manuelle.");
      }
      if (stopped || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      const tick = () => {
        const v = video.current;
        const c = canvas.current;
        if (!v || !c || stopped) return;
        if (v.readyState >= 2 && !busy.current) {
          const w = 480;
          const h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(v, 0, 0, w, h);
          const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
          if (found?.data) {
            const now = Date.now();
            if (!lastCode.current || lastCode.current.code !== found.data || now - lastCode.current.at > 4000) {
              lastCode.current = { code: found.data, at: now };
              navigator.vibrate?.(60);
              void submit(found.data);
            }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [submit]);

  return (
    <Modal open onClose={onClose} title="Scanner un QR joueur" size="md">
      <div className="space-y-4">
        {camError ? (
          <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">{camError}</p>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} className="aspect-[4/3] w-full object-cover" playsInline muted />
            <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/60" />
            <p className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1 text-xs text-white/80">
              <Camera size={13} /> Placez le QR du joueur dans le cadre.
            </p>
          </div>
        )}
        <canvas ref={canvas} className="hidden" />
        {result && (
          <div className="animate-pop flex items-center gap-3 rounded-xl border border-accent-500/40 bg-accent-500/10 p-3">
            <CheckCircle2 className="text-accent-400" />
            <div>
              <p className="font-bold">{result.pseudo}</p>
              <p className="text-sm text-zinc-300">
                {result.kind === 'member' ? 'Adhérent' : 'Préinscrit'} · {MESSAGES[result.state]}
              </p>
            </div>
          </div>
        )}
        {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) void submit(manual.trim());
          }}
        >
          <div className="relative flex-1">
            <Keyboard size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="input pl-9 font-mono" placeholder="Ou saisir le code du QR" value={manual} onChange={(e) => setManual(e.target.value)} />
          </div>
          <button className="btn-ghost">Valider</button>
        </form>
      </div>
    </Modal>
  );
}
