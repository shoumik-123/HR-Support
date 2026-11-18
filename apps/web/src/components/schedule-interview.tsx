"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Field, Modal, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { InterviewKind, InterviewMode, InterviewerOption, InterviewTemplate, SlotConflict, SlotSuggestion } from "@/lib/types";

const KINDS: { value: InterviewKind; label: string }[] = [
  { value: "SCREENING", label: "Screening" },
  { value: "TECHNICAL", label: "Technical" },
  { value: "BEHAVIORAL", label: "Behavioural" },
  { value: "PANEL", label: "Panel" },
  { value: "HR", label: "HR" },
  { value: "FINAL", label: "Final" },
];

/** Converts a datetime-local value (local browser time) to an ISO instant. */
function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleInterviewModal({
  open,
  onClose,
  applicationId,
  candidateName,
  jobTitle,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  onScheduled: (interviewId: string) => void;
}) {
  const [interviewers, setInterviewers] = useState<InterviewerOption[]>([]);
  const [templates, setTemplates] = useState<InterviewTemplate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [kind, setKind] = useState<InterviewKind>("TECHNICAL");
  const [mode, setMode] = useState<InterviewMode>("VIDEO");
  const [duration, setDuration] = useState(60);
  const [startLocal, setStartLocal] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [notifyCandidate, setNotifyCandidate] = useState(true);
  const [suggestions, setSuggestions] = useState<SlotSuggestion | null>(null);
  const [conflicts, setConflicts] = useState<SlotConflict[] | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([api<InterviewerOption[]>("/interviewers"), api<InterviewTemplate[]>("/interview-templates")])
      .then(([people, tmpl]) => {
        setInterviewers(people);
        setTemplates(tmpl);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load interviewers"));
  }, [open]);

  // Applying a template fills in its format, length and criteria.
  useEffect(() => {
    const t = templates.find((x) => x.id === templateId);
    if (t) {
      setKind(t.kind);
      setDuration(t.durationMinutes);
    }
  }, [templateId, templates]);

  const nameById = useMemo(() => new Map(interviewers.map((i) => [i.id, i.name])), [interviewers]);

  async function findSlots() {
    if (!selected.length) return;
    setLoadingSlots(true);
    setError(null);
    try {
      setSuggestions(await api<SlotSuggestion>("/interviews/slots/suggest", { body: { userIds: selected, durationMinutes: duration, days: 21, limit: 8 } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not find free slots");
    } finally {
      setLoadingSlots(false);
    }
  }

  // Check the chosen time against everyone's calendar as the organizer types.
  useEffect(() => {
    const iso = localToIso(startLocal);
    if (!iso || !selected.length) {
      setConflicts(null);
      setGaps([]);
      return;
    }
    const timer = setTimeout(() => {
      api<{ available: boolean; conflicts: SlotConflict[]; availabilityGaps: string[] }>("/interviews/slots/check", {
        body: { startsAt: iso, durationMinutes: duration, userIds: selected },
      })
        .then((r) => {
          setConflicts(r.conflicts);
          setGaps(r.availabilityGaps);
        })
        .catch(() => {
          setConflicts(null);
          setGaps([]);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [startLocal, duration, selected]);

  async function submit(allowConflicts: boolean) {
    const iso = localToIso(startLocal);
    if (!iso) {
      setError("Choose a date and time");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>("/interviews", {
        body: {
          applicationId,
          templateId: templateId || undefined,
          kind,
          mode,
          startsAt: iso,
          durationMinutes: duration,
          meetingLink: mode === "VIDEO" && meetingLink ? meetingLink : null,
          location: mode === "ONSITE" && location ? location : null,
          agenda: agenda || null,
          interviewers: selected.map((userId, i) => ({ userId, role: i === 0 ? "LEAD" : "PANEL" })),
          notifyCandidate,
          allowConflicts,
        },
      });
      onScheduled(created.id);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not schedule the interview");
    } finally {
      setBusy(false);
    }
  }

  const hasConflict = (conflicts?.length ?? 0) > 0;

  return (
    <Modal open={open} onClose={onClose} title={`Schedule an interview with ${candidateName}`} wide>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          For <strong>{jobTitle}</strong>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Interview template" hint="Sets the format, length and scorecard criteria.">
            <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">No template — set it up manually</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.durationMinutes} min)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Interview type">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as InterviewKind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Interviewers" hint="The first person selected leads the interview.">
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
            {interviewers.length === 0 && <Spinner />}
            {interviewers.map((person) => (
              <label key={person.id} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-sunken)]">
                <input
                  type="checkbox"
                  checked={selected.includes(person.id)}
                  onChange={(e) =>
                    setSelected((prev) => (e.target.checked ? [...prev, person.id] : prev.filter((id) => id !== person.id)))
                  }
                />
                <span className="flex-1">
                  {person.name}
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {person.role.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
                {person.availabilityWindows === 0 && <span className="chip text-xs">no hours set</span>}
                {selected[0] === person.id && <span className="chip text-xs">lead</span>}
              </label>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Length (minutes)">
            <input className="input" type="number" min={10} max={480} step={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
          </Field>
          <Field label="Format">
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
              <option value="VIDEO">Video call</option>
              <option value="PHONE">Phone</option>
              <option value="ONSITE">On-site</option>
            </select>
          </Field>
          <Field label="Date and time" hint="In your local time.">
            <input className="input" type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary py-1.5" disabled={!selected.length || loadingSlots} onClick={() => void findSlots()}>
            {loadingSlots ? "Finding slots…" : "Suggest free slots"}
          </button>
          {!selected.length && <span className="hint">Select interviewers first.</span>}
        </div>

        {suggestions && (
          <div className="rounded-lg p-3" style={{ background: "var(--surface-sunken)" }}>
            {suggestions.withoutDeclaredHours.length > 0 && (
              <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
                {suggestions.withoutDeclaredHours.map((id) => nameById.get(id) ?? "Someone").join(", ")} has not set weekly hours, so their availability is unknown.
              </p>
            )}
            {suggestions.slots.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No slot works for everyone in the next three weeks. Try a shorter interview, a smaller panel, or ask the team to update their hours.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Everyone is free ({suggestions.timezone})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slots.map((slot) => (
                    <button
                      key={slot.start}
                      type="button"
                      className={startLocal === isoToLocalInput(slot.start) ? "btn-primary py-1.5 text-xs" : "btn-secondary py-1.5 text-xs"}
                      onClick={() => setStartLocal(isoToLocalInput(slot.start))}
                    >
                      {slot.label.replace(` (${suggestions.timezone})`, "")}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {hasConflict && (
          <Alert kind="warning">
            Already booked:
            <ul className="mt-1 list-inside list-disc text-xs">
              {conflicts!.map((c, i) => (
                <li key={i}>
                  {c.interviewerName ?? nameById.get(c.userId) ?? "An interviewer"} has another interview then
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {!hasConflict && gaps.length > 0 && (
          <Alert kind="info">
            {gaps.map((id) => nameById.get(id) ?? "An interviewer").join(", ")} has not declared availability at this time. You can still book it.
          </Alert>
        )}

        {mode === "VIDEO" && (
          <Field label="Meeting link" hint="Paste the video call link; it goes in the candidate's invitation.">
            <input className="input" type="url" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} placeholder="https://meet.example.com/…" />
          </Field>
        )}
        {mode === "ONSITE" && (
          <Field label="Address">
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Office address and floor" />
          </Field>
        )}

        <Field label="Agenda" hint="Optional. Shared with the interviewers and in the calendar invitation.">
          <textarea className="input min-h-20" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </Field>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-1" checked={notifyCandidate} onChange={(e) => setNotifyCandidate(e.target.checked)} />
          <span>
            Email the candidate an invitation with a calendar attachment
            <span className="mt-0.5 block hint">Uses your interview invitation template. The interviewers are always notified.</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <button className="btn-primary" disabled={busy || !selected.length || !startLocal} onClick={() => void submit(false)}>
            {busy ? "Scheduling…" : "Schedule interview"}
          </button>
          {hasConflict && (
            <button className="btn-secondary" disabled={busy} onClick={() => void submit(true)}>
              Book anyway
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
