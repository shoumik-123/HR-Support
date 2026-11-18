"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, PageHeader, ScoreBadge, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { CopilotAnswer, CopilotQuestion, CopilotReference } from "@/lib/types";

const STARTERS = [
  "Where is the pipeline stuck?",
  "Who has been waiting more than 14 days?",
  "What is our time to hire this quarter?",
  "Which offers are waiting on approval?",
];

export default function CopilotPage() {
  return (
    <AppShell>
      <Copilot />
    </AppShell>
  );
}

function Copilot() {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<CopilotAnswer[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<CopilotQuestion[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<CopilotQuestion[]>("/copilot/questions")
      .then(setTopics)
      .catch(() => setTopics([]));
  }, []);

  useEffect(() => {
    if (thread.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.length]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    try {
      const answer = await api<CopilotAnswer>("/copilot/ask", { body: { question: q } });
      setThread((t) => [...t, answer]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The copilot could not answer");
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Copilot"
        subtitle="Ask about your own hiring data. Every figure in an answer is computed here and shown beside it."
      />

      {thread.length === 0 && (
        <div className="card mb-4 p-4">
          <p className="text-sm">
            I answer questions about your jobs, pipeline, interviews, offers and talent pool — and I show the numbers behind every answer so you can
            check them. I do not decide anything: I will not tell you who to hire, reject or advance.
          </p>
          {topics.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {topics.map((t) => (
                <li key={t.intent}>• {t.summary}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {thread.map((answer, i) => (
          <AnswerCard key={`${answer.question}-${i}`} answer={answer} onFollowUp={ask} />
        ))}
      </div>
      <div ref={endRef} />

      {error && <Alert>{error}</Alert>}
      {asking && <Spinner label="Reading your data…" />}

      <form
        className="card sticky bottom-0 mt-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label className="label" htmlFor="question">
          Ask a question
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="question"
            className="input"
            placeholder="e.g. Where is the pipeline stuck?"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="btn-primary shrink-0" type="submit" disabled={asking || question.trim().length < 2}>
            {asking ? "Thinking…" : "Ask"}
          </button>
        </div>
        {thread.length === 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>
    </>
  );
}

function AnswerCard({ answer, onFollowUp }: { answer: CopilotAnswer; onFollowUp: (q: string) => void }) {
  const [showFacts, setShowFacts] = useState(true);

  return (
    <div className="card p-4">
      <p className="font-medium">{answer.question}</p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
        Understood as: {answer.asked}
        {answer.subject ? ` · ${answer.subject}` : ""}
      </p>

      <div className="mt-3 whitespace-pre-wrap text-sm">{answer.answer}</div>

      {answer.notes.length > 0 && (
        <ul className="mt-3 grid gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {answer.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {(answer.facts.length > 0 || answer.references.length > 0) && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowFacts((v) => !v)}>
            {showFacts ? "Hide the figures" : "Show the figures"}
          </button>

          {showFacts && (
            <>
              {answer.facts.length > 0 && (
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  {answer.facts.map((f) => (
                    <div key={f.label} className="flex items-baseline justify-between gap-2 border-b pb-1" style={{ borderColor: "var(--border)" }}>
                      <dt style={{ color: "var(--text-muted)" }}>{f.label}</dt>
                      <dd className="text-right font-medium">
                        {f.value ?? "not known"}
                        {f.detail && (
                          <span className="ml-1 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                            ({f.detail})
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {answer.references.length > 0 && (
                <ul className="mt-2 grid gap-1.5">
                  {answer.references.map((r) => (
                    <li key={`${r.type}-${r.id}`} className="flex items-center justify-between gap-2 text-sm">
                      <ReferenceLink reference={r} />
                      {r.score != null && <ScoreBadge score={r.score} size="sm" />}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs" style={{ borderColor: "var(--border)" }}>
        <span style={{ color: "var(--text-muted)" }}>
          {answer.method === "AI" ? `Written by AI${answer.model ? ` (${answer.model})` : ""} from the figures above` : "Written from the figures above, no AI involved"}
          {" · "}
          {answer.routing.method === "AI" ? "question read by AI" : "question read by rules"} · {Math.round(answer.confidence * 100)}% confident
          {answer.blindMode ? " · blind mode on" : ""}
        </span>
        {answer.followUps.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {answer.followUps.map((f) => (
              <button key={f} className="chip" onClick={() => onFollowUp(f)}>
                {f}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function ReferenceLink({ reference }: { reference: CopilotReference }) {
  const href =
    reference.type === "candidate"
      ? `/candidates/${reference.id}`
      : reference.type === "job"
        ? `/jobs/${reference.id}`
        : reference.type === "interview"
          ? `/interviews`
          : reference.type === "offer"
            ? `/offers`
            : null;

  const body = (
    <>
      <span className="font-medium">{reference.label}</span>
      {reference.detail && (
        <span className="ml-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {reference.detail}
        </span>
      )}
    </>
  );

  return href ? (
    <Link href={href} className="min-w-0 hover:underline">
      {body}
    </Link>
  ) : (
    <span className="min-w-0">{body}</span>
  );
}
