"use client";

import { Alert, timeAgo } from "@/components/ui";
import type { InterviewDetail, PanelSummary, RecommendationValue } from "@/lib/types";

const RECOMMENDATION_LABEL: Record<RecommendationValue, string> = {
  STRONG_YES: "Strong yes",
  YES: "Yes",
  LEAN_YES: "Leaning yes",
  LEAN_NO: "Leaning no",
  NO: "No",
  STRONG_NO: "Strong no",
};

const CONSENSUS_TEXT: Record<PanelSummary["consensus"], string> = {
  positive: "Everyone who has reported leans positive.",
  negative: "Everyone who has reported leans negative.",
  mixed: "The panel is divided — worth talking through before deciding.",
  insufficient: "No feedback submitted yet.",
};

/** Rating shown as filled dots: readable without relying on colour alone. */
function RatingDots({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs" style={{ color: "var(--text-muted)" }}>—</span>;
  const filled = Math.round(value);
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="size-2 rounded-full"
            style={{ background: i <= filled ? "var(--chart-series-1)" : "var(--surface-sunken)", outline: i <= filled ? "none" : "1px solid var(--border)" }}
          />
        ))}
      </span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </span>
  );
}

export function PanelFeedback({ interview }: { interview: InterviewDetail }) {
  const { panel, scorecards, criteria } = interview;
  const submitted = scorecards.filter((s) => s.submittedAt);

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Panel feedback</h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {panel.submitted} of {panel.submitted + panel.pending} submitted
        </p>
      </div>

      {panel.submitted === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No interviewer has submitted feedback yet.
        </p>
      ) : (
        <>
          {panel.split && (
            <Alert kind="warning">
              The panel disagrees about this candidate. That is a prompt to discuss, not a verdict — nothing here decides the outcome.
            </Alert>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Average rating across the panel
              </p>
              <div className="mt-1.5">
                <RatingDots value={panel.averageRating} />
              </div>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Where the panel stands
              </p>
              <p className="mt-1 text-sm">{CONSENSUS_TEXT[panel.consensus]}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(panel.recommendations).map(([rec, count]) => (
                  <span key={rec} className="chip text-xs">
                    {RECOMMENDATION_LABEL[rec as RecommendationValue]} × {count}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {panel.perCriterion.some((c) => c.average != null) && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">By criterion</h3>
              <ul className="space-y-2">
                {panel.perCriterion.map((c) => (
                  <li key={c.id} className="grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3">
                    <span className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
                      {c.label}
                    </span>
                    <span className="flex items-center gap-3">
                      <RatingDots value={c.average} />
                      {c.ratings.length > 1 && (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          ({c.ratings.join(", ")})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            {submitted.map((card) => (
              <article key={card.id} className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
                <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{card.interviewer?.name ?? "Interviewer"}</p>
                  <span className="flex items-center gap-2.5">
                    {card.recommendation && <span className="chip text-xs">{RECOMMENDATION_LABEL[card.recommendation]}</span>}
                    <RatingDots value={card.overallRating} />
                  </span>
                </header>

                <dl className="mb-2 grid gap-1.5 text-sm">
                  {criteria.map((c) => {
                    const r = card.ratings?.[c.id];
                    if (!r?.rating) return null;
                    return (
                      <div key={c.id}>
                        <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {c.label}: <strong className="tabular-nums">{r.rating}/5</strong>
                        </dt>
                        {r.comment && <dd className="text-sm">{r.comment}</dd>}
                      </div>
                    );
                  })}
                </dl>

                {card.strengths && (
                  <p className="text-sm">
                    <span className="font-medium">Strengths:</span> {card.strengths}
                  </p>
                )}
                {card.concerns && (
                  <p className="mt-1 text-sm">
                    <span className="font-medium">Concerns:</span> {card.concerns}
                  </p>
                )}
                {card.notes && (
                  <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                    {card.notes}
                  </p>
                )}
                {card.aiSummary && (
                  <p className="mt-2 border-l-2 pl-2 text-xs italic" style={{ borderColor: "var(--chart-series-1)", color: "var(--text-muted)" }}>
                    AI summary of these notes: {card.aiSummary}
                  </p>
                )}
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Submitted {card.submittedAt ? timeAgo(card.submittedAt) : ""}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
