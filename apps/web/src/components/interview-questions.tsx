"use client";

import { useState } from "react";
import { Alert, Modal } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { GeneratedQuestion, InterviewDetail, QuestionCategory, QuestionDifficulty } from "@/lib/types";

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  TECHNICAL: "Technical",
  BEHAVIORAL: "Behavioural",
  SITUATIONAL: "Situational",
  HR: "HR",
  ROLE_SPECIFIC: "Role-specific",
};

const DIFFICULTY_TONE: Record<QuestionDifficulty, string> = {
  EASY: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  MEDIUM: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  HARD: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
};

export function InterviewQuestions({ interview, onChange }: { interview: InterviewDetail; onChange: () => void }) {
  const { can } = useSession();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Questions ({interview.questions.length})</h2>
        {can("interview:conduct") && interview.status !== "CANCELLED" && (
          <button className="btn-secondary py-1.5" onClick={() => setSuggestOpen(true)}>
            ✨ Suggest questions
          </button>
        )}
      </div>

      {interview.questions.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No questions prepared yet. Generate suggestions based on the job and this candidate&apos;s own experience, then pick the ones you want.
        </p>
      ) : (
        <ol className="space-y-3">
          {interview.questions.map((q, i) => (
            <li key={q.id} className="border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {i + 1}. {q.text}
                </p>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${DIFFICULTY_TONE[q.difficulty]}`}>{q.difficulty.toLowerCase()}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="chip text-xs">{CATEGORY_LABEL[q.category]}</span>
                {(q.guidance || q.rationale) && (
                  <button className="text-xs text-brand-600 hover:underline" onClick={() => setExpanded(expanded === q.id ? null : q.id)}>
                    {expanded === q.id ? "Hide notes" : "What to listen for"}
                  </button>
                )}
              </div>
              {expanded === q.id && (
                <div className="mt-2 space-y-2 rounded-lg p-3 text-xs" style={{ background: "var(--surface-sunken)" }}>
                  {q.guidance && (
                    <div>
                      <p className="mb-0.5 font-medium">What a strong answer covers</p>
                      <p style={{ color: "var(--text-muted)" }}>{q.guidance}</p>
                    </div>
                  )}
                  {q.rationale && (
                    <div>
                      <p className="mb-0.5 font-medium">Why this question</p>
                      <p style={{ color: "var(--text-muted)" }}>{q.rationale}</p>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <SuggestQuestionsModal
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        interview={interview}
        onSaved={() => {
          setSuggestOpen(false);
          onChange();
        }}
      />
    </section>
  );
}

function SuggestQuestionsModal({
  open,
  onClose,
  interview,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  interview: InterviewDetail;
  onSaved: () => void;
}) {
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | "MIXED">("MIXED");
  const [useCandidate, setUseCandidate] = useState(true);
  const [result, setResult] = useState<{ questions: GeneratedQuestion[]; method: string; model: string | null; candidateSpecific: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<typeof result>(`/interviews/${interview.id}/questions/suggest`, { body: { count, difficulty, useCandidate } });
      setResult(r);
      setPicked(new Set(r!.questions.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not generate questions");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = result.questions.filter((_, i) => picked.has(i));
      const existing = interview.questions.map((q) => ({
        text: q.text, category: q.category, difficulty: q.difficulty, guidance: q.guidance ?? undefined, rationale: q.rationale ?? undefined,
      }));
      await api(`/interviews/${interview.id}/questions`, {
        method: "PUT",
        body: {
          questions: [
            ...existing,
            ...chosen.map((q) => ({ text: q.text, category: q.category, difficulty: q.difficulty, guidance: q.guidance, rationale: q.rationale })),
          ],
        },
      });
      setResult(null);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the questions");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Suggest interview questions" wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {!result ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">How many</label>
                <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Difficulty</label>
                <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as QuestionDifficulty | "MIXED")}>
                  <option value="MIXED">Mixed</option>
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </div>
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1" checked={useCandidate} onChange={(e) => setUseCandidate(e.target.checked)} />
              <span>
                Tailor questions to this candidate&apos;s resume
                <span className="mt-0.5 block hint">
                  Their name and contact details are removed before anything is sent for generation, and questions are based on documented experience only.
                </span>
              </span>
            </label>
            <button className="btn-primary w-full" disabled={busy} onClick={() => void generate()}>
              {busy ? "Writing questions…" : "Generate suggestions"}
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="chip">{result.method === "AI" ? `AI · ${result.model}` : "Rule-based"}</span>
              {result.candidateSpecific && <span className="chip">tailored to this resume</span>}
              <span>{picked.size} of {result.questions.length} selected</span>
            </div>

            <ul className="max-h-[26rem] space-y-2 overflow-y-auto">
              {result.questions.map((q, i) => (
                <li key={i} className="rounded-lg border p-3" style={{ borderColor: picked.has(i) ? "var(--chart-series-1)" : "var(--border)" }}>
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.has(i)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          return next;
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{q.text}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="chip text-xs">{CATEGORY_LABEL[q.category]}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${DIFFICULTY_TONE[q.difficulty]}`}>{q.difficulty.toLowerCase()}</span>
                        {q.skills.slice(0, 3).map((s) => (
                          <span key={s} className="chip text-xs">
                            {s}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        <span className="font-medium">Listen for:</span> {q.guidance}
                      </p>
                      <p className="mt-1 text-xs italic" style={{ color: "var(--text-muted)" }}>
                        {q.rationale}
                      </p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy || picked.size === 0} onClick={() => void save()}>
                Add {picked.size} question{picked.size === 1 ? "" : "s"} to this interview
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => setResult(null)}>
                Start over
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
