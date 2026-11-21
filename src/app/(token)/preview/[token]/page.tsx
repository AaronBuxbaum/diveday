import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { enterPreviewAction } from "@/app/actions/demo";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import {
  findPreview,
  previewIdFrom,
  previewIsOpen,
  recordPreviewFetch,
} from "@/features/demo/demo-preview";
import { isQuietDemoDevice, QUIET_DEMO_COOKIE } from "@/features/demo/quiet-demo-device";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { OpenOnArrival } from "./_components/OpenOnArrival";

export const metadata: Metadata = {
  title: "Your preview — DiveDay",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// `instant = true`: every request-scoped read below sits inside this segment's
// `loading.tsx` boundary. See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * The page a prospect's preview link opens (ADR 20261116-demo-previews). It
 * says whose preview this is and who built it, then enters the shop from the
 * browser. Requesting it is counted as a fetch and is never an open: a mail
 * scanner requests every link in a message.
 *
 * A week-old link, a shop the reaper has taken, and an id that never existed
 * all read the same: the preview has ended.
 */
export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  // First: everything below is request-time, which the clock read needs.
  await connection();
  const { token } = await params;
  const quiet = isQuietDemoDevice((await cookies()).get(QUIET_DEMO_COOKIE)?.value);
  const t = diverTranslator(await requestLocale());
  const id = previewIdFrom(token);
  const db = await getDb();
  const preview = id ? await findPreview(db, id) : null;
  const shop =
    preview && previewIsOpen(preview, nowDate()) ? await getShopBySlug(db, preview.shopSlug) : null;

  if (!preview || !shop?.isDemo || shop.id !== preview.demoShopId) {
    return (
      <div className="flex flex-1 flex-col">
        <EntryDone
          wordmark
          homeLink
          glyph="expired"
          title={t("demoPreview.endedTitle")}
          text={t("demoPreview.ended")}
          action={
            <Link href="/" className="font-medium text-primary hover:underline">
              {t("demoPreview.home")}
            </Link>
          }
        />
      </div>
    );
  }

  if (!quiet) await recordPreviewFetch(db, preview.id);

  return (
    <div className="flex flex-1 flex-col">
      <EntryShell
        wordmark
        title={t("demoPreview.title", { shop: preview.prospectName })}
        description={t("demoPreview.description")}
      >
        <form action={enterPreviewAction} className="flex flex-col gap-4">
          <input type="hidden" name="preview" value={preview.id} />
          <SubmitButton pendingLabel={t("words.busy.opening")} className={buttonClass()}>
            {t("demoPreview.submit")}
          </SubmitButton>
          <OpenOnArrival />
        </form>
      </EntryShell>
    </div>
  );
}
