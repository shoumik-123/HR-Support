"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, EmptyState, Modal, PageHeader, ScoreBadge, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AssessmentDetail, AssessmentListItem, AssessmentStatus } from "@/lib/types";

const STATUS_TONE: Record<AssessmentStatus, string> = {
  INVITED: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  IN_PROGRESS: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200",
  SUBMITTED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  EVALUATED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  EXPIRED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  CANCELLED: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export default function AssessmentsPage() {
  return (
    <AppShell>
      <Assessments />
    </AppShell>
  );
}

function Assessments() {
  const { can } = useSession();
  const [status, setStatus] = useState<AssessmentStatus | "">("");
  const [awaiting, setAwaiting] = useState(false);
  const [data, setData] = useState<{ items: AssessmentListItem[]; total: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ pageSize: "50" });
    if (status) params.set("status", status);
    if (awaiting) params.set("awaitingMarking", "true");
    setError(null);
    return api<{ items: AssessmentListItem[]; total: number }>(`/assessments?${params}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load assessments"));
  }, [status, awaiting]);

  useEffect(() => {
    void load();
  }, [load]);

  const needsMarking = data?.items.filter((a) => a.status === "SUBMITTED").length ?? 0;

  return (
    <>
      <PageHeader
        title="Assessments"
        subtitle="Tests sent to candidates, and the papers waiting to be marked"
        actions={
          can("assessment:view") && (
            <Link className="btn-secondary" href="/assessment-setup">
              Papers & questions
            </Link>
          )
        }
      />

      {needsMarking > 0 && !awaiting && (
        <Alert kind="warning">
          {needsMarking} paper{needsMarking === 1 ? "" : "s"} contain written answers waiting for a human to mark.{" "}
          <button className="underline" onClick={() => setAwaiting(true)}>
            Show them
          </button>
        </Alert>
      )}

      <div className="my-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {(["", "INVITED", "IN_PROGRESS", "SUBMITTED", "EVALUATED", "EXPIRED"] as (AssessmentStatus | "")[]).map((s) => (
            <button
              key={s || "all"}
              className={status === s && !awaiting ? "btn-primary py-1.5" : "btn-secondary py-1.5"}
              onClick={() => {
                setStatus(s);
                setAwaiting(false);
              }}
            >
              {s ? s.replace("_", " ").charAt(0) + s.replace("_", " ").slice(1).toLowerCase() : "All"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={awaiting} onChange={(e) => { setAwaiting(e.target.checked); setStatus(""); }} />
          Only awaiting marking
        </label>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}

      {data && data.items.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Send an assessment from a candidate's pipeline card once you have a paper set up."
          action={
            can("assessment:manage") && (
              <Link className="btn-primary" href="/assessment-setup">
                Set up a paper
              </Link>
            )
          }
        />
      ) : (
        data && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--border)", background: "var(--surface-sunken)" }}>
                  <th className="px-4 py-2 font-medium">Candidate</th>
                  <th className="px-4 py-2 font-medium">Assessment</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Score</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-2.5">
                      <Link className="font-medium hover:underline" href={`/candidates/${a.candidate.id}`}>
                        {a.candidate.fullName}
                      </Link>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {a.job.title}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {a.title}
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {a.durationMinutes} min · {a.totalPoints} marks
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[a.status]}`}>
                        {a.status.replace("_", " ").toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {timeAgo(a.invitedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {a.percent != null ? (
                        <span className="inline-flex items-center gap-2">
                          <ScoreBadge score={Math.round(a.percent)} size="sm" />
                          {a.passed != null && (
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {a.passed ? "met the bar" : "below the bar"}
                            </span>
                          )}
                        </span>
                      ) : a.status === "SUBMITTED" ? (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          awaiting marking
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-sm text-brand-600 hover:underline" onClick={() => setOpen(a.id)}>
                        {a.status === "SUBMITTED" ? "Mark" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {open && (
        <AssessmentDetailModal
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

function AssessmentDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const [paper, setPaper] = useState<AssessmentDetail | null>(null);
  const [marks, setMarks] = useState<Record<string, { points: number; comment: string }>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<AssessmentDetail>(`/assessments/${id}`)
        .then((p) => {
          setPaper(p);
          setNote(p.evaluatorNote ?? "");
          setMarks(
            Object.fromEntries(
              p.answers
                .filter((a) => a.pointsAwarded != null && !["MCQ_SINGLE", "MCQ_MULTI", "NUMERIC"].includes(a.questionType))
                .map((a) => [a.id, { points: a.pointsAwarded!, comment: a.evaluatorComment ?? "" }]),
            ),
          );
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load the paper")),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function submitMarks() {
    if (!paper) return;
    setBusy(true);
    setError(null);
    try {
      const payload = Object.entries(marks).map(([answerId, m]) => ({ answerId, points: m.points, comment: m.comment || undefined }));
      if (!payload.length) {
        setError("Give a mark for at least one written answer.");
        return;
      }
      await api(`/assessments/${id}/mark`, { body: { marks: payload, note: note || undefined } });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your marks");
    } finally {
      setBusy(false);
    }
  }

  const written = paper?.answers.filter((a) => !["MCQ_SINGLE", "MCQ_MULTI", "NUMERIC"].includes(a.questionType)) ?? [];
  const canMark = can("assessment:evaluate") && paper && (paper.status === "SUBMITTED" || paper.status === "EVALUATED");

  return (
    <Modal open onClose={onClose} title={paper ? `${paper.candidate.fullName} — ${paper.title}` : "Assessment"} wide>
      {!paper ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Automatic marks" value={`${paper.score.autoScore}`} />
            <Stat label="Marked by hand" value={`${paper.score.manualScore}`} />
            <Stat label="Total available" value={`${paper.score.totalPoints}`} />
            <Stat label="Result" value={paper.score.percent != null ? `${paper.score.percent}%` : "pending"} />
          </div>

          {paper.score.awaitingManual > 0 && (
            <Alert kind="warning">
              {paper.score.awaitingManual} written answer{paper.score.awaitingManual === 1 ? "" : "s"} still need marking. No percentage is published until they are done.
            </Alert>
          )}
          {paper.status === "INVITED" && <Alert kind="info">The candidate has not started this assessment yet.</Alert>}
          {paper.status === "EXPIRED" && <Alert kind="warning">This assessment expired before it was completed.</Alert>}

          <ol className="space-y-3">
            {paper.answers.map((a, i) => {
              const isClosed = ["MCQ_SINGLE", "MCQ_MULTI", "NUMERIC"].includes(a.questionType);
              return (
                <li key={a.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">
                      {i + 1}. {a.questionText}
                    </p>
                    <span className="chip shrink-0 text-xs">{a.maxPoints} marks</span>
                  </div>

                  <div className="mt-2 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                      Candidate's answer
                    </p>
                    {a.response.length === 0 ? (
                      <p className="italic" style={{ color: "var(--text-muted)" }}>
                        Not answered
                      </p>
                    ) : isClosed && a.options.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {a.options.map((o, idx) => {
                          const chosen = a.response.includes(String(idx));
                          const correct = a.question?.correctAnswers.includes(String(idx));
                          return (
                            <li key={idx} className={chosen ? "font-medium" : ""} style={{ color: chosen ? undefined : "var(--text-muted)" }}>
                              {chosen ? "▸ " : "  "}
                              {o}
                              {correct && <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">(correct)</span>}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap rounded p-2" style={{ background: "var(--surface-sunken)" }}>
                        {a.response.join(", ")}
                      </p>
                    )}
                  </div>

                  {isClosed ? (
                    <p className="mt-2 text-sm">
                      <span className="font-medium">{a.pointsAwarded ?? 0}</span> / {a.maxPoints} ·{" "}
                      <span style={{ color: "var(--text-muted)" }}>{a.autoCorrect ? "marked correct automatically" : "marked incorrect automatically"}</span>
                    </p>
                  ) : canMark ? (
                    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                      <label className="label">Your mark (0–{a.maxPoints})</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className="input w-24"
                          type="number"
                          min={0}
                          max={a.maxPoints}
                          value={marks[a.id]?.points ?? ""}
                          onChange={(e) =>
                            setMarks((prev) => ({ ...prev, [a.id]: { points: Number(e.target.value), comment: prev[a.id]?.comment ?? "" } }))
                          }
                        />
                        <input
                          className="input flex-1"
                          placeholder="Comment for the hiring record (optional)"
                          value={marks[a.id]?.comment ?? ""}
                          onChange={(e) =>
                            setMarks((prev) => ({ ...prev, [a.id]: { points: prev[a.id]?.points ?? 0, comment: e.target.value } }))
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm">
                      {a.pointsAwarded != null ? (
                        <>
                          <span className="font-medium">{a.pointsAwarded}</span> / {a.maxPoints}
                          {a.evaluatorComment && <span style={{ color: "var(--text-muted)" }}> — {a.evaluatorComment}</span>}
                        </>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Awaiting marking</span>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>

          {canMark && written.length > 0 && (
            <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
              <label className="label">Overall note (optional)</label>
              <textarea className="input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary mt-3" disabled={busy} onClick={() => void submitMarks()}>
                {busy ? "Saving…" : "Save marks"}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
