import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Modal ----------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
      el?.focus();
    }, 20);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose, dismissable]);
  if (!open) return null;
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('animate-pop flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-white/10 bg-ink-800 shadow-glass sm:rounded-2xl', w)}>
        {title !== undefined && (
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
            <h2 className="text-base font-bold text-zinc-50">{title}</h2>
            {dismissable && (
              <button data-close className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Fermer">
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Confirm ----------
interface ConfirmOpts {
  title: string;
  lines?: string[];
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => close(false)}>
              Annuler
            </button>
            <button data-autofocus className={state?.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>
              {state?.confirmLabel ?? 'Confirmer'}
            </button>
          </>
        }
      >
        {state?.lines?.length ? (
          <ul className="space-y-1.5 text-sm text-zinc-300">
            {state.lines.map((l) => (
              <li key={l} className="flex gap-2">
                <span className="text-accent-500">•</span>
                {l}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-300">Confirmer cette action ?</p>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Toasts ----------
type ToastType = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}
const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 5000 : 3000);
  }, []);
  const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const colors = { success: 'text-emerald-400', error: 'text-red-400', info: 'text-sky-400', warning: 'text-amber-400' };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => {
            const Icon = icons[t.type];
            return (
              <div key={t.id} className="animate-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-white/10 bg-ink-950/95 px-4 py-3 text-sm shadow-glass">
                <Icon size={18} className={colors[t.type]} />
                <span>{t.message}</span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Form controls ----------
export function Toggle({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx('flex items-start justify-between gap-4', disabled ? 'opacity-50' : 'cursor-pointer')}>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-zinc-100">{label}</span>}
          {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-accent-500' : 'bg-white/15')}
      >
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.hint}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-xl border font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
            size === 'sm' ? 'min-w-9 px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
            value === o.value ? 'border-accent-500/70 bg-accent-500/15 text-accent-300' : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Champ numérique qui n'enregistre qu'à la validation (blur/Entrée). */
export function NumberField({
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  suffix,
  disabled,
  className,
  allowEmpty,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  const commit = () => {
    if (draft.trim() === '' && allowEmpty) return onCommit(null);
    let n = Number(draft.replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(n)) return setDraft(value == null ? '' : String(value));
    n = Math.max(min, max != null ? Math.min(max, n) : n);
    if (n !== value) onCommit(n);
    setDraft(String(n));
  };
  return (
    <div className={cx('relative', className)}>
      <input
        className={cx('input tabular', suffix && 'pr-8')}
        inputMode="decimal"
        value={draft}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">{suffix}</span>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} size={20} />;
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-zinc-400">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {icon && <div className="text-zinc-500">{icon}</div>}
      <p className="font-semibold text-zinc-200">{title}</p>
      {children && <div className="text-sm text-zinc-400">{children}</div>}
    </div>
  );
}

export function Section({ title, subtitle, children, right, className }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={cx('card p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-zinc-50">{title}</h3>
          {subtitle && <p className="text-sm text-zinc-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap gap-2">{right}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Rechercher…', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} data-autofocus={autoFocus ? true : undefined} />;
}

export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00' : d) : d;
  return date.toLocaleDateString('fr-FR', withTime ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' });
}
