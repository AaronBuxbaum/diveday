import { reportAgencyCheckPageAction } from "@/app/actions/agency-check-report";
import { type ExtensionCheckReply, extensionVersion } from "@/lib/cert-check-extension";

/**
 * Tell DiveDay's log why a check the extension could not finish ended: the
 * agency, the fixed reason, the extension's version and the page's shape,
 * form words only (`src/lib/page-shape.ts`). Fire and forget: the staffer's
 * sentence does not wait on it, and a report that does not arrive changes
 * nothing. A signed-out PADI check is the staffer's sign-in, not the page,
 * and sends nothing.
 */
export function reportFailedCheck(
  agency: string,
  reply: Extract<ExtensionCheckReply, { ok: false }>,
): void {
  if (reply.reason === "signed_out" || reply.reason === "manual_opened") return;
  const formData = new FormData();
  formData.set("agency", agency);
  formData.set("reason", reply.reason);
  formData.set("version", extensionVersion() ?? "");
  if (reply.pageShape) formData.set("pageShape", JSON.stringify(reply.pageShape));
  void reportAgencyCheckPageAction(formData).catch(() => {});
}
