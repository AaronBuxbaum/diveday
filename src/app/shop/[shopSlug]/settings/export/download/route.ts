import { getDb } from "@/db/client";
import { canPersonExportShopData, loadShopExportBundleInput } from "@/db/export";
import { recordMedicalAnswersExported } from "@/db/operations";
import { stepUpChallengeUrl } from "@/features/security-step-up";
import { requireStaffSession } from "@/features/session";
import { hasRequiredStepUp } from "@/features/step-up";
import { nowDate } from "@/lib/clock";
import {
  buildExportBundle,
  ExportResourceLimitError,
  exportFileName,
  exportMediaFiles,
  fetchExportPhotos,
  zipExportBundle,
} from "@/lib/export";

/**
 * Returns the full-shop export ZIP (ADR 20260722-full-shop-export). The shop
 * comes from the session, never the URL — and because the bundle carries the
 * whole roster's contact details and signed medical evidence, it is gated to
 * owner/manager, re-checked against the database rather than the session's
 * JWT so a demoted or disabled manager loses access immediately.
 */
export async function GET(request: Request) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    return new Response("The data export is limited to the shop's owner or manager.", {
      status: 403,
    });
  }
  const returnTo = new URL(request.url).pathname;
  if (!(await hasRequiredStepUp(db, session, "export"))) {
    return Response.redirect(
      new URL(stepUpChallengeUrl(session.user.shopSlug, "export", returnTo), request.url),
      303,
    );
  }
  const now = nowDate();
  const input = await loadShopExportBundleInput(db, session.user.shopId, now);
  if (!input) return new Response("Shop not found", { status: 404 });

  // The file hands out every release's medical answers at once, so each
  // diver's trail says so first (issue #2618). Not swallowed: no line, no ZIP.
  await recordMedicalAnswersExported(db, {
    shopId: session.user.shopId,
    actorPersonId: session.user.personId,
    personIds: input.medicalAnswerPersonIds,
  });

  const photos = await fetchExportPhotos(input.photoUrls);
  const files = [...buildExportBundle(input, now), ...exportMediaFiles(photos)];
  let zip: Uint8Array;
  try {
    zip = zipExportBundle(files);
  } catch (error) {
    if (!(error instanceof ExportResourceLimitError)) throw error;
    return Response.json(
      { error: "export_resource_limit" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  const fileName = exportFileName(input.shopSlug, now, input.timezone);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
