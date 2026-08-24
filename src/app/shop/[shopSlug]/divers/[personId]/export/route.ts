import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { canPersonExportShopData, loadDiverExportBundleInput } from "@/db/export";
import { recordDiverActivity } from "@/db/operations";
import { nowDate } from "@/lib/clock";
import {
  buildDiverExportBundle,
  diverExportFileName,
  fetchExportPhotos,
  zipExportBundle,
} from "@/lib/export";
import { requireStaffSession } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

/**
 * One diver's own record, as a ZIP — the subject-access-request answer #726
 * asked for. Same shape as `settings/export/download` (ADR
 * 20260722-full-shop-export), same gate (`canPersonExportShopData` — see that
 * function's own doc for why this is a database re-check rather than a role
 * read off the session token), scoped to one `person_id` instead of the whole
 * shop. See `loadDiverExportBundleInput` (src/db/export.ts) for what is
 * included, what is deliberately withheld, and why.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string; personId: string }> },
) {
  const { personId } = await params;
  if (!uuidParam(personId)) return new NextResponse("Not found", { status: 404 });

  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    return new Response("The data export is limited to the shop's owner or manager.", {
      status: 403,
    });
  }

  const now = nowDate();
  const input = await loadDiverExportBundleInput(db, session.user.shopId, personId, now);
  if (!input) return new NextResponse("Diver not found", { status: 404 });

  const photos = await fetchExportPhotos(input.photoUrls);
  const files = [
    ...buildDiverExportBundle(input, now),
    ...photos.map((photo) => ({ name: photo.path, content: photo.bytes })),
  ];
  const zip = zipExportBundle(files);
  const fileName = diverExportFileName(input.shopSlug, personId, now, input.timezone);

  // Recorded so a shop can show it responded to a subject-access request, and
  // when — the same reason every other consequential diver action writes to
  // this trail.
  await recordDiverActivity(db, {
    shopId: session.user.shopId,
    personId,
    actorPersonId: session.user.personId,
    action: "downloaded a copy of",
  });

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
