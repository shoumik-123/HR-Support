"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, Field, Modal, PageHeader, Spinner, timeAgo } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Member, Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  HR_MANAGER: "HR manager",
  RECRUITER: "Recruiter",
  HIRING_MANAGER: "Hiring manager",
  INTERVIEWER: "Interviewer",
  EVALUATOR: "Assessment evaluator",
  VIEWER: "Management viewer",
};

const ROLE_HELP: Record<Role, string> = {
  OWNER: "Full access, including billing and ownership transfer.",
  ADMIN: "Full access to recruitment and settings.",
  HR_MANAGER: "Runs hiring end to end; can configure the pipeline and delete candidates.",
  RECRUITER: "Manages jobs, resumes, screening and the pipeline.",
  HIRING_MANAGER: "Reviews candidates and moves them through stages.",
  INTERVIEWER: "Reviews assigned candidates and leaves feedback. Cannot see contact details.",
  EVALUATOR: "Scores assessments. Cannot see contact details.",
  VIEWER: "Read-only access to jobs, candidates and analytics.",
};

interface Invitation {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

export default function TeamPage() {
  return (
    <AppShell>
      <Team />
    </AppShell>
  );
}

function Team() {
  const { can, me } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMembers(await api<Member[]>("/org/members"));
      if (can("team:manage")) setInvitations(await api<Invitation[]>("/org/invitations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the team");
    }
  }, [can]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateRole(userId: string, role: Role) {
    try {
      await api(`/org/members/${userId}`, { method: "PATCH", body: { role } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update the role");
    }
  }

  async function remove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from this organization?`)) return;
    try {
      await api(`/org/members/${userId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the member");
    }
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="People in this organization and what they can do"
        actions={
          can("team:manage") && (
            <button className="btn-primary" onClick={() => setInviteOpen(true)}>
              Invite member
            </button>
          )
        }
      />

      {error && <Alert>{error}</Alert>}
      {!members && !error && <Spinner />}

      {invitations.length > 0 && (
        <section className="card mb-4 p-4">
          <h2 className="mb-2 font-semibold">Pending invitations</h2>
          <ul className="space-y-2">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {inv.email} <span className="chip ml-1">{ROLE_LABEL[inv.role]}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    expires {timeAgo(inv.expiresAt)}
                  </span>
                  <button
                    className="text-sm text-red-600 hover:underline"
                    onClick={async () => {
                      await api(`/org/invitations/${inv.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    Revoke
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {members && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)", background: "var(--surface-sunken)" }}>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Last active</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2.5 font-medium">
                    {m.name}
                    {m.id === me?.id && <span className="ml-2 chip">you</span>}
                    {m.status === "SUSPENDED" && <span className="ml-2 chip">suspended</span>}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {m.email}
                  </td>
                  <td className="px-4 py-2.5">
                    {can("team:manage") && m.id !== me?.id ? (
                      <select className="input w-auto py-1 text-sm" value={m.role} onChange={(e) => void updateRole(m.id, e.target.value as Role)}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABEL[m.role]
                    )}
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                    {m.lastLoginAt ? timeAgo(m.lastLoginAt) : "Never"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {can("team:manage") && m.id !== me?.id && (
                      <button className="text-sm text-red-600 hover:underline" onClick={() => void remove(m.id, m.name)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onDone={() => {
          setInviteOpen(false);
          void load();
        }}
      />
    </>
  );
}

function InviteModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("RECRUITER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api("/org/invitations", { body: { email, role } });
      setEmail("");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite a team member">
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Work email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role" hint={ROLE_HELP[role]}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn-primary w-full" disabled={busy || !email.includes("@")} onClick={() => void submit()}>
          {busy ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </Modal>
  );
}
