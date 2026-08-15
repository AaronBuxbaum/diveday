"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";
import { getShopById } from "@/db/shops";
import {
  disconnectShopBackupDestination,
  runShopBackup,
  type SaveBackupDestinationRefusal,
  saveShopBackupDestination,
} from "@/features/backup-export";
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/**
 * Configure, test, and disconnect a shop's backup destination (docs ADR
 * 20260804-shop-owned-backup-export).
 *
 * These live beside the export page because scheduled delivery *is* the export
 * bundle on a schedule — one surface, `/settings/export`, since ADR
 * 20260806-one-data-out-surface. `/settings/backup` is a 308 to it.
 *
 * Two rules run through all three actions, the same two as the WhatsApp
 * settings beside them. The gate is re-checked against live roles on every
 * mutation — this surface configures a continuous export of the whole shop,
 * medical evidence included, so it holds the same owner/manager bar as the
 * export download, checked in the database rather than the JWT. And the
 * secret access key travels one way only: in through the form, sealed
 * straight into the row, and never back out to a response, a redirect
 * parameter, or a log line.
 */

/**
 * Notices are codes; `page.tsx` picks the words (ADR 20260731-domain-layer-copy-leaks).
 *
 * Spelled lower-case kebab, because on this page the code *is* the message-bundle
 * key — the banner renders `backup.notice.<code>` — so a fork between the two
 * spellings shows a staffer nothing at all (src/lib/staff-notices.ts).
 */
type Notice =
  | "saved"
  | "invalid"
  | "endpoint-invalid"
  | "endpoint-not-https"
  | "endpoint-private-host"
  | "secret-required"
  | "encryption-key-unset"
  | "encryption-key-invalid"
  | "disconnected"
  | "test-delivered"
  | "test-failed"
  | "no-destination";

const destinationSchema = z.object({
  endpoint: z.string().trim().min(1).max(500),
  region: z.string().trim().min(1).max(100),
  bucket: z.string().trim().min(1).max(200),
  prefix: z.string().trim().max(200).optional(),
  accessKeyId: z.string().trim().min(1).max(200),
  // Optional: blank on an update means "keep the stored secret" — the form
  // never echoes it back, so blank must not mean "erase".
  secretAccessKey: z.string().max(500).optional(),
});

async function backupContext(): Promise<{
  shopId: string;
  personId: string;
  shopSlug: string;
  path: string;
}> {
  const session = await requireStaffSession();
  return {
    shopId: session.user.shopId,
    personId: session.user.personId,
    shopSlug: session.user.shopSlug,
    path: shopPath(session.user.shopSlug, "settings", "export"),
  };
}

/**
 * `SaveBackupDestinationRefusal` rides along beside `Notice` because the feature
 * module answers in its own snake_case domain spelling; `noticeUrl` normalises
 * it to the kebab the bundle key uses, so the refusal arrives worded rather than
 * silent. `reason` is a delivery error code, not a notice — it keeps its own
 * spelling (`backup.deliveryError.<code>`) and simply drops out when absent.
 */
function done(path: string, notice: Notice | SaveBackupDestinationRefusal, reason?: string): never {
  revalidateAndRedirect(path, noticeUrl(path, notice, { reason }));
}

export async function saveBackupDestinationAction(formData: FormData): Promise<void> {
  const { shopId, personId, shopSlug, path } = await backupContext();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, shopId, personId))) {
    redirect(noticeUrl(shopPath(shopSlug), "backup-not-authorized"));
  }

  const parsed = destinationSchema.safeParse({
    endpoint: formData.get("endpoint") ?? "",
    region: formData.get("region") ?? "",
    bucket: formData.get("bucket") ?? "",
    prefix: formData.get("prefix") ?? "",
    accessKeyId: formData.get("accessKeyId") ?? "",
    secretAccessKey: formData.get("secretAccessKey") ?? "",
  });
  if (!parsed.success) done(path, "invalid");

  const result = await saveShopBackupDestination(db, { shopId, ...parsed.data });
  if (result.status === "refused") done(path, result.reason);
  done(path, "saved");
}

/**
 * Run a real backup right now — the same bundle, the same upload path the
 * weekly cron takes — so "is this bucket actually reachable with this key"
 * is answered by a delivery row, not by hope. The outcome lands in the
 * history either way; the notice just saves a scroll.
 */
export async function testBackupAction(): Promise<void> {
  const { shopId, personId, shopSlug, path } = await backupContext();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, shopId, personId))) {
    redirect(noticeUrl(shopPath(shopSlug), "backup-not-authorized"));
  }

  const shop = await getShopById(db, shopId);
  const t = staffTranslator(toDiverLocale(shop?.defaultLocale));
  // Server configuration, never a request header (src/lib/notifications/app-url.ts);
  // the loopback fallback only exists for local dev, where APP_HOST is unset.
  const origin = publicAppUrl() ?? "http://localhost:3000";

  const result = await runShopBackup(db, {
    shopId,
    trigger: "manual",
    origin,
    icsLabels: {
      calendarName: t("feed.shopTripsName", { shop: shop?.slug ?? "" }),
      crew: t("feed.crew"),
      course: t("feed.course"),
      day: (dayNumber) => t("feed.day", { number: dayNumber }),
    },
  });

  if (result.status === "delivered") done(path, "test-delivered");
  if (result.status === "failed") done(path, "test-failed", result.errorCode);
  done(path, "no-destination");
}

export async function disconnectBackupAction(): Promise<void> {
  const { shopId, personId, shopSlug, path } = await backupContext();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, shopId, personId))) {
    redirect(noticeUrl(shopPath(shopSlug), "backup-not-authorized"));
  }
  await disconnectShopBackupDestination(db, shopId);
  done(path, "disconnected");
}
