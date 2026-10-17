import { forgetAllKeptTyped } from "./KeepTypedOnRefusal";
import { forgetAllRecents } from "./search/palette-recents";

/**
 * **A shared device keeps nothing of the last staffer** (security review F2,
 * N1): ⌘K's recents and any form kept for a refusal. Run by both sign-out
 * doors and by the sign-in page, where every ended session lands (expiry, a
 * disabled account, a sign-out elsewhere), so the clear does not depend on
 * somebody pressing Sign out.
 */
export function forgetThisDevice(): void {
  forgetAllRecents();
  forgetAllKeptTyped();
}
