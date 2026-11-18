"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, Field, Spinner } from "@/components/ui";
import { api, ApiError, setActiveOrg } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/types";

interface InviteInfo {
  organizationName: string;
  email: string;
  role: Role;
  accountExists: boolean;
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <AcceptInvite />
    </Suspense>
  );
}

function AcceptInvite() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const { signIn } = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This invitation link is missing its token.");
      return;
    }
    api<InviteInfo>(`/auth/invitations/${token}`)
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : "This invitation is invalid or has expired."));
  }, [token]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string; organizationId: string }>("/auth/invitations/accept", {
        body: { token, password, ...(info?.accountExists ? {} : { name }) },
      });
      setActiveOrg(res.organizationId);
      await signIn(res.accessToken);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept the invitation.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {error && <Alert>{error}</Alert>}
        {!info && !error && <Spinner />}
        {info && (
          <form className="card mt-3 space-y-4 p-6" onSubmit={accept}>
            <div>
              <h1 className="text-lg font-semibold">Join {info.organizationName}</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                Invited as {info.role.replace(/_/g, " ").toLowerCase()} ({info.email}).
              </p>
            </div>
            {!info.accountExists && (
              <Field label="Your name">
                <input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
            )}
            <Field
              label={info.accountExists ? "Your existing password" : "Choose a password"}
              hint={info.accountExists ? undefined : "At least 10 characters, with letters and numbers."}
            >
              <input
                className="input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={info.accountExists ? "current-password" : "new-password"}
              />
            </Field>
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Joining…" : "Accept invitation"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
