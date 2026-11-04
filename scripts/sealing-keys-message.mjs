/**
 * The words `scripts/check-sealing-keys.ts` fails a production deploy with
 * (issue #2999), apart so a test can hold them. They name the variables and a
 * count of accounts, never a key, a fingerprint or an account, and they give
 * the two supported ways back. There is no bypass flag on purpose: a two-factor
 * account the keys cannot open is locked out at its next sign-in, so the way
 * past this check is to make the keys open it, or to reset its two-factor.
 *
 * What it covers: each enabled two-factor secret (trial-opened) and the key
 * its recovery codes were hashed under (fingerprint), and (issue #3022) one
 * stored value each of a WhatsApp token, a connector's credentials and a backup
 * destination's access key. Those three break their integration rather than
 * sign-in, and the words say which kinds, never which shop.
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

const KIND_WORDS = {
  whatsapp: "a WhatsApp access token",
  connector: "a connector's credentials",
  backup: "a backup destination's access key",
};

/**
 * The words for a sampled sealed value that no key opens (issue #3022): the
 * kinds by name, never a row or a shop. The fix is the same pair of variables.
 *
 * @param {{ reason: "previous_missing" | "keys_do_not_open", unopened: Array<"whatsapp" | "connector" | "backup"> }} result
 * @returns {string}
 */
export function sealedSamplesFailureText(result) {
  const kinds = result.unopened.map((kind) => KIND_WORDS[kind]).join(", ");
  const cause =
    result.reason === "previous_missing"
      ? `${CURRENT} cannot open ${kinds}, and ${PREVIOUS} is not set: the key was rotated without moving the old value across, or the old key was retired while stored secrets still need it.`
      : `Neither ${CURRENT} nor ${PREVIOUS} opens ${kinds}, so ${PREVIOUS} is probably not the key ${CURRENT} replaced.`;
  return `FAILED. ${cause} To recover, set ${PREVIOUS} to the old key on the Vercel project and redeploy. To retire that key anyway, have the shops reconnect those integrations first, then redeploy. Until one of those is done, the integrations cannot send.`;
}
