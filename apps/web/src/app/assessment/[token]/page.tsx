"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Alert, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { CandidateAssessment } from "@/lib/types";

/**
 * The candidate's own assessment page. No account and no sign-in: the link itself is the
 * credential, so this page lives outside the authenticated app shell and never calls an
 * endpoint that needs a session.
 */
export default function CandidateAssessmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <Assessment token={token} />;
}

function Assessment({ token }: { token: string }) {
  const [data, setData] = useState<CandidateAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CandidateAssessment>(`/public/assessment/${token}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "This link could not be opened."));
  }, [token]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setData(await api<CandidateAssessment>(`/public/assessment/${token}/start`, { method: "POST" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the assessment.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <Shell>
        <Alert>{error}</Alert>
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          If you believe this is a mistake, reply to the email you received and ask for a new link.
        </p>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <Spinner label="Opening your assessment…" />
      </Shell>
    );
  }

  if (data.state === "expired") {
    return (
      <Shell org={data.organizationName} title={data.title} subtitle={data.jobTitle}>
        <Alert kind="warning">
          The time available for this assessment has passed, so it can no longer be opened.
        </Alert>
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          Reply to the email you received if you would like to ask for another chance to complete it.
        </p>
      </Shell>
    );
  }

  if (data.state === "submitted") {
    return (
      <Shell org={data.organizationName} title={data.title} subtitle={data.jobTitle}>
        <Alert kind="success">Your answers have been submitted. Thank you for taking the time.</Alert>
        {data.result ? (
          <div className="card mt-4 p-5 text-center">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Your score
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{data.result.percent}%</p>
            {data.result.passed != null && (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {data.result.passed ? "You met the required standard." : "You did not reach the required standard this time."}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
            The hiring team will review your answers and be in touch about next steps.
          </p>
        )}
      </Shell>
    );
  }

  if (data.state === "not_started") {
    return (
      <Shell org={data.organizationName} title={data.title} subtitle={data.jobTitle}>
        <div className="card p-5">
          <p className="text-sm">
            Hello {data.candidateName.split(" ")[0]}, this assessment is part of your application for{" "}
            <strong>{data.jobTitle}</strong>.
          </p>

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <Fact label="Questions" value={String(data.questionCount)} />
            <Fact label="Time limit" value={`${data.durationMinutes} minutes`} />
            <Fact label="Total marks" value={String(data.totalPoints)} />
          </dl>

          <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: "var(--surface-sunken)" }}>
            <p className="mb-1.5 font-medium">Before you begin</p>
            <ul className="list-inside list-disc space-y-1" style={{ color: "var(--text-muted)" }}>
              <li>The timer starts when you press Begin and does not pause.</li>
              <li>Your answers save as you go, so a dropped connection will not lose your work.</li>
              <li>You can only submit once.</li>
              <li>Find a quiet moment — you need about {data.durationMinutes} minutes without interruption.</li>
            </ul>
          </div>

          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            This link stops working after {new Date(data.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.
          </p>

          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}

          <button className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void start()}>
            {busy ? "Starting…" : "Begin assessment"}
          </button>
        </div>
      </Shell>
    );
  }

  return <Paper token={token} initial={data} onFinished={setData} />;
}

function Paper({
  token,
  initial,
  onFinished,
}: {
  token: string;
  initial: Extract<CandidateAssessment, { state: "in_progress" }>;
  onFinished: (next: CandidateAssessment) => void;
}) {
  const [responses, setResponses] = useState<Record<string, string[]>>(
    () => Object.fromEntries(initial.questions.map((q) => [q.questionId, q.response])),
  );
  const [remaining, setRemaining] = useState(initial.remainingSeconds);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(false);
  const submittedRef = useRef(false);

  const answeredCount = initial.questions.filter((q) => (responses[q.questionId] ?? []).some((r) => r.trim() !== "")).length;

  const submit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const result = await api<{ state: "submitted"; result: { percent: number; passed: boolean | null } | null }>(
          `/public/assessment/${token}/submit`,
          { body: { answers: Object.entries(responses).map(([questionId, response]) => ({ questionId, response })) } },
        );
        onFinished({
          state: "submitted",
          title: initial.title,
          organizationName: initial.organizationName,
          jobTitle: initial.jobTitle,
          submittedAt: new Date().toISOString(),
          result: result.result,
        });
      } catch (e) {
        submittedRef.current = false;
        setError(auto ? "Your time ran out and the answers could not be sent. Please check your connection." : e instanceof ApiError ? e.message : "Could not submit your answers.");
      } finally {
        setSubmitting(false);
      }
    },
    [token, responses, initial, onFinished],
  );

  // The countdown. When it reaches zero the paper submits itself, so work is not lost.
  useEffect(() => {
    if (remaining <= 0) {
      void submit(true);
      return;
    }
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining, submit]);

  // Autosave a few seconds after the candidate stops typing.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        await api(`/public/assessment/${token}/answers`, {
          method: "PUT",
          body: { answers: Object.entries(responses).map(([questionId, response]) => ({ questionId, response })) },
        });
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [responses, token]);

  // Warn before a reload that would lose unsaved typing.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const setResponse = (questionId: string, response: string[]) => {
    dirty.current = true;
    setSaveState("idle");
    setResponses((prev) => ({ ...prev, [questionId]: response }));
  };

  const low = remaining <= 120;

  return (
    <Shell org={initial.organizationName} title={initial.title} subtitle={initial.jobTitle}>
      <div
        className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
        style={{ background: "var(--surface-raised)", border: "1px solid var(--border)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {answeredCount} of {initial.questions.length} answered
          {saveState === "saving" && " · saving…"}
          {saveState === "saved" && " · saved"}
          {saveState === "error" && " · could not save"}
        </p>
        <p
          className={`text-lg font-semibold tabular-nums ${low ? "text-red-600 dark:text-red-400" : ""}`}
          role="timer"
          aria-live={low ? "assertive" : "off"}
        >
          {formatClock(remaining)}
        </p>
      </div>

      {low && remaining > 0 && <Alert kind="warning">Less than two minutes left. Your answers will be submitted automatically when the time is up.</Alert>}
      {saveState === "error" && <Alert kind="warning">Your last answers could not be saved. Check your connection — they will be sent again shortly.</Alert>}
      {error && <Alert>{error}</Alert>}

      <ol className="space-y-4">
        {initial.questions.map((q, i) => (
          <li key={q.questionId} className="card p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="font-medium">
                {i + 1}. {q.text}
              </p>
              <span className="chip shrink-0 text-xs">
                {q.maxPoints} {q.maxPoints === 1 ? "mark" : "marks"}
              </span>
            </div>

            {(q.type === "MCQ_SINGLE" || q.type === "MCQ_MULTI") && (
              <>
                {q.type === "MCQ_MULTI" && (
                  <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    Select every answer that applies.
                  </p>
                )}
                <div className="space-y-1.5">
                  {q.options.map((option, index) => {
                    const value = String(index);
                    const chosen = (responses[q.questionId] ?? []).includes(value);
                    return (
                      <label
                        key={index}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition-colors"
                        style={{ borderColor: chosen ? "var(--chart-series-1)" : "var(--border)", background: chosen ? "var(--surface-sunken)" : undefined }}
                      >
                        <input
                          type={q.type === "MCQ_SINGLE" ? "radio" : "checkbox"}
                          name={q.questionId}
                          className="mt-0.5"
                          checked={chosen}
                          onChange={(e) => {
                            if (q.type === "MCQ_SINGLE") setResponse(q.questionId, [value]);
                            else {
                              const current = responses[q.questionId] ?? [];
                              setResponse(q.questionId, e.target.checked ? [...current, value] : current.filter((v) => v !== value));
                            }
                          }}
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {q.type === "NUMERIC" && (
              <input
                className="input max-w-xs"
                type="number"
                step="any"
                inputMode="decimal"
                value={responses[q.questionId]?.[0] ?? ""}
                onChange={(e) => setResponse(q.questionId, [e.target.value])}
                placeholder="Your answer"
              />
            )}

            {q.type === "SHORT_ANSWER" && (
              <input
                className="input"
                value={responses[q.questionId]?.[0] ?? ""}
                onChange={(e) => setResponse(q.questionId, [e.target.value])}
                placeholder="Your answer"
                maxLength={500}
              />
            )}

            {q.type === "LONG_ANSWER" && (
              <>
                <textarea
                  className="input min-h-36"
                  value={responses[q.questionId]?.[0] ?? ""}
                  onChange={(e) => setResponse(q.questionId, [e.target.value])}
                  placeholder="Write your answer here"
                  maxLength={10_000}
                />
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {(responses[q.questionId]?.[0] ?? "").length} characters
                </p>
              </>
            )}
          </li>
        ))}
      </ol>

      <div className="card mt-4 p-5">
        {confirming ? (
          <>
            <p className="font-medium">Submit your answers?</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              You have answered {answeredCount} of {initial.questions.length} questions. You cannot change them afterwards.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" disabled={submitting} onClick={() => void submit()}>
                {submitting ? "Submitting…" : "Yes, submit"}
              </button>
              <button className="btn-ghost" onClick={() => setConfirming(false)}>
                Keep working
              </button>
            </div>
          </>
        ) : (
          <button className="btn-primary w-full" onClick={() => setConfirming(true)}>
            Submit answers
          </button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, org, title, subtitle }: { children: React.ReactNode; org?: string; title?: string; subtitle?: string }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        {org && (
          <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {org}
          </p>
        )}
        <h1 className="text-xl font-semibold sm:text-2xl">{title ?? "Assessment"}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </p>
        )}
      </header>
      {children}
      <footer className="mt-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        Powered by Veyra Talent
      </footer>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
