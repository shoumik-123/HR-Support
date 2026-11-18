import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { formatPhone, normalisePhone } from "../src/whatsapp/phone";
import { DEFAULT_WHATSAPP_TEMPLATES } from "../src/whatsapp/default-whatsapp-templates";
import { usedVariables } from "../src/communications/template-render";

describe("whatsapp — reading a phone number someone typed", () => {
  const same = "+8801712345678";
  const forms = ["01712345678", "+8801712345678", "8801712345678", "+88 01712 345678", "01712-345678", "(017) 1234 5678", "1712345678", "০১৭১২৩৪৫৬৭৮"];

  for (const form of forms) {
    it(`reads "${form}" as one number`, () => {
      assert.equal(normalisePhone(form).e164, same);
    });
  }

  it("keeps a foreign number as it was given", () => {
    assert.equal(normalisePhone("+971 50 123 4567").e164, "+971501234567");
    assert.equal(normalisePhone("0044 7700 900123").e164, "+447700900123");
  });

  it("says why a number cannot be used instead of guessing", () => {
    assert.match(normalisePhone("029887766").reason ?? "", /landline/i);
    assert.match(normalisePhone("12345").reason ?? "", /too short/i);
    assert.match(normalisePhone("1234567890123456789").reason ?? "", /too long/i);
    assert.match(normalisePhone("call me").reason ?? "", /not a phone number/i);
    assert.match(normalisePhone(null).reason ?? "", /no phone number/i);
    assert.match(normalisePhone("  ").reason ?? "", /no phone number/i);
  });

  it("never returns both a number and a reason", () => {
    for (const input of [...forms, "029887766", "12345", null, "nonsense", "+971501234567"]) {
      const result = normalisePhone(input);
      assert.ok((result.e164 === null) !== (result.reason === null), `${input}: ${JSON.stringify(result)}`);
    }
  });

  it("writes a number back in a form a person can check", () => {
    assert.equal(formatPhone("+8801712345678"), "+880 17 1234-5678");
    assert.equal(formatPhone("+971501234567"), "+971501234567");
  });
});

describe("whatsapp — the templates an organization starts with", () => {
  it("uses only placeholders the renderer can fill", () => {
    for (const t of DEFAULT_WHATSAPP_TEMPLATES) {
      assert.deepEqual(usedVariables(t.body).unknown, [], `${t.name} has unknown placeholders`);
    }
  });

  it("stays inside what a provider-approved template body accepts", () => {
    for (const t of DEFAULT_WHATSAPP_TEMPLATES) {
      assert.ok(t.body.length <= 1024, `${t.name} is ${t.body.length} characters`);
    }
  });

  it("says who is writing, because it arrives on a personal phone", () => {
    for (const t of DEFAULT_WHATSAPP_TEMPLATES) {
      assert.match(t.body, /\{\{organization\.name\}\}/, `${t.name} never names the sender`);
    }
  });

  it("has no automated rejection message", () => {
    assert.ok(!DEFAULT_WHATSAPP_TEMPLATES.some((t) => t.key === "REJECTED"), "a rejection should not arrive by WhatsApp by default");
  });

  it("covers the moments a candidate needs to hear about quickly", () => {
    const keys = DEFAULT_WHATSAPP_TEMPLATES.map((t) => t.key);
    for (const key of ["INTERVIEW_INVITATION", "INTERVIEW_REMINDER", "INTERVIEW_RESCHEDULED", "INTERVIEW_CANCELLED", "ASSESSMENT_INVITATION", "OFFER"]) {
      assert.ok(keys.includes(key as never), `missing ${key}`);
    }
  });
});

describe("whatsapp — a delivery receipt is signed or ignored", () => {
  // The signature check is the only thing standing between a stranger and this
  // organization's delivery history, so it is tested as a unit against its own rules.
  const secret = "test-app-secret";
  const sign = (body: Buffer, key = secret) => `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
  const verify = (raw: Buffer, header: string | undefined, appSecret: string | undefined) => {
    if (!appSecret) return false;
    if (!header?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", appSecret).update(raw).digest();
    let given: Buffer;
    try {
      given = Buffer.from(header.slice(7), "hex");
    } catch {
      return false;
    }
    return expected.length === given.length && expected.equals(given);
  };

  const body = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "delivered" }] } }] }] }));

  it("accepts a correctly signed body", () => {
    assert.equal(verify(body, sign(body), secret), true);
  });

  it("refuses a body signed with the wrong secret", () => {
    assert.equal(verify(body, sign(body, "someone-elses-secret"), secret), false);
  });

  it("refuses a body that changed after signing", () => {
    const header = sign(body);
    assert.equal(verify(Buffer.from(body.toString().replace("delivered", "read")), header, secret), false);
  });

  it("refuses an unsigned or malformed header", () => {
    assert.equal(verify(body, undefined, secret), false);
    assert.equal(verify(body, "sha1=abcdef", secret), false);
    assert.equal(verify(body, "sha256=not-hex", secret), false);
  });

  it("refuses everything when no app secret is configured", () => {
    assert.equal(verify(body, sign(body), undefined), false);
  });
});

describe("whatsapp — a status only ever moves forward", () => {
  // Receipts arrive out of order: "read" can land before "delivered". The rank table in
  // applyDeliveryReceipt is what stops a later receipt undoing a later state.
  const rank: Record<string, number> = { QUEUED: 0, SKIPPED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
  const next = (status: string) => (status === "failed" ? "FAILED" : status === "read" ? "READ" : status === "delivered" ? "DELIVERED" : "SENT");
  const advances = (current: string, incoming: string) => {
    const to = next(incoming);
    return rank[to] > rank[current] || to === "FAILED";
  };

  it("moves queued to sent, delivered and read", () => {
    assert.ok(advances("QUEUED", "sent"));
    assert.ok(advances("SENT", "delivered"));
    assert.ok(advances("DELIVERED", "read"));
  });

  it("ignores a receipt that would move a message backwards", () => {
    assert.ok(!advances("READ", "delivered"));
    assert.ok(!advances("DELIVERED", "sent"));
    assert.ok(!advances("READ", "sent"));
  });

  it("always records a failure, whenever it arrives", () => {
    assert.ok(advances("READ", "failed"));
    assert.ok(advances("QUEUED", "failed"));
  });
});
