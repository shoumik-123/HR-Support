/**
 * Turning what someone typed into a number a provider will accept.
 *
 * Phone numbers arrive from resumes, from the careers portal and from recruiters typing,
 * which in this market means "01712-345678", "+88 01712 345678", "8801712345678" and
 * "01712345678" all mean the same handset. WhatsApp needs one form: E.164, digits only,
 * with a country code. Anything this cannot place is rejected with a reason, never guessed
 * at - a message to a wrong number is worse than a message not sent.
 */

/** Default country for a local number with no country code. */
const DEFAULT_COUNTRY = "880";

/** Bangladeshi mobile numbers: 01[3-9] then eight digits. */
const BD_MOBILE = /^1[3-9]\d{8}$/;

const BENGALI_DIGITS: Record<string, string> = { "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9" };

export interface PhoneResult {
  /** E.164 with the leading plus, e.g. +8801712345678. */
  e164: string | null;
  /** Why it could not be used, in words a recruiter can act on. */
  reason: string | null;
}

export function normalisePhone(input: string | null | undefined, defaultCountry = DEFAULT_COUNTRY): PhoneResult {
  if (!input || !input.trim()) return { e164: null, reason: "No phone number on file" };

  const hadPlus = input.trim().startsWith("+") || input.trim().startsWith("00");
  const digits = input
    .replace(/[০-৯]/g, (d) => BENGALI_DIGITS[d] ?? d)
    .replace(/^\s*00/, "")
    .replace(/\D/g, "");

  if (!digits) return { e164: null, reason: "That is not a phone number" };
  if (digits.length < 8) return { e164: null, reason: "That number is too short to be a mobile number" };
  if (digits.length > 15) return { e164: null, reason: "That number is too long to be a phone number" };

  // Already a full international number.
  if (hadPlus) return { e164: `+${digits}`, reason: null };

  // 8801712345678 - country code without the plus.
  if (digits.startsWith(defaultCountry) && BD_MOBILE.test(digits.slice(defaultCountry.length))) {
    return { e164: `+${digits}`, reason: null };
  }
  // 01712345678 - the local trunk form.
  if (digits.startsWith("0") && BD_MOBILE.test(digits.slice(1))) {
    return { e164: `+${defaultCountry}${digits.slice(1)}`, reason: null };
  }
  // 1712345678 - someone dropped the leading zero.
  if (BD_MOBILE.test(digits)) return { e164: `+${defaultCountry}${digits}`, reason: null };

  // A landline cannot receive WhatsApp, and saying so is more useful than a failed send.
  if (digits.startsWith("0") && /^[2-9]/.test(digits.slice(1))) {
    return { e164: null, reason: "That looks like a landline; WhatsApp needs a mobile number" };
  }
  return { e164: null, reason: "Could not read that as a mobile number — write it with a country code, e.g. +8801712345678" };
}

/** For display beside a message, so staff can see at a glance which number was used. */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+(880)(1\d)(\d{4})(\d{4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]}-${m[4]}` : e164;
}
