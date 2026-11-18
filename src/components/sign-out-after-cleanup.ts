import { markDeviceCleanupIncomplete } from "./device-cleanup-warning";
import { forgetThisDevice } from "./forget-device";

/** Always sign out; a cleanup error only controls the generic warning flag. */
export async function signOutAfterCleanup(action: (incomplete?: boolean) => Promise<void>) {
  let incomplete = true;
  try {
    incomplete = !(await forgetThisDevice()).offlineSensitiveCleanupReportedComplete;
  } catch {
    markDeviceCleanupIncomplete();
  }
  await action(incomplete);
}
