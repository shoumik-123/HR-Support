"use client";

import { useEffect, useState } from "react";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }} role="status">
      <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ?? "Loading…"}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "success" | "warning"; children: React.ReactNode }) {
  const styles = {
    error: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
    info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  }[kind];
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${styles}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-md text-sm" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Score pill with a consistent colour scale across the app. */
export function ScoreBadge({ score, size = "md" }: { score: number | null | undefined; size?: "sm" | "md" | "lg" }) {
  if (score == null) {
    return <span className="chip" style={{ color: "var(--text-muted)" }}>Not scored</span>;
  }
  const tone =
    score >= 80
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
      : score >= 60
        ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
        : score >= 40
          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
          : "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200";
  const dims = { sm: "px-2 py-0.5 text-xs", md: "px-2.5 py-1 text-sm", lg: "px-3 py-1.5 text-base" }[size];
  return <span className={`inline-flex items-center rounded-full font-semibold tabular-nums ${tone} ${dims}`}>{score}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
        {pct}% confidence
      </span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`card w-full ${wide ? "max-w-4xl" : "max-w-lg"} my-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 hint">{hint}</p> : null}
    </div>
  );
}

/** Comma/Enter-separated tag editor used for skills and tags. */
export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(value.map((v) => v.toLowerCase()));
    onChange([...value, ...parts.filter((p) => !lower.has(p.toLowerCase()))]);
    setDraft("");
  };

  return (
    <div className="input flex flex-wrap items-center gap-1.5 py-1.5">
      {value.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`Remove ${tag}`} className="opacity-60 hover:opacity-100">
            ✕
          </button>
        </span>
      ))}
      <input
        className="min-w-28 flex-1 bg-transparent py-1 text-sm outline-none"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => (e.target.value.includes(",") ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

export function timeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
