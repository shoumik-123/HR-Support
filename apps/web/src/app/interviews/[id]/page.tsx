"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ScorecardForm } from "@/components/scorecard-form";
import { InterviewQuestions } from "@/components/interview-questions";
import { PanelFeedback } from "@/components/panel-feedback";
import { Alert, Modal, PageHeader, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { InterviewDetail } from "@/lib/types";

const MODE_LABEL = { VIDEO: "Video call", PHONE: "Phone", ONSITE: "On-site" } as const;

export default function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell>
      <Interview id={id} />
    </AppShell>
  );
}

function Interview({ id }: { id: string }) {
  const { can, me } = useSession();
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const load = useCallback(
    () =>
      api<InterviewDetail>(`/interviews/${id}`)
        .then(setInterview)
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load the interview")),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !interview) return <Alert>{error}</Alert>;
  if (!interview) return <Spinner />;

  const start = new Date(interview.startsAt);
  const minutes = Math.round((new Date(interview.endsAt).getTime() - start.getTime()) / 60000);
  const isPast = new Date(interview.endsAt) < new Date();
  const myCard = interview.scorecards.find((s) => s.interviewerId === me?.id);
  const where = interview.meetingLink ?? interview.location;

  return (
    <>
      <PageHeader
        title={interview.title}
        subtitle={`Round ${interview.round} · ${MODE_LABEL[interview.mode]} · ${minutes} minutes`}
        actions={
          <>
            <Link className="btn-secondary" href={`/candidates/${interview.candidate.id}`}>
              Candidate profile
            </Link>
            {can("interview:schedule") && interview.status === "SCHEDULED" && (
              <>
                <button className="btn-secondary" onClick={() => setRescheduleOpen(true)}>
                  Reschedule
                </button>
                <button className="btn-secondary" onClick={() => setCancelOpen(true)}>
                  Cancel
                </button>
              </>
            )}
            {can("interview:conduct") && isPast && interview.status === "SCHEDULED" && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  await api(`/interviews/${id}/status`, { body: { status: "NO_SHOW" } });
                  void load();
                }}
              >
                Mark no-show
              </button>
            )}
          </>
        }
      />

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {interview.status === "CANCELLED" && <Alert kind="warning">This interview was cancelled. Reason: {interview.cancelReason ?? "not given"}</Alert>}
      {interview.status === "NO_SHOW" && <Alert kind="warning">Recorded as a no-show.</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="mb-2 font-semibold">When and where</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label="Date" value={start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
              <Row label="Time" value={`${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (${interview.timezone})`} />
              <Row label="Format" value={MODE_LABEL[interview.mode]} />
              {where && (
                <Row
                  label={interview.meetingLink ? "Link" : "Address"}
                  value={
                    interview.meetingLink ? (
                      <a className="text-brand-600 hover:underline" href={interview.meetingLink} target="_blank" rel="noreferrer">
                        Join
                      </a>
                    ) : (
                      where
                    )
                  }
                />
              )}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-2 font-semibold">Candidate</h2>
            <Link className="font-medium hover:underline" href={`/candidates/${interview.candidate.id}`}>
              {interview.candidate.fullName}
            </Link>
            {interview.candidate.headline && (
              <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {interview.candidate.headline}
              </p>
            )}
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {interview.candidate.totalExperienceYears != null ? `${interview.candidate.totalExperienceYears} years experience` : "Experience unknown"}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {interview.candidate.skills.slice(0, 8).map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm">
              <Link className="text-brand-600 hover:underline" href={`/jobs/${interview.job.id}`}>
                {interview.job.title}
              </Link>
            </p>
          </section>

          <section className="card p-5">
            <h2 className="mb-2 font-semibold">Panel</h2>
            <ul className="space-y-2 text-sm">
              {interview.participants.map((p) => {
                const card = interview.scorecards.find((s) => s.interviewerId === p.userId);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>
                      {p.user.name}
                      {p.userId === me?.id && <span className="ml-1.5 chip text-xs">you</span>}
                      <span className="ml-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {p.role.toLowerCase()}
                      </span>
                    </span>
                    {p.role !== "OBSERVER" && (
                      <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                        {card?.submittedAt ? "feedback in" : "awaiting"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t pt-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              {interview.panel.submitted} of {interview.panel.submitted + interview.panel.pending} scorecards submitted
            </p>
          </section>

          {interview.agenda && (
            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Agenda</h2>
              <p className="whitespace-pre-wrap text-sm">{interview.agenda}</p>
            </section>
          )}
        </aside>

        <div className="space-y-4 lg:col-span-2">
          <InterviewQuestions interview={interview} onChange={load} />

          {interview.isParticipant && myCard && !myCard.submittedAt && interview.status !== "CANCELLED" && (
            <ScorecardForm
              interviewId={interview.id}
              criteria={interview.criteria}
              scorecard={myCard}
              onSaved={(message) => {
                setNotice(message);
                void load();
              }}
            />
          )}

          {interview.canSeePanelFeedback ? (
            <PanelFeedback interview={interview} />
          ) : (
            <section className="card p-5">
              <h2 className="mb-1 font-semibold">Panel feedback</h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Other interviewers&apos; ratings stay hidden until you submit your own, so your judgement isn&apos;t anchored by theirs.
                {interview.panel.pending > 0 && ` ${interview.panel.submitted} of ${interview.panel.submitted + interview.panel.pending} have reported so far.`}
              </p>
            </section>
          )}
        </div>
      </div>

      <CancelModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        interviewId={id}
        onDone={() => {
          setCancelOpen(false);
          setNotice("Interview cancelled.");
          void load();
        }}
      />
      <RescheduleModal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        interview={interview}
        onDone={() => {
          setRescheduleOpen(false);
          setNotice("Interview rescheduled and everyone notified.");
          void load();
        }}
      />
    </>
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

function CancelModal({ open, onClose, interviewId, onDone }: { open: boolean; onClose: () => void; interviewId: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Cancel this interview">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          The interviewers are always told. The candidate is emailed only if you ask.
        </p>
        <textarea className="input min-h-20" placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the candidate
        </label>
        <div className="flex gap-2">
          <button
            className="btn-danger"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`/interviews/${interviewId}/cancel`, { body: { reason, notifyCandidate: notify } });
                onDone();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not cancel");
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel interview
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Keep it
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RescheduleModal({ open, onClose, interview, onDone }: { open: boolean; onClose: () => void; interview: InterviewDetail; onDone: () => void }) {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [startLocal, setStartLocal] = useState(toLocal(interview.startsAt));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<{ interviewerName?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(allowConflicts: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/interviews/${interview.id}/reschedule`, {
        body: { startsAt: new Date(startLocal).toISOString(), reason: reason || undefined, allowConflicts },
      });
      onDone();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const body = (e as ApiError & { conflicts?: { interviewerName?: string }[] }).conflicts;
        setConflicts(body ?? []);
      } else setError("Could not reschedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Reschedule this interview">
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <label className="label">New date and time (your local time)</label>
        <input className="input" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
        <label className="label">Reason (optional, recorded in the audit log)</label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Candidate asked for a later slot" />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => void submit(false)}>
            Reschedule and notify
          </button>
          {conflicts.length > 0 && (
            <button className="btn-secondary" disabled={busy} onClick={() => void submit(true)}>
              Book anyway
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
