"use client";

import { useId, useState } from "react";

/**
 * Chart primitives. Deliberately single-hue (sequential) with direct value labels:
 * identity is never carried by colour alone, and the palette validates on both
 * the light and dark surfaces.
 */

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "attention";
}) {
  return (
    <div className="card card-hover p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-[1.6rem] font-semibold leading-none tabular-nums" style={tone === "attention" ? { color: "var(--accent)" } : undefined}>
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export interface MeterRow {
  label: string;
  value: number;
  /** Optional caption shown to the right of the value, e.g. a conversion rate. */
  note?: string;
}

/**
 * Meter list: one row per item, bars aligned and scaled to `max`.
 * Used for the recruitment funnel and any "several ratios, one per row" data.
 */
export function MeterList({ rows, max, emptyLabel = "No data yet" }: { rows: MeterRow[]; max?: number; emptyLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ceiling = Math.max(max ?? 0, ...rows.map((r) => r.value), 1);
  const titleId = useId();

  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="space-y-2.5" aria-describedby={titleId}>
      <span id={titleId} className="sr-only">
        Values shown as horizontal bars with the number beside each row.
      </span>
      {rows.map((row, i) => (
        <li
          key={row.label}
          className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={row.note ? `${row.label}: ${row.value} (${row.note})` : `${row.label}: ${row.value}`}
        >
          <span className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
            {row.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-sm" style={{ background: "var(--surface-sunken)" }}>
            <span
              className="block h-full rounded-r-[4px] transition-[width,opacity] duration-300"
              style={{
                width: `${Math.max((row.value / ceiling) * 100, row.value > 0 ? 2 : 0)}%`,
                background: "var(--chart-series-1)",
                opacity: hover === null || hover === i ? 1 : 0.55,
              }}
            />
          </span>
          <span className="flex items-baseline gap-1.5 text-sm font-medium tabular-nums">
            {row.value}
            {row.note && (
              <span className="text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                {row.note}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal proportion bar for one criterion score, 0-100. */
export function CriterionBar({ score, weight }: { score: number | null; weight: number }) {
  if (score == null) {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Not applicable — the job sets no requirement
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-full overflow-hidden rounded-sm" style={{ background: "var(--surface-sunken)" }}>
        <span className="block h-full rounded-r-[4px]" style={{ width: `${score}%`, background: "var(--chart-series-1)" }} />
      </span>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
        {score}/100 · {weight}%
      </span>
    </div>
  );
}
