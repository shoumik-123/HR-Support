"use client";

import { useState } from "react";
import { CriterionBar } from "@/components/charts";
import { Alert, ConfidenceBar, ScoreBadge, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { MatchResult } from "@/lib/types";

const CRITERION_LABEL: Record<string, string> = {
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  certifications: "Certifications",
};

/**
 * Explainable match view: per-criterion scores with the evidence behind them,
 * plus the human review controls. The AI never changes a candidate's stage.
 */
export function MatchDetail({ match, onReviewed }: { match: MatchResult; onReviewed?: (updated: MatchResult) => void }) {
  const { can } = useSession();
  const [reviewing, setReviewing] = useState(false);
  const [adjusted, setAdjusted] = useState(match.adjustedScore ?? match.score);
  const [note, setNote] = useState(match.reviewNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(match);

  async function review(status: "ACCEPTED" | "ADJUSTED" | "DISMISSED") {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<MatchResult>(`/matches/${current.id}/review`, {
        body: { status, adjustedScore: status === "ADJUSTED" ? adjusted : undefined, note: note.trim() || undefined },
      });
      setCurrent({ ...current, ...updated });
      setReviewing(false);
      onReviewed?.(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record your review.");
    } finally {
      setBusy(false);
    }
  }

  const effective = current.adjustedScore ?? current.score;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ScoreBadge score={effective} size="lg" />
        {current.adjustedScore != null && (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            adjusted by a reviewer from <span className="line-through">{current.score}</span>
          </span>
        )}
        <ConfidenceBar value={current.confidence} />
        <span className="chip">{current.method === "AI" ? `AI · ${current.model ?? "model"}` : "Rule-based"}</span>
        <span className="chip">{current.promptVersion}</span>
      </div>

      <Alert kind="info">
        This score supports your decision — it does not make one. Nothing about the candidate&apos;s stage changes unless you move them.
      </Alert>

      <p className="text-sm leading-relaxed">{current.summary}</p>

      <div className="space-y-3">
        {current.breakdown?.map((c) => (
          <div key={c.criterion}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{CRITERION_LABEL[c.criterion] ?? c.criterion}</span>
            </div>
            <CriterionBar score={c.score} weight={c.weight} />
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {c.rationale}
            </p>
            {c.evidence?.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {c.evidence.map((e, i) => (
                  <li key={i} className="border-l-2 pl-2.5 text-xs italic" style={{ borderColor: "var(--chart-series-1)", color: "var(--text-muted)" }}>
                    “{e}”
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-sm font-medium">Matched skills</h4>
          <div className="flex flex-wrap gap-1.5">
            {current.matchedSkills.length ? current.matchedSkills.map((s) => <span key={s} className="chip">{s}</span>) : <span className="hint">None found</span>}
          </div>
        </div>
        <div>
          <h4 className="mb-1.5 text-sm font-medium">Missing required skills</h4>
          <div className="flex flex-wrap gap-1.5">
            {current.missingSkills.length ? (
              current.missingSkills.map((s) => (
                <span key={s} className="chip border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200">
                  {s}
                </span>
              ))
            ) : (
              <span className="hint">None — all required skills found</span>
            )}
          </div>
        </div>
      </div>

      {(current.strengths?.length > 0 || current.gaps?.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {current.strengths?.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-sm font-medium">Strengths</h4>
              <ul className="list-inside list-disc space-y-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {current.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {current.gaps?.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-sm font-medium">Gaps to probe</h4>
              <ul className="list-inside list-disc space-y-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {current.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
        {error && <Alert>{error}</Alert>}
        {current.reviewStatus !== "PENDING" ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Reviewed as <strong>{current.reviewStatus.toLowerCase()}</strong>
            {current.reviewedByName ? ` by ${current.reviewedByName}` : ""}
            {current.reviewedAt ? ` ${timeAgo(current.reviewedAt)}` : ""}
            {current.reviewNote ? ` — “${current.reviewNote}”` : ""}
          </p>
        ) : can("match:review") ? (
          reviewing ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm" htmlFor="adjust">
                  Your score
                </label>
                <input id="adjust" type="range" min={0} max={100} value={adjusted} onChange={(e) => setAdjusted(Number(e.target.value))} className="flex-1" />
                <span className="w-10 text-right text-sm font-medium tabular-nums">{adjusted}</span>
              </div>
              <textarea className="input min-h-16" placeholder="Why are you adjusting or dismissing this? (recorded in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={() => void review("ADJUSTED")}>
                  Save adjusted score
                </button>
                <button className="btn-secondary" disabled={busy} onClick={() => void review("DISMISSED")}>
                  Dismiss recommendation
                </button>
                <button className="btn-ghost" onClick={() => setReviewing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => void review("ACCEPTED")}>
                Looks right
              </button>
              <button className="btn-secondary" onClick={() => setReviewing(true)}>
                Adjust or dismiss
              </button>
            </div>
          )
        ) : (
          <p className="hint">You do not have permission to review AI recommendations.</p>
        )}
      </div>
    </div>
  );
}
