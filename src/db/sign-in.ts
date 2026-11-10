/** Authentication proof entrypoints; both feed the same second-factor/session transition. */
export { startMagicSignIn } from "./magic-sign-in";
export { startPasskeySignIn } from "./passkeys";
export {
  cancelPendingSignIn,
  completePendingSignIn,
  startCredentialSignIn,
} from "./sign-in-challenges";
