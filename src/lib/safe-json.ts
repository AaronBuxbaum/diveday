/**
 * `JSON.parse` that answers null instead of throwing.
 *
 * Every list the dive-site form posts — waypoints, landmarks, field-guide
 * species — rides in a hidden input as one JSON string, and each module that
 * reads one starts by parsing it; the WhatsApp Graph API clients read every
 * response body through it too. Copies of this four-line `try` kept
 * accumulating beside each new caller, which is exactly how they quietly stop
 * agreeing on what malformed input means.
 *
 * Null, not `{}` or a throw: every caller's next move is the same shape check
 * it would run on any other untrusted value ("is this an array?"), and null
 * fails that check the same way `"banana"` does. A parser that threw would make
 * a corrupt hidden input a 500 on a form the staffer could otherwise fix.
 */
export function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
