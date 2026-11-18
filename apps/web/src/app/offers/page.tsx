"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, Field, Modal, PageHeader, Spinner, formatMoney, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { InterviewerOption, OfferDetail, OfferListItem, OfferStatus, OnboardingBoardRow, OnboardingCategory, TaskStatus } from "@/lib/types";

type Tab = "offers" | "onboarding";

const STATUS_TONE: Record<OfferStatus, string> = {
  DRAFT: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  PENDING_APPROVAL: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  APPROVED: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  SENT: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200",
  ACCEPTED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  DECLINED: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  WITHDRAWN: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  EXPIRED: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const CATEGORY_LABEL: Record<OnboardingCategory, string> = {
  DOCUMENT: "Documents",
  IT_SETUP: "IT setup",
  HR_ADMIN: "HR admin",
  TRAINING: "Training",
  INTRODUCTION: "Introductions",
  OTHER: "Other",
};

export default function OffersPage() {
  return (
    <AppShell>
      <Offers />
    </AppShell>
  );
}

function Offers() {
  const [tab, setTab] = useState<Tab>("offers");

  return (
    <>
      <PageHeader title="Offers & onboarding" subtitle="Offers from draft to acceptance, and the checklist for people joining" />
      <div className="mb-4 flex gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {([
          ["offers", "Offers"],
          ["onboarding", "Onboarding"],
        ] as [Tab, string][]).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${tab === value ? "border-brand-600 text-brand-600" : "border-transparent hover:text-brand-600"}`}
            style={tab === value ? undefined : { color: "var(--text-muted)" }}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "offers" ? <OfferList /> : <OnboardingBoard />}
    </>
  );
}

function OfferList() {
  const { me } = useSession();
  const [status, setStatus] = useState<OfferStatus | "">("");
  const [mineToApprove, setMineToApprove] = useState(false);
  const [data, setData] = useState<{ items: OfferListItem[]; total: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ pageSize: "50" });
    if (status) params.set("status", status);
    if (mineToApprove) params.set("mineToApprove", "true");
    setError(null);
    return api<{ items: OfferListItem[]; total: number }>(`/offers?${params}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load offers"));
  }, [status, mineToApprove]);

  useEffect(() => {
    void load();
  }, [load]);

  const myPending = data?.items.filter((o) => o.status === "PENDING_APPROVAL" && o.approvals.some((a) => a.approverId === me?.id && a.decision === "PENDING")).length ?? 0;

  return (
    <>
      {myPending > 0 && !mineToApprove && (
        <Alert kind="warning">
          {myPending} offer{myPending === 1 ? "" : "s"} are waiting for your approval.{" "}
          <button className="underline" onClick={() => setMineToApprove(true)}>
            Show them
          </button>
        </Alert>
      )}

      <div className="my-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {(["", "DRAFT", "PENDING_APPROVAL", "SENT", "ACCEPTED", "DECLINED"] as (OfferStatus | "")[]).map((s) => (
            <button
              key={s || "all"}
              className={status === s && !mineToApprove ? "btn-primary py-1.5" : "btn-secondary py-1.5"}
              onClick={() => {
                setStatus(s);
                setMineToApprove(false);
              }}
            >
              {s ? s.replace("_", " ").charAt(0) + s.replace("_", " ").slice(1).toLowerCase() : "All"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mineToApprove} onChange={(e) => { setMineToApprove(e.target.checked); setStatus(""); }} />
          Waiting for my approval
        </label>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && data.items.length === 0 ? (
        <EmptyState title="No offers yet" description="Create an offer from a candidate's pipeline card once they have cleared your final review." />
      ) : (
        data && (
          <div className="grid gap-3 md:grid-cols-2">
            {data.items.map((o) => {
              const approved = o.approvals.filter((a) => a.decision === "APPROVED").length;
              return (
                <article key={o.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link className="font-medium hover:underline" href={`/candidates/${o.candidate.id}`}>
                        {o.candidate.fullName}
                      </Link>
                      <p className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
                        {o.jobTitle}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[o.status]}`}>
                      {o.status.replace("_", " ").toLowerCase()}
                    </span>
                  </div>

                  <dl className="mt-3 space-y-1 text-sm">
                    <Row label="Salary" value={`${formatMoney(o.salaryAmount, o.salaryCurrency)} / ${o.salaryPeriod === "YEARLY" ? "year" : "month"}`} />
                    <Row label="Joining" value={new Date(o.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} />
                    <Row label="Respond by" value={new Date(o.respondBy).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />
                    {o.approvals.length > 0 && <Row label="Approvals" value={`${approved} of ${o.approvals.length}`} />}
                  </dl>

                  {o.status === "DECLINED" && o.declineReason && (
                    <p className="mt-2 text-xs italic" style={{ color: "var(--text-muted)" }}>
                      “{o.declineReason}”
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t pt-2.5" style={{ borderColor: "var(--border)" }}>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {timeAgo(o.createdAt)}
                    </span>
                    <button className="text-sm text-brand-600 hover:underline" onClick={() => setOpen(o.id)}>
                      Open
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )
      )}

      {open && (
        <OfferDetailModal
          id={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            void load();
          }}
        />
      )}
    </>
  );
}

function OfferDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can, me } = useSession();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [interviewers, setInterviewers] = useState<InterviewerOption[]>([]);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [mode, setMode] = useState<"view" | "approvers" | "withdraw">("view");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<OfferDetail>(`/offers/${id}`)
        .then((o) => {
          setOffer(o);
          setApprovers(o.approvals.map((a) => a.approverId));
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load the offer")),
    [id],
  );

  useEffect(() => {
    void load();
    api<InterviewerOption[]>("/interviewers").then(setInterviewers).catch(() => setInterviewers([]));
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
      setMode("view");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  if (!offer) {
    return (
      <Modal open onClose={onClose} title="Offer" wide>
        {error ? <Alert>{error}</Alert> : <Spinner />}
      </Modal>
    );
  }

  const allApproved = offer.approvals.length > 0 && offer.approvals.every((a) => a.decision === "APPROVED");
  const canSend = can("offer:send") && (offer.status === "APPROVED" || (offer.status === "DRAFT" && offer.approvals.length === 0));

  return (
    <Modal open onClose={onClose} title={`${offer.candidate.fullName} — ${offer.jobTitle}`} wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {link && (
          <Alert kind="success">
            Offer sent. If email is not configured, share this link with the candidate:
            <code className="mt-1 block break-all text-xs">{link}</code>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[offer.status]}`}>{offer.status.replace("_", " ").toLowerCase()}</span>
          {offer.status === "SENT" && (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              awaiting the candidate's response
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Fact label="Salary" value={`${formatMoney(offer.salaryAmount, offer.salaryCurrency)} per ${offer.salaryPeriod === "YEARLY" ? "year" : "month"}`} />
          <Fact label="Joining date" value={new Date(offer.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} />
          <Fact label="Respond by" value={new Date(offer.respondBy).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} />
          {offer.reportingTo && <Fact label="Reporting to" value={offer.reportingTo} />}
          {offer.probationMonths != null && <Fact label="Probation" value={`${offer.probationMonths} months`} />}
          {offer.noticePeriodDays != null && <Fact label="Notice period" value={`${offer.noticePeriodDays} days`} />}
        </div>

        {offer.benefits.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-sm font-medium">Benefits</h3>
            <ul className="space-y-1 text-sm">
              {offer.benefits.map((b, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-muted)" }}>{b.label}</span>
                  <span className="font-medium">{b.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {offer.approvals.length > 0 && (
          <section className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
            <h3 className="mb-2 text-sm font-medium">Approvals</h3>
            <ul className="space-y-1.5 text-sm">
              {offer.approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {a.approver.name}
                    {a.approverId === me?.id && <span className="ml-1.5 chip text-xs">you</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {a.decision === "PENDING" ? "waiting" : a.decision.toLowerCase()}
                    {a.comment && <span className="italic">“{a.comment}”</span>}
                  </span>
                </li>
              ))}
            </ul>
            {allApproved && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Everyone has approved — the offer can be sent.</p>}
          </section>
        )}

        <details className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <summary className="cursor-pointer text-sm font-medium">The offer letter</summary>
          <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">{offer.letterBody}</pre>
        </details>

        {/* Actions */}
        {mode === "view" && (
          <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            {offer.myApprovalPending && can("offer:approve") && (
              <>
                <input className="input max-w-xs" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button className="btn-primary" disabled={busy} onClick={() => void act(() => api(`/offers/${id}/decide`, { body: { decision: "APPROVED", comment: comment || undefined } }))}>
                  Approve
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => void act(() => api(`/offers/${id}/decide`, { body: { decision: "REJECTED", comment: comment || undefined } }))}>
                  Reject
                </button>
              </>
            )}

            {can("offer:manage") && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(offer.status) && (
              <button className="btn-secondary" onClick={() => setMode("approvers")}>
                {offer.approvals.length ? "Change approvers" : "Request approval"}
              </button>
            )}

            {canSend && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const r = await api<{ offerLink: string }>(`/offers/${id}/send`, { method: "POST" });
                    setLink(r.offerLink);
                  })
                }
              >
                Send to candidate
              </button>
            )}

            {can("offer:manage") && !["ACCEPTED", "WITHDRAWN", "DECLINED"].includes(offer.status) && (
              <button className="btn-ghost" onClick={() => setMode("withdraw")}>
                Withdraw
              </button>
            )}
          </div>
        )}

        {mode === "approvers" && (
          <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <Field label="Who must approve this offer?" hint="Everyone selected has to approve before it can be sent. Changing the terms later resets their approval.">
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
                {interviewers.map((p) => (
                  <label key={p.id} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-sunken)]">
                    <input
                      type="checkbox"
                      checked={approvers.includes(p.id)}
                      onChange={(e) => setApprovers((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                    />
                    <span className="flex-1">
                      {p.name}
                      <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        {p.role.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" disabled={busy || !approvers.length} onClick={() => void act(() => api(`/offers/${id}/request-approval`, { body: { approverIds: approvers } }))}>
                Request approval
              </button>
              <button className="btn-ghost" onClick={() => setMode("view")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === "withdraw" && (
          <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <Field label="Why are you withdrawing this offer?" hint="Recorded in the audit log. The candidate's link stops working immediately.">
              <textarea className="input min-h-16" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} />
            </Field>
            <div className="mt-3 flex gap-2">
              <button className="btn-danger" disabled={busy || withdrawReason.trim().length < 3} onClick={() => void act(() => api(`/offers/${id}/withdraw`, { body: { reason: withdrawReason } }))}>
                Withdraw offer
              </button>
              <button className="btn-ghost" onClick={() => setMode("view")}>
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function OnboardingBoard() {
  const { can } = useSession();
  const [rows, setRows] = useState<OnboardingBoardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<OnboardingBoardRow[]>("/offers/onboarding")
        .then(setRows)
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load onboarding")),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(taskId: string, status: TaskStatus) {
    await api(`/onboarding-tasks/${taskId}/status`, { body: { status } });
    await load();
  }

  if (error) return <Alert>{error}</Alert>;
  if (!rows) return <Spinner />;
  if (!rows.length) {
    return <EmptyState title="Nobody is onboarding yet" description="Once a candidate accepts an offer, their checklist appears here automatically." />;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const byCategory = row.tasks.reduce<Record<string, OnboardingBoardRow["tasks"]>>((acc, t) => {
          (acc[t.category] ??= []).push(t);
          return acc;
        }, {});
        const pct = row.progress.total ? Math.round((row.progress.done / row.progress.total) * 100) : 0;
        return (
          <section key={row.offerId} className="card p-5">
            <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link className="font-medium hover:underline" href={`/candidates/${row.candidate.id}`}>
                  {row.candidate.fullName}
                </Link>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {row.jobTitle} · joins{" "}
                  {new Date(row.startDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" })}
                  {row.daysUntilStart >= 0 ? ` (in ${row.daysUntilStart} day${row.daysUntilStart === 1 ? "" : "s"})` : " (already started)"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums">
                  {row.progress.done} / {row.progress.total} done
                </p>
                {row.progress.overdue > 0 && <p className="text-xs text-red-600 dark:text-red-400">{row.progress.overdue} overdue</p>}
              </div>
            </header>

            <div className="mb-4 h-2 overflow-hidden rounded-sm" style={{ background: "var(--surface-sunken)" }}>
              <div className="h-full rounded-r-[4px]" style={{ width: `${pct}%`, background: "var(--chart-series-1)" }} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(byCategory).map(([category, tasks]) => (
                <div key={category}>
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    {CATEGORY_LABEL[category as OnboardingCategory]}
                  </h3>
                  <ul className="space-y-1">
                    {tasks.map((t) => {
                      const overdue = t.status !== "DONE" && t.dueDate && new Date(t.dueDate) < new Date();
                      return (
                        <li key={t.id} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={t.status === "DONE"}
                            disabled={!can("onboarding:manage")}
                            onChange={(e) => void setStatus(t.id, e.target.checked ? "DONE" : "TODO")}
                            aria-label={t.title}
                          />
                          <span className="min-w-0 flex-1">
                            <span className={t.status === "DONE" ? "line-through opacity-60" : ""}>{t.title}</span>
                            {t.dueDate && (
                              <span className={`ml-2 text-xs ${overdue ? "text-red-600 dark:text-red-400" : ""}`} style={overdue ? undefined : { color: "var(--text-muted)" }}>
                                due {new Date(t.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </span>
                            )}
                            {t.assignee && (
                              <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                                {t.assignee.name.split(" ")[0]}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
