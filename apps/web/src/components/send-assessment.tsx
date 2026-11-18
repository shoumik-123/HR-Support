"use client";

import { useEffect, useState } from "react";
import { Alert, Field, Modal, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { AssessmentTemplate } from "@/lib/types";

export function SendAssessmentModal({
  open,
  onClose,
  applicationId,
  candidateName,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  candidateName: string;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<AssessmentTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [validForDays, setValidForDays] = useState(7);
  const [notify, setNotify] = useState(true);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<AssessmentTemplate[]>("/assessment-templates")
      .then((t) => {
        setTemplates(t);
        if (t.length === 1) setTemplateId(t[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load papers"));
  }, [open]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ inviteLink: string }>("/assessments", {
        body: { applicationId, templateId, validForDays, notifyCandidate: notify },
      });
      setLink(r.inviteLink);
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the assessment");
    } finally {
      setBusy(false);
    }
  }

  const chosen = templates?.find((t) => t.id === templateId);

  return (
    <Modal open={open} onClose={onClose} title={`Send an assessment to ${candidateName}`}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {link ? (
          <>
            <Alert kind="success">
              The assessment has been set. {notify ? "The candidate has been emailed a private link." : "Share the link below with the candidate."}
            </Alert>
            <div>
              <p className="label">The candidate&apos;s private link</p>
              <code className="block break-all rounded-lg p-3 text-xs" style={{ background: "var(--surface-sunken)" }}>
                {link}
              </code>
              <p className="mt-1 hint">This link works once, for this candidate only. It is not shown again.</p>
            </div>
            <button className="btn-primary w-full" onClick={onClose}>
              Done
            </button>
          </>
        ) : !templates ? (
          <Spinner />
        ) : templates.length === 0 ? (
          <Alert kind="info">
            No assessment papers exist yet. An HR manager needs to create one from the question bank before you can send a test.
          </Alert>
        ) : (
          <>
            <Field label="Which paper?">
              <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Choose a paper…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.items.length} questions, {t.durationMinutes} min
                  </option>
                ))}
              </select>
            </Field>

            {chosen && (
              <div className="rounded-lg p-3 text-sm" style={{ background: "var(--surface-sunken)" }}>
                <p>
                  <strong>{chosen.items.length}</strong> questions · <strong>{chosen.durationMinutes}</strong> minutes ·{" "}
                  pass mark <strong>{chosen.passingPercent}%</strong>
                </p>
                <p className="mt-1" style={{ color: "var(--text-muted)" }}>
                  {chosen.showResultToCandidate ? "The candidate sees their score afterwards." : "The score is kept internal."}
                  {chosen.shuffleQuestions && " Question order is randomised per candidate."}
                </p>
              </div>
            )}

            <Field label="How long should the link stay valid?">
              <select className="input w-auto" value={validForDays} onChange={(e) => setValidForDays(Number(e.target.value))}>
                {[3, 5, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>
                Email the candidate their link
                <span className="mt-0.5 block hint">Uses your assessment invitation template. You will also get the link to share manually.</span>
              </span>
            </label>

            <button className="btn-primary w-full" disabled={busy || !templateId} onClick={() => void send()}>
              {busy ? "Sending…" : "Send assessment"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
