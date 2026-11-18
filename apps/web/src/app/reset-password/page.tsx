"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Field, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner /></div>}>
      <Reset />
    </Suspense>
  );
}

function Reset() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form className="card w-full max-w-sm space-y-4 p-6" onSubmit={submit}>
        <h1 className="text-lg font-semibold">Set a new password</h1>
        {error && <Alert>{error}</Alert>}
        {done ? (
          <>
            <Alert kind="success">Your password has been reset. All other sessions were signed out.</Alert>
            <Link className="btn-primary w-full" href="/login">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <Field label="New password" hint="At least 10 characters, with letters and numbers.">
              <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <button className="btn-primary w-full" disabled={busy || !token}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
