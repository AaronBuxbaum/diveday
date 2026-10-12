import Link from "next/link";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { getDb } from "@/db/client";
import type { getStaffingView } from "@/db/staffing";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { crewWarningLines } from "./crew-warning-lines";

/**
 * **The week's crew warnings** (batch 4, D3): a departure with nobody first-aid
 * ready aboard, a person on a long day, an expired credential on somebody
 * crewing. They inform and never block, so this is a quiet list above the week
 * rather than a mark inside a cell, and it renders nothing when there is
 * nothing to say. Reads the credentials itself, so the page passes only what
 * it already holds.
 */
export async function StaffingWarnings({
  shop,
  shopSlug,
  view,
  locale,
}: {
  shop: { id: string; timezone: string };
  shopSlug: string;
  view: Awaited<ReturnType<typeof getStaffingView>>;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const lines = await crewWarningLines({
    db: await getDb(),
    shopId: shop.id,
    shopSlug,
    view,
    now: nowDate(),
    t,
    locale,
    timeZone: shop.timezone,
  });
  if (lines.length === 0) return null;
  return (
    <section
      aria-labelledby="staffing-warnings-heading"
      className={`mb-6 ${TONE_PANEL_CLASS} border-warning/40 bg-warning/10`}
      data-testid="staffing-warnings"
    >
      <h2 id="staffing-warnings-heading" className="text-base font-semibold">
        {t("desk.staffingWarnings.heading")}
      </h2>
      <ul className="mt-2 space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line.key}>
            {line.href ? (
              <Link href={line.href} className="underline-offset-2 hover:underline">
                {line.text}
              </Link>
            ) : (
              line.text
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
