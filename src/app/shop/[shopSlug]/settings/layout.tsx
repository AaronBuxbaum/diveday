import { Suspense } from "react";
import { getDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { SettingsSubNav, type SettingsSubNavCopy } from "./_components/SettingsSubNav";
import { SettingsSubNavFallback } from "./_components/SettingsSubNavFallback";
import {
  SETTINGS_DESTINATIONS,
  SETTINGS_GROUPS,
  type SettingsDestinationId,
  type SettingsGroupId,
} from "./settings-destinations";

export const instant = true;

/**
 * Shared sub-nav for every settings surface (surface-consolidation task T3):
 * the hub plus its six full-page surfaces (Team, Website embed, Calendar
 * subscriptions, WhatsApp, Import, Export), which each used to hand-roll their
 * own "Back to settings" button — Website embed twice, once per return branch
 * — and had no way to move sideways between surfaces. Backups was a seventh
 * until it became the second half of Export (ADR 20260806-one-data-out-surface).
 *
 * Unlike `waivers/layout.tsx` and `trips/[id]/layout.tsx` — grandfathered
 * exceptions carved out by ADR 20260803-instant-opt-out-placement's
 * 2026-08-04 amendment — this is a *new* layout, so it follows the plain
 * rule instead (AGENTS.md, ADR 20260804-instant-navigation): no `await`
 * above `{children}`. The shop/locale read that produces the nav's labels
 * lives in `SettingsSubNavLoader` below, an async child inside its own
 * `<Suspense>` with a fallback that holds the nav's height, so every
 * settings route keeps its static shell.
 *
 * Each page below still owns its own `<main>` (the six sub-pages differ on
 * width — Team is `max-w-5xl`, the rest `max-w-3xl` — which a shared `<main>`
 * here would flatten) and still runs its own `requireStaffSession()` plus its
 * own authorization gate. This layout authorizes nothing, same rule as
 * `waivers/layout.tsx`.
 */
export default function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  return (
    <>
      {/* Width and padding live inside the nav (and its fallback), not here:
          the hub's anchor row aligns with the hub's max-w-3xl column while the
          sub-pages' card keeps the wider max-w-5xl rail, and only those
          route-aware client components know which page this is. */}
      <Suspense fallback={<SettingsSubNavFallback />}>
        <SettingsSubNavLoader params={params} />
      </Suspense>
      {children}
    </>
  );
}

async function SettingsSubNavLoader({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  // Staff read the nav in the language their own device asks for, same
  // negotiation as every other staff surface (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  // Labels come from `settings-destinations.ts`'s one registry — every group
  // and every destination — so a group added or a subpage regrouped there
  // shows up here with no separate edit.
  const groupLabels = Object.fromEntries(
    SETTINGS_GROUPS.map((group) => [group.id, t(group.labelKey)]),
  ) as Record<SettingsGroupId, string>;
  const destinationLabels = Object.fromEntries(
    SETTINGS_DESTINATIONS.map((destination) => [destination.id, t(destination.titleKey)]),
  ) as Record<SettingsDestinationId, string>;
  const copy: SettingsSubNavCopy = {
    ariaLabel: t("settings.main.subNav.ariaLabel"),
    hub: t("settings.main.title"),
    groupLabels,
    destinationLabels,
  };
  return <SettingsSubNav shopSlug={shopSlug} copy={copy} />;
}
