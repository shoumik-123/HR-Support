"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0">
        <h1 className="text-[1.35rem] font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h1>
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
  const cls = { error: "alert-error", warning: "alert-warning", success: "alert-success", info: "alert-info" }[kind];
  return (
    <div className={`alert ${cls}`} role={kind === "error" ? "alert" : "status"}>
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
  const tone = score >= 80 ? "badge-ok" : score >= 60 ? "badge-brand" : score >= 40 ? "badge-warn" : "badge-bad";
  const dims = { sm: "px-2 py-0.5 text-xs", md: "px-2.5 py-1 text-sm", lg: "px-3 py-1.5 text-base" }[size];
  return <span className={`badge ${tone} rounded-full font-semibold tabular-nums ${dims}`}>{score}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full" style={{ background: "var(--surface-sunken)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--primary)" }} />
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`card animate-pop w-full ${wide ? "max-w-4xl" : "max-w-lg"} my-auto`} style={{ boxShadow: "var(--shadow-float)" }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
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
            <Icon name="close" size={12} />
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
