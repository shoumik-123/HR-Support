"use client";

import { useState } from "react";
import { Alert, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Rating, RecommendationValue, Scorecard, ScorecardCriterion } from "@/lib/types";

const ANCHORS: Record<number, string> = {
  1: "Well below the bar",
  2: "Below the bar",
  3: "Meets the bar",
  4: "Above the bar",
  5: "Well above the bar",
};

const RECOMMENDATIONS: { value: RecommendationValue; label: string }[] = [
  { value: "STRONG_YES", label: "Strong yes" },
  { value: "YES", label: "Yes" },
  { value: "LEAN_YES", label: "Leaning yes" },
  { value: "LEAN_NO", label: "Leaning no" },
  { value: "NO", label: "No" },
  { value: "STRONG_NO", label: "Strong no" },
];

export function ScorecardForm({
  interviewId,
  criteria,
  scorecard,
  onSaved,
}: {
  interviewId: string;
  criteria: ScorecardCriterion[];
  scorecard: Scorecard;
  onSaved: (message: string) => void;
}) {
  const { can } = useSession();
  const [ratings, setRatings] = useState<Record<string, Rating>>(scorecard.ratings ?? {});
  const [recommendation, setRecommendation] = useState<RecommendationValue | "">(scorecard.recommendation ?? "");
  const [strengths, setStrengths] = useState(scorecard.strengths ?? "");
  const [concerns, setConcerns] = useState(scorecard.concerns ?? "");
  const [notes, setNotes] = useState(scorecard.notes ?? "");
  const [aiSummary, setAiSummary] = useState(scorecard.aiSummary);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rated = criteria.filter((c) => ratings[c.id]?.rating != null);
  const complete = rated.length === criteria.length && !!recommendation;
  const runningScore = rated.length
    ? Math.round(
        (rated.reduce((sum, c) => sum + ratings[c.id].rating * c.weight, 0) / rated.reduce((sum, c) => sum + c.weight, 0)) * 100,
      ) / 100
    : null;

  const payload = (submit: boolean) => ({
    ratings,
    recommendation: recommendation || undefined,
    strengths: strengths || undefined,
    concerns: concerns || undefined,
    notes: notes || undefined,
    submit,
  });

  async function save(submit: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/interviews/${interviewId}/scorecard`, { method: "PUT", body: payload(submit) });
      onSaved(submit ? "Your feedback has been submitted." : "Draft saved.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your feedback");
    } finally {
      setBusy(false);
    }
  }

  async function summarise() {
    setBusy(true);
    setError(null);
    try {
      // Save the notes first so the summary reflects what is on screen.
      await api(`/interviews/${interviewId}/scorecard`, { method: "PUT", body: payload(false) });
      const r = await api<{ summary: string; model: string }>(`/interviews/${interviewId}/scorecard/summarise`, { method: "POST" });
      setAiSummary(r.summary);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not summarise your notes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Your feedback</h2>
        {runningScore != null && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Weighted so far: <strong className="tabular-nums">{runningScore}</strong> / 5
          </p>
        )}
      </div>
      <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
        Rate each criterion against the bar for this role. Once you submit, your feedback is locked and the rest of the panel&apos;s becomes visible to you.
      </p>

      {error && <Alert>{error}</Alert>}

      <div className="space-y-4">
        {criteria.map((c) => (
          <div key={c.id}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <label className="text-sm font-medium">
                {c.label}
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                  {c.weight}% of the score
                </span>
              </label>
              {ratings[c.id]?.rating && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {ANCHORS[ratings[c.id].rating]}
                </span>
              )}
            </div>
            {c.description && (
              <p className="mb-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                {c.description}
              </p>
            )}
            <div className="flex gap-1.5" role="group" aria-label={c.label}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={ratings[c.id]?.rating === value}
                  title={ANCHORS[value]}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium tabular-nums transition-colors ${
                    ratings[c.id]?.rating === value ? "border-brand-600 bg-brand-600 text-white" : "hover:bg-[var(--surface-sunken)]"
                  }`}
                  style={ratings[c.id]?.rating === value ? undefined : { borderColor: "var(--border)" }}
                  onClick={() => setRatings((prev) => ({ ...prev, [c.id]: { ...prev[c.id], rating: value } }))}
                >
                  {value}
                </button>
              ))}
            </div>
            <input
              className="input mt-1.5 text-sm"
              placeholder={`Evidence for this rating (optional)`}
              value={ratings[c.id]?.comment ?? ""}
              onChange={(e) => setRatings((prev) => ({ ...prev, [c.id]: { rating: prev[c.id]?.rating ?? 0, comment: e.target.value } }))}
              disabled={!ratings[c.id]?.rating}
            />
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <Field label="Strengths" hint="What this candidate demonstrated well, with examples from the interview.">
          <textarea className="input min-h-20" value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        </Field>
        <Field label="Concerns" hint="Gaps or risks, and what you would want to probe next.">
          <textarea className="input min-h-20" value={concerns} onChange={(e) => setConcerns(e.target.value)} />
        </Field>
        <Field label="Other notes">
          <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {can("ai:use") && (
          <div>
            <button type="button" className="btn-secondary py-1.5" disabled={busy} onClick={() => void summarise()}>
              ✨ Tidy my notes into a summary
            </button>
            {aiSummary && (
              <div className="mt-2 rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  AI summary of your notes — check it before relying on it
                </p>
                <p className="text-sm">{aiSummary}</p>
              </div>
            )}
          </div>
        )}

        <Field label="Your recommendation" hint="Your view for the hiring discussion. The decision is made by the hiring team, not by this score.">
          <div className="flex flex-wrap gap-1.5">
            {RECOMMENDATIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={recommendation === r.value}
                className={recommendation === r.value ? "btn-primary py-1.5 text-sm" : "btn-secondary py-1.5 text-sm"}
                onClick={() => setRecommendation(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary" disabled={busy} onClick={() => void save(false)}>
            Save draft
          </button>
          <button className="btn-primary" disabled={busy || !complete} onClick={() => void save(true)}>
            Submit feedback
          </button>
          {!complete && (
            <span className="hint">
              {rated.length < criteria.length ? `Rate all ${criteria.length} criteria` : "Choose a recommendation"} to submit.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
