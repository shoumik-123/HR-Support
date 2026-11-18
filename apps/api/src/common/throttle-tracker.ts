import { createHmac, timingSafeEqual } from "node:crypto";

/** Only the parts of a request this module looks at, so it stays testable without Express. */
export interface TrackedRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * Which bucket a request's rate limit counts against.
 *
 * The web app proxies every call through its own server (Next rewrites /api/* to the
 * API), so to the API every signed-in person shares one source address. Counting by
 * address therefore counts the whole company as a single client: one busy tab spends
 * the allowance and everyone else gets 429. The same is true behind any load balancer
 * in production, so this is not only a development problem.
 *
 * Signed-in traffic is counted per session instead. The token is verified here - an
 * unverified subject would let anyone mint a fresh bucket per request and walk past
 * the limit entirely - and anything without a usable token falls back to the address,
 * which is what brute-force protection on the public auth routes needs.
 */
export function throttleTracker(req: TrackedRequest, jwtSecret: string): string {
  const session = sessionFromRequest(req, jwtSecret);
  return session ? `s:${session}` : `ip:${clientIp(req)}`;
}

function sessionFromRequest(req: TrackedRequest, jwtSecret: string): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;

  const expected = createHmac("sha256", jwtSecret).update(`${headerPart}.${payloadPart}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signaturePart, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      sid?: unknown;
      sub?: unknown;
      exp?: unknown;
    };
    // An expired token still identifies whose session it was, which is the right
    // bucket for the retry storm that an expired token tends to produce.
    if (typeof payload.sid === "string") return payload.sid;
    if (typeof payload.sub === "string") return payload.sub;
    return null;
  } catch {
    return null;
  }
}

/**
 * The address the request really came from. Only the hop nearest us is trusted:
 * everything further left in X-Forwarded-For is whatever the client chose to send.
 */
function clientIp(req: TrackedRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const nearest = chain?.split(",").pop()?.trim();
  return nearest || req.ip || req.socket?.remoteAddress || "unknown";
}
