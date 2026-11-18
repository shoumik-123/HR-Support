"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Field } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const { me, loading, signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && me) router.replace("/dashboard");
  }, [me, loading, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await api<{ accessToken: string }>("/auth/login", { body: { email, password } });
      await signIn(accessToken);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-600 font-semibold text-white">V</span>
          <div>
            <p className="font-semibold">Veyra Talent</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              AI-powered recruitment
            </p>
          </div>
        </div>

        <form className="card space-y-4 p-6" onSubmit={onSubmit}>
          <h1 className="text-lg font-semibold">Sign in</h1>
          {error && <Alert>{error}</Alert>}

          <Field label="Work email">
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="flex items-center justify-between text-sm">
            <Link className="text-brand-600 hover:underline" href="/forgot-password">
              Forgot password?
            </Link>
            <Link className="text-brand-600 hover:underline" href="/register">
              Create an organization
            </Link>
          </div>
        </form>

        <p className="mt-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Demo: recruiter@veyra.test / Veyra12345
        </p>
      </div>
    </main>
  );
}
