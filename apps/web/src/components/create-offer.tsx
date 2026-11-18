"use client";

import { useEffect, useState } from "react";
import { Alert, Field, Modal } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Benefit, InterviewerOption } from "@/lib/types";

const COMMON_BENEFITS: Benefit[] = [
  { label: "Festival bonus", value: "2 per year" },
  { label: "Health insurance", value: "Self and family" },
  { label: "Provident fund", value: "As per company policy" },
  { label: "Annual leave", value: "20 days" },
  { label: "Lunch allowance", value: "Provided" },
];

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

export function CreateOfferModal({
  open,
  onClose,
  applicationId,
  candidateName,
  jobTitle,
  currency,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  currency: string;
  onCreated: (offerId: string) => void;
}) {
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryPeriod, setSalaryPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [startDate, setStartDate] = useState(isoDate(30));
  const [respondBy, setRespondBy] = useState(isoDate(10));
  const [probationMonths, setProbationMonths] = useState("6");
  const [noticePeriodDays, setNoticePeriodDays] = useState("60");
  const [reportingTo, setReportingTo] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [approvers, setApprovers] = useState<string[]>([]);
  const [people, setPeople] = useState<InterviewerOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<InterviewerOption[]>("/interviewers").then(setPeople).catch(() => setPeople([]));
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>("/offers", {
        body: {
          applicationId,
          salaryAmount: Number(salaryAmount),
          salaryCurrency: currency,
          salaryPeriod,
          benefits,
          startDate: new Date(startDate).toISOString(),
          respondBy: new Date(respondBy).toISOString(),
          probationMonths: probationMonths ? Number(probationMonths) : null,
          noticePeriodDays: noticePeriodDays ? Number(noticePeriodDays) : null,
          reportingTo: reportingTo || null,
          workLocation: workLocation || null,
          approverIds: approvers.length ? approvers : undefined,
        },
      });
      onCreated(created.id);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the offer");
    } finally {
      setBusy(false);
    }
  }

  const valid = Number(salaryAmount) > 0 && startDate && respondBy && new Date(respondBy) <= new Date(startDate);

  return (
    <Modal open={open} onClose={onClose} title={`Offer for ${candidateName}`} wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          For <strong>{jobTitle}</strong>. The letter is generated from your offer template and you can read it before sending.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Salary (${currency})`}>
            <input className="input" type="number" min={1} value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} placeholder="180000" />
          </Field>
          <Field label="Period">
            <select className="input" value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value as "MONTHLY" | "YEARLY")}>
              <option value="MONTHLY">Per month</option>
              <option value="YEARLY">Per year</option>
            </select>
          </Field>
          <Field label="Reporting to">
            <input className="input" value={reportingTo} onChange={(e) => setReportingTo(e.target.value)} placeholder="Engineering Manager" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Joining date">
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Candidate must respond by" error={respondBy && startDate && new Date(respondBy) > new Date(startDate) ? "Must be on or before the joining date" : undefined}>
            <input className="input" type="date" value={respondBy} onChange={(e) => setRespondBy(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Probation (months)">
            <input className="input" type="number" min={0} max={24} value={probationMonths} onChange={(e) => setProbationMonths(e.target.value)} />
          </Field>
          <Field label="Notice period (days)">
            <input className="input" type="number" min={0} max={365} value={noticePeriodDays} onChange={(e) => setNoticePeriodDays(e.target.value)} />
          </Field>
          <Field label="Work location">
            <input className="input" value={workLocation} onChange={(e) => setWorkLocation(e.target.value)} placeholder="Dhaka office" />
          </Field>
        </div>

        <Field label="Benefits" hint="These appear in the letter. Click to add, then edit the detail.">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {COMMON_BENEFITS.filter((c) => !benefits.some((b) => b.label === c.label)).map((c) => (
              <button key={c.label} type="button" className="btn-secondary py-1 text-xs" onClick={() => setBenefits([...benefits, c])}>
                + {c.label}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            {benefits.map((b, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input flex-1"
                  value={b.label}
                  onChange={(e) => setBenefits(benefits.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))}
                  placeholder="Benefit"
                />
                <input
                  className="input flex-1"
                  value={b.value}
                  onChange={(e) => setBenefits(benefits.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)))}
                  placeholder="Detail"
                />
                <button type="button" className="btn-ghost px-2" onClick={() => setBenefits(benefits.filter((_, j) => j !== i))} aria-label="Remove benefit">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setBenefits([...benefits, { label: "", value: "" }])}>
              Add a custom benefit
            </button>
          </div>
        </Field>

        <Field label="Who must approve this offer?" hint="Leave empty to keep it as a draft you can send yourself, if your role allows it.">
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-sunken)]">
                <input
                  type="checkbox"
                  checked={approvers.includes(p.id)}
                  onChange={(e) => setApprovers((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                />
                <span className="flex-1">
                  {p.name}
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {p.role.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button className="btn-primary" disabled={busy || !valid} onClick={() => void submit()}>
            {busy ? "Creating…" : approvers.length ? "Create and request approval" : "Create draft"}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
