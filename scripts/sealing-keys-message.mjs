/**
 * The words `scripts/check-sealing-keys.ts` fails a production deploy with
 * (issue #2999), apart so a test can hold them. They name the variables and a
 * count of accounts, never a key, a fingerprint or an account, and they give
 * the two supported ways back. There is no bypass flag on purpose: a two-factor
 * account the keys cannot open is locked out at its next sign-in, so the way
 * past this check is to make the keys open it, or to reset its two-factor.
 *
 * What it covers: each enabled two-factor secret (trial-opened) and the key
 * its recovery codes were hashed under (fingerprint). WhatsApp tokens,
 * connector credentials, backup destinations and the other sealed values are
 * not checked; they degrade rather than lock anyone out.
 */

const CURRENT = "SECRET_ENCRYPTION_KEY";
const PREVIOUS = "SECRET_ENCRYPTION_KEY_PREVIOUS";

/**
 * @param {{ reason: "previous_missing" | "keys_do_not_open", checked: number, lockedOut: number }} result
 * @returns {string}
 */
export function sealingKeysFailureText(result) {
  const accounts = `${result.lockedOut} of ${result.checked} two-factor account(s)`;
  const cause =
    result.reason === "previous_missing"
      ? `${CURRENT} cannot open the two-factor secrets or recovery codes of ${accounts}, and ${PREVIOUS} is not set: the key was rotated without moving the old value across, or the old key was retired while accounts still need it.`
      : `Neither ${CURRENT} nor ${PREVIOUS} opens the two-factor secrets or recovery codes of ${accounts}, so ${PREVIOUS} is probably not the key ${CURRENT} replaced.`;
  return `FAILED. ${cause} To recover, set ${PREVIOUS} to the old key on the Vercel project and redeploy. To retire that key anyway, have those accounts turn two-factor off and on again (or reset it for them) first, then redeploy. Until one of those is done, they cannot sign in with two-factor.`;
}
