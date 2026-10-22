import { getDb } from "@/db/client";
import {
  claimSetupRequestReceipt,
  finishSetupRequestReceipt,
  readClaimedSetupRequestReceipt,
} from "@/db/setup-request-receipts";
import { log } from "@/lib/log";
import { notificationProviderFromEnvironment, notify, recipientLocale } from "@/lib/notifications";
import { type SetupReceiptOutcome, setupReceiptOutcome } from "@/lib/setup-request-receipts";

/**
 * Server-only after-work, invoked by the setup request action: never add "use server" or expose a
 * resend/lookup endpoint. The only argument is a saved ID, never a recipient,
 * request row, sender, or body override. The claim commits before SES starts.
 * Erasure before the final read cancels mail; erasure after handing mail to SES
 * cannot recall it. Neither a failure nor an ambiguous acceptance is retried.
 */
export async function sendSetupRequestReceipt(id: string): Promise<void> {
  try {
    const db = await getDb();
    if (!(await claimSetupRequestReceipt(db, id))) return;
    const request = await readClaimedSetupRequestReceipt(db, id);
    if (!request) return;
    let outcome: SetupReceiptOutcome;
    try {
      const delivery = await notify(
        {
          kind: "setup_request_receipt",
          setupRequestId: id,
          to: request.email,
          locale: recipientLocale(request.locale, undefined),
        },
        notificationProviderFromEnvironment(process.env, { maxAttempts: 1 }),
      );
      outcome = setupReceiptOutcome(delivery);
    } catch {
      outcome = { status: "unknown", errorCode: "send_exception" };
    }
    await finishSetupRequestReceipt(db, id, outcome);
    log("setup_request.receipt_outcome", outcome.status === "accepted" ? "info" : "warn", {
      requestId: id,
      state: outcome.status,
      errorCode: outcome.status === "accepted" ? undefined : outcome.errorCode,
    });
  } catch {
    // A lost final write leaves a claimed row for support. Never log thrown
    // names/messages: even error.name can contain an address or capability.
    log("setup_request.receipt_unresolved", "warn", { requestId: id, errorCode: "storage_error" });
  }
}
