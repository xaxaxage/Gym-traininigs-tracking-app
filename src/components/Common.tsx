import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { goBack, navigate } from '../lib/router';
import { dismissToast, useToast } from '../lib/toast';
import { activeWorkout, useData } from '../lib/store';
import { doneSetCount } from '../lib/workout';
import { stopwatch } from '../lib/dates';
import { ChartIcon, ChevronLeft, ChevronRight, Close, Dumbbell, HistoryIcon, Play } from './Icons';

export type Tab = 'train' | 'history' | 'progress';

/** The main tabs; with a workout in progress, a bar above them leads back to it. */
export function BottomNav({ current }: { current: Tab }) {
  return (
    <>
      <MiniWorkoutBar />
      <nav aria-label="Main" class="bottom-nav">
        <div class="bottom-nav-inner">
          <a href="#/" class="nav-link" aria-current={current === 'train' ? 'page' : undefined}>
            <Dumbbell />
            Train
          </a>
          <a href="#/history" class="nav-link" aria-current={current === 'history' ? 'page' : undefined}>
            <HistoryIcon />
            History
          </a>
          <a href="#/progress" class="nav-link" aria-current={current === 'progress' ? 'page' : undefined}>
            <ChartIcon />
            Progress
          </a>
        </div>
      </nav>
    </>
  );
}

/** Seconds since a time, redrawn every second. */
export function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const wake = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [since]);
  return since === undefined ? 0 : Math.max(0, (now - since) / 1000);
}

function MiniWorkoutBar() {
  const data = useData();
  const active = activeWorkout(data);
  const elapsed = useElapsed(active?.startedAt);
  if (!active) return null;
  return (
    <a href="#/workout" class="mini-bar" aria-label={`Back to the workout: ${active.name}`}>
      <span class="mini-bar-icon" aria-hidden="true">
        <Play size={16} />
      </span>
      <span class="mini-bar-text">
        <strong>{active.name}</strong>
        <span class="num">
          {stopwatch(elapsed)} · {doneSetCount(active)} {doneSetCount(active) === 1 ? 'set' : 'sets'} done
        </span>
      </span>
      <span class="mini-bar-go">Resume</span>
    </a>
  );
}

export function TopBar({
  title,
  back = '/',
  right,
  onBack,
}: {
  title?: ComponentChildren;
  back?: string;
  right?: ComponentChildren;
  onBack?: () => void;
}) {
  return (
    <header class="topbar">
      <button type="button" class="icon-btn ink" aria-label="Back" onClick={() => (onBack ? onBack() : goBack(back))}>
        <ChevronLeft />
      </button>
      {title !== undefined ? <h1>{title}</h1> : <span class="grow" />}
      {right ?? <span class="spacer-44" />}
    </header>
  );
}

export function ToastHost({ low }: { low: boolean }) {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div class={`toast-wrap${low ? ' low' : ''}`} role="status" aria-live="polite">
      <div class={`toast${toast.action ? '' : ' no-action'}`} key={toast.id}>
        <span class="toast-text">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.run();
              dismissToast();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

let sheetIds = 0;

/**
 * A panel that slides up from the bottom (a modal <dialog>: it keeps focus
 * inside, Escape closes it, and it sits above everything else).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [id] = useState(() => `sheet-${++sheetIds}`);
  const closing = useRef(onClose);
  closing.current = onClose;
  // In the same commit as the render: a plain effect waits for the next frame,
  // and until then a closed sheet would still be modal and swallow taps and typing.
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      class={`sheet${wide ? ' wide' : ''}`}
      aria-labelledby={id}
      onClose={() => closing.current()}
      onCancel={(e) => {
        e.preventDefault();
        closing.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) closing.current();
      }}
    >
      {open && (
        <div class="sheet-body">
          <span class="sheet-grabber" aria-hidden="true" />
          <div class="sheet-head">
            <h2 id={id} class="sheet-title">
              {title}
            </h2>
            <button type="button" class="icon-btn plain ink" aria-label="Close" onClick={() => closing.current()}>
              <Close />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Rows of actions that belong together, drawn as one surface with hairlines
 * between them. A menu puts its everyday actions in one group and anything
 * destructive in a group of its own, last.
 */
export function ActionGroup({ children, label }: { children: ComponentChildren; label?: string }) {
  return (
    <div class="menu" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** A row in an action sheet (inside an ActionGroup). */
export function SheetAction({
  icon,
  label,
  hint,
  danger,
  chevron,
  onClick,
}: {
  icon?: ComponentChildren;
  label: string;
  hint?: string;
  danger?: boolean;
  /** For an action that opens another screen. */
  chevron?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" class={`sheet-action${danger ? ' danger' : ''}`} onClick={onClick}>
      {icon && <span class="sheet-action-icon">{icon}</span>}
      <span class="row-main">
        <span class="row-title">{label}</span>
        {hint && <span class="row-sub">{hint}</span>}
      </span>
      {chevron && <ChevronRight size={18} />}
    </button>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div class="loading" role="status">
      <span class="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ComponentChildren; icon?: ComponentChildren }) {
  return (
    <div class="empty">
      {icon && (
        <span class="empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2 class="empty-title">{title}</h2>
      {children}
    </div>
  );
}

export function Switch({
  id,
  checked,
  label,
  hint,
  onChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label class="toggle-row" for={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        class="switch"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint && <span class="muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} class="segmented">
      {options.map((o) => (
        <button type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function goTo(path: string) {
  navigate(path);
}
