"use client";

import { use, useEffect, useState } from "react";
import { Alert, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { CandidateOffer } from "@/lib/types";

/**
 * The candidate's own offer page. Like the assessment page, the link is the credential:
 * no account, no sign-in, and nothing here touches an authenticated endpoint.
 */
export default function CandidateOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <Offer token={token} />;
}

function Offer({ token }: { token: string }) {
  const [offer, setOffer] = useState<CandidateOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"ACCEPTED" | "DECLINED" | null>(null);
  const [mode, setMode] = useState<"idle" | "accepting" | "declining">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CandidateOffer>(`/public/offer/${token}`)
      .then(setOffer)
      .catch((e) => setError(e instanceof ApiError ? e.message : "This link could not be opened."));
  }, [token]);

  async function respond(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ status: "ACCEPTED" | "DECLINED" }>(`/public/offer/${token}/respond`, {
        body: { accept, reason: accept ? undefined : reason || undefined },
      });
      setOutcome(r.status);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record your response.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !offer) {
    return (
      <Shell>
        <Alert>{error}</Alert>
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          Reply to the email you received if you need a new link.
        </p>
      </Shell>
    );
  }
  if (!offer) {
    return (
      <Shell>
        <Spinner label="Opening your offer…" />
      </Shell>
    );
  }

  if (outcome) {
    return (
      <Shell org={offer.organizationName} title={offer.jobTitle}>
        {outcome === "ACCEPTED" ? (
          <>
            <Alert kind="success">
              You have accepted this offer. Congratulations, and welcome to {offer.organizationName}.
            </Alert>
            <div className="card mt-4 p-5">
              <p className="text-sm">
                Your joining date is{" "}
                <strong>{new Date(offer.startDate).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong>.
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                The HR team will contact you about the documents they need and what to expect on your first day.
              </p>
            </div>
          </>
        ) : (
          <Alert kind="info">
            Your response has been recorded. Thank you for letting {offer.organizationName} know, and all the best with your search.
          </Alert>
        )}
      </Shell>
    );
  }

  if (offer.state === "expired") {
    return (
      <Shell org={offer.organizationName} title={offer.jobTitle}>
        <Alert kind="warning">
          The deadline for responding to this offer has passed, so it can no longer be accepted here.
        </Alert>
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          If you are still interested, reply to the email you received and ask the team to re-issue it.
        </p>
      </Shell>
    );
  }

  if (offer.state === "responded") {
    return (
      <Shell org={offer.organizationName} title={offer.jobTitle}>
        <Alert kind="info">
          You have already responded to this offer
          {offer.respondedAt ? ` on ${new Date(offer.respondedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}.
        </Alert>
      </Shell>
    );
  }

  const daysLeft = Math.ceil((new Date(offer.respondBy).getTime() - Date.now()) / 86_400_000);

  return (
    <Shell org={offer.organizationName} title={`Offer of employment: ${offer.jobTitle}`}>
      {daysLeft <= 3 && (
        <Alert kind="warning">
          Please respond by {new Date(offer.respondBy).toLocaleDateString("en-GB", { day: "numeric", month: "long" })} —{" "}
          {daysLeft <= 0 ? "that is today" : daysLeft === 1 ? "that is tomorrow" : `${daysLeft} days from now`}.
        </Alert>
      )}

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">The key terms</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Position" value={offer.jobTitle} />
          <Fact label="Remuneration" value={offer.salary} />
          <Fact label="Joining date" value={new Date(offer.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} />
          <Fact label="Respond by" value={new Date(offer.respondBy).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} />
          {offer.reportingTo && <Fact label="Reporting to" value={offer.reportingTo} />}
          {offer.workLocation && <Fact label="Work location" value={offer.workLocation} />}
          {offer.probationMonths != null && <Fact label="Probation" value={`${offer.probationMonths} months`} />}
          {offer.noticePeriodDays != null && <Fact label="Notice period" value={`${offer.noticePeriodDays} days`} />}
        </dl>

        {offer.benefits.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-medium">Benefits</h3>
            <ul className="space-y-1 text-sm">
              {offer.benefits.map((b, i) => (
                <li key={i} className="flex justify-between gap-3 border-b pb-1 last:border-0" style={{ borderColor: "var(--border)" }}>
                  <span style={{ color: "var(--text-muted)" }}>{b.label}</span>
                  <span className="text-right font-medium">{b.value}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card mt-4 p-5">
        <h2 className="mb-3 font-semibold">The full letter</h2>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{offer.letterBody}</pre>
      </section>

      <section className="card mt-4 p-5">
        {error && <Alert>{error}</Alert>}

        {mode === "idle" && (
          <>
            <h2 className="font-semibold">Your decision</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Take your time. If you have questions about anything above, reply to the email you received before responding here.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => setMode("accepting")}>
                Accept this offer
              </button>
              <button className="btn-secondary" onClick={() => setMode("declining")}>
                Decline
              </button>
            </div>
          </>
        )}

        {mode === "accepting" && (
          <>
            <h2 className="font-semibold">Confirm your acceptance</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              By accepting you confirm the terms above, including a joining date of{" "}
              <strong>{new Date(offer.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</strong>. This cannot be undone here.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => void respond(true)}>
                {busy ? "Recording…" : "Yes, I accept"}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => setMode("idle")}>
                Go back
              </button>
            </div>
          </>
        )}

        {mode === "declining" && (
          <>
            <h2 className="font-semibold">Decline this offer</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              If you are willing to say why, it helps the team — but it is entirely optional.
            </p>
            <textarea
              className="input mt-3 min-h-20"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy} onClick={() => void respond(false)}>
                {busy ? "Recording…" : "Confirm decline"}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => setMode("idle")}>
                Go back
              </button>
            </div>
          </>
        )}
      </section>
    </Shell>
  );
}

function Shell({ children, org, title }: { children: React.ReactNode; org?: string; title?: string }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        {org && (
          <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {org}
          </p>
        )}
        <h1 className="text-xl font-semibold sm:text-2xl">{title ?? "Offer"}</h1>
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
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
