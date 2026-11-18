"use client";

/**
 * Browser API client. The access token lives in memory only; the refresh token is an
 * HttpOnly cookie the browser sends to /api/auth/refresh. On a 401 the client refreshes
 * once and replays the request, with concurrent calls sharing a single refresh.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let activeOrgId: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

export function setActiveOrg(orgId: string | null) {
  activeOrgId = orgId;
  if (typeof window !== "undefined") {
    if (orgId) localStorage.setItem("veyra.org", orgId);
    else localStorage.removeItem("veyra.org");
  }
  listeners.forEach((l) => l());
}

export function getActiveOrg(): string | null {
  if (activeOrgId) return activeOrgId;
  if (typeof window === "undefined") return null;
  try {
    activeOrgId = localStorage.getItem("veyra.org");
  } catch {
    activeOrgId = null;
  }
  return activeOrgId;
}

export function onOrgChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = (await res.json()).accessToken;
      return true;
    } finally {
      // Release the shared promise on the next tick so queued callers see the result.
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** FormData for uploads; `body` is ignored when set. */
  form?: FormData;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const org = getActiveOrg();
    if (org) headers["X-Org-Id"] = org;
    if (opts.body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
    return fetch(`/api${path}`, {
      method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
      headers,
      credentials: "include",
      signal: opts.signal,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  };

  let res = await send();
  if (res.status === 401 && (await refresh())) res = await send();

  if (!res.ok) {
    let message = res.statusText || "Request failed";
    let issues: { path: string; message: string }[] | undefined;
    try {
      const body = await res.json();
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
      issues = body.issues;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, issues);
  }

  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Restores a session on page load using the refresh cookie. */
export async function bootstrapSession(): Promise<boolean> {
  return refresh();
}

export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    /* already signed out */
  }
  accessToken = null;
  setActiveOrg(null);
}
