import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { throttleTracker, type TrackedRequest } from "../src/common/throttle-tracker";

const SECRET = "a-test-secret-that-is-long-enough-to-pass";

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

function request(headers: Record<string, string | string[] | undefined>, ip = "10.0.0.1"): TrackedRequest {
  return { headers, ip, socket: { remoteAddress: ip } };
}

describe("throttleTracker — signed-in traffic", () => {
  it("gives two people behind one proxy address their own bucket", () => {
    // The web app proxies every call, so without this both would share "ip:10.0.0.1"
    // and one busy tab would rate-limit the whole company.
    const sadia = throttleTracker(request({ authorization: `Bearer ${sign({ sub: "u1", sid: "s1" })}` }), SECRET);
    const imran = throttleTracker(request({ authorization: `Bearer ${sign({ sub: "u2", sid: "s2" })}` }), SECRET);
    assert.notEqual(sadia, imran);
  });

  it("keeps one person's bucket stable across requests", () => {
    const token = sign({ sub: "u1", sid: "s1" });
    assert.equal(
      throttleTracker(request({ authorization: `Bearer ${token}` }, "10.0.0.1"), SECRET),
      throttleTracker(request({ authorization: `Bearer ${token}` }, "10.0.0.9"), SECRET),
      "the same session must count against one bucket even from a different address",
    );
  });

  it("separates two sessions of the same user", () => {
    const laptop = throttleTracker(request({ authorization: `Bearer ${sign({ sub: "u1", sid: "s1" })}` }), SECRET);
    const phone = throttleTracker(request({ authorization: `Bearer ${sign({ sub: "u1", sid: "s2" })}` }), SECRET);
    assert.notEqual(laptop, phone);
  });

  it("still counts an expired token against its own session", () => {
    const expired = sign({ sub: "u1", sid: "s1", exp: 1 });
    assert.equal(throttleTracker(request({ authorization: `Bearer ${expired}` }), SECRET), "s:s1");
  });

  it("falls back to the subject when the token carries no session id", () => {
    assert.equal(throttleTracker(request({ authorization: `Bearer ${sign({ sub: "u1" })}` }), SECRET), "s:u1");
  });
});

describe("throttleTracker — tokens that must not earn a bucket", () => {
  const byAddress = "ip:10.0.0.1";

  it("rejects a forged signature", () => {
    const forged = sign({ sub: "attacker", sid: "fake" }, "not-the-real-secret");
    assert.equal(
      throttleTracker(request({ authorization: `Bearer ${forged}` }), SECRET),
      byAddress,
      "an unverified token would let anyone mint a fresh bucket per request",
    );
  });

  it("rejects a token whose payload was edited after signing", () => {
    const real = sign({ sub: "u1", sid: "s1" });
    const [head, , signature] = real.split(".");
    const swapped = Buffer.from(JSON.stringify({ sub: "u2", sid: "s2" })).toString("base64url");
    assert.equal(throttleTracker(request({ authorization: `Bearer ${head}.${swapped}.${signature}` }), SECRET), byAddress);
  });

  it("rejects a token signed with no signature at all", () => {
    const [head, payload] = sign({ sub: "u1", sid: "s1" }).split(".");
    assert.equal(throttleTracker(request({ authorization: `Bearer ${head}.${payload}.` }), SECRET), byAddress);
  });

  it("handles malformed headers without throwing", () => {
    for (const authorization of ["", "Bearer", "Bearer ", "Bearer not-a-jwt", "Basic abc", "Bearer a.b", "Bearer a.b.c.d"]) {
      assert.equal(throttleTracker(request({ authorization }), SECRET), byAddress, `header: ${JSON.stringify(authorization)}`);
    }
  });

  it("ignores a repeated authorization header", () => {
    assert.equal(throttleTracker(request({ authorization: ["Bearer x", "Bearer y"] }), SECRET), byAddress);
  });
});

describe("throttleTracker — anonymous traffic", () => {
  it("counts by address so login stays brute-force limited", () => {
    assert.equal(throttleTracker(request({}, "203.0.113.5"), SECRET), "ip:203.0.113.5");
  });

  it("trusts only the hop nearest us in x-forwarded-for", () => {
    // Everything left of the last entry is whatever the client chose to send, so a
    // client claiming "1.2.3.4" must not be able to pick its own bucket.
    assert.equal(
      throttleTracker(request({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }), SECRET),
      "ip:198.51.100.7",
    );
  });

  it("uses a lone forwarded address", () => {
    assert.equal(throttleTracker(request({ "x-forwarded-for": "198.51.100.7" }), SECRET), "ip:198.51.100.7");
  });

  it("falls back to the socket address when nothing else identifies the caller", () => {
    assert.equal(throttleTracker({ headers: {}, socket: { remoteAddress: "::1" } }, SECRET), "ip:::1");
  });

  it("never returns an empty bucket", () => {
    assert.equal(throttleTracker({ headers: {} }, SECRET), "ip:unknown");
  });
});
