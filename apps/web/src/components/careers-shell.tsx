"use client";

import Link from "next/link";
import type { CareersOrg } from "@/lib/types";

/**
 * Frame for the public careers pages. No app shell, no navigation into the product,
 * and nothing here calls an authenticated endpoint: a visitor is a member of the
 * public, not a signed-out user.
 *
 * The employer's brand colour, when they have set one, overrides the accent inside
 * this frame only, so a careers page looks like the company rather than like Veyra.
 */
export function CareersShell({ org, children }: { org?: CareersOrg | null; children: React.ReactNode }) {
  return (
    <div
      className="min-h-dvh"
      style={org?.brandColor ? ({ "--color-brand-600": org.brandColor, "--color-brand-700": org.brandColor } as React.CSSProperties) : undefined}
    >
      <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}>
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4">
          {org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- employer logos are arbitrary remote URLs
            <img src={org.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" />
          ) : (
            <span
              className="grid h-9 w-9 place-items-center rounded-lg text-sm font-semibold text-white"
              style={{ background: org?.brandColor ?? "var(--color-brand-600)" }}
              aria-hidden
            >
              {(org?.name ?? "·").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold">{org?.name ?? "Careers"}</p>
            {org && (
              <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                {[org.industry, org.country].filter(Boolean).join(" · ") || "Open roles"}
              </p>
            )}
          </div>
          {org?.website && (
            <a
              href={org.website}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-ghost ml-auto shrink-0 text-sm"
            >
              Company site
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>

      <footer className="mx-auto w-full max-w-4xl px-4 pb-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        {org && (
          <p>
            <Link href={`/careers/${org.slug}`} className="underline">
              All open roles at {org.name}
            </Link>
          </p>
        )}
        <p className="mt-2">Powered by Veyra Talent</p>
      </footer>
    </div>
  );
}

const WORK_MODE: Record<string, string> = { ONSITE: "On-site", REMOTE: "Remote", HYBRID: "Hybrid" };
const EMPLOYMENT: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  TEMPORARY: "Temporary",
};

export const workModeLabel = (v: string) => WORK_MODE[v] ?? v;
export const employmentLabel = (v: string) => EMPLOYMENT[v] ?? v;

/** Salary as the employer chose to publish it; callers only reach here when it is visible. */
export function salaryLabel(salary: { min: number | null; max: number | null; currency: string }): string {
  const money = (n: number) => new Intl.NumberFormat("en-US").format(n);
  if (salary.min !== null && salary.max !== null) return `${salary.currency} ${money(salary.min)}–${money(salary.max)}`;
  if (salary.min !== null) return `${salary.currency} ${money(salary.min)}+`;
  return `Up to ${salary.currency} ${money(salary.max ?? 0)}`;
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--surface-sunken)", color: "var(--text-muted)" }}>
      {children}
    </span>
  );
}
