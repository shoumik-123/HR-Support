"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, bootstrapSession, getActiveOrg, logout as apiLogout, setAccessToken, setActiveOrg } from "./api";
import type { Me, OrgSummary } from "./types";

interface SessionValue {
  me: Me | null;
  org: OrgSummary | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refreshMe: () => Promise<void>;
  signIn: (accessToken: string) => Promise<Me>;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const profile = await api<Me>("/auth/me");
    setMe(profile);
    const stored = getActiveOrg();
    const active = profile.organizations.find((o) => o.id === stored) ?? profile.organizations[0];
    if (active) {
      setActiveOrg(active.id);
      setOrgId(active.id);
    }
    return profile;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await bootstrapSession();
      if (!cancelled && restored) {
        try {
          await loadMe();
        } catch {
          setMe(null);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const org = useMemo(() => me?.organizations.find((o) => o.id === orgId) ?? me?.organizations[0] ?? null, [me, orgId]);

  const value: SessionValue = {
    me,
    org,
    loading,
    can: (permission) => !!org?.permissions.includes(permission),
    refreshMe: async () => {
      await loadMe();
    },
    signIn: async (accessToken) => {
      setAccessToken(accessToken);
      return loadMe();
    },
    signOut: async () => {
      await apiLogout();
      setMe(null);
      setOrgId(null);
    },
    switchOrg: (id) => {
      setActiveOrg(id);
      setOrgId(id);
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

/** Redirects to the sign-in page when there is no session. */
export function useRequireAuth() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!session.loading && !session.me) router.replace("/login");
  }, [session.loading, session.me, router]);
  return session;
}
