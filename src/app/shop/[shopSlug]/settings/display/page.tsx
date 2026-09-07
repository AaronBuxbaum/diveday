import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { canPersonManageShopSettings } from "@/db/authz";
import { listDisplayTokens } from "@/db/display-tokens";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { DISPLAY_LABEL_MAX_LENGTH } from "@/lib/display-tokens";
import { formatDateTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { DisplayLinksPanel } from "./DisplayLinksPanel";
import type { DisplayLinkCopy, DisplayLinkView } from "./display-panel-types";

// `instant = true` asserts that navigating *into* this page paints
// immediately from another `/shop` page, where the staff shell is already
// mounted and this segment's `loading.tsx` is what paints. See ADR
// 20260804-instant-navigation.
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Lobby display — DiveDay" };

/**
 * **Lobby display** (issue #1426, N-23): the links a shop puts on a TV in the
 * lobby or a tablet on the dock. Owner/manager work, like every other row on
 * the settings hub — a public screen in the shop's room is shop policy — and
 * the store re-checks the same gate when a link is minted.
 */
export default async function LobbyDisplayPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const links = await listDisplayTokens(db, { shopId: session.user.shopId });

  const copy: DisplayLinkCopy = {
    createHeading: t("display.create.heading"),
    labelField: t("display.create.labelField"),
    labelPlaceholder: t("display.create.labelPlaceholder"),
    showNames: t("display.create.showNames"),
    showNamesDescription: t("display.create.showNamesDescription"),
    submit: t("display.create.submit"),
    submitting: t("display.create.submitting"),
    newLinkHeading: t("display.newLink.heading"),
    shownOnce: t("display.newLink.shownOnce"),
    copy: t("display.newLink.copy"),
    copied: t("display.newLink.copied"),
    copyFailed: t("display.newLink.copyFailed"),
    shared: t("display.newLink.shared"),
    listHeading: t("display.list.heading"),
    listEmpty: t("display.list.empty"),
    namesOn: t("display.list.namesOn"),
    namesOff: t("display.list.namesOff"),
    neverShown: t("display.list.neverShown"),
    revoke: t("display.list.revoke"),
    revoking: t("display.list.revoking"),
    confirmRevoke: t("display.list.confirmRevoke"),
    confirmRevokeButton: t("display.list.confirmRevokeButton"),
    cancel: t("display.list.cancel"),
    denied: t("display.notice.denied"),
    invalidLabel: t("display.notice.invalidLabel", { max: DISPLAY_LABEL_MAX_LENGTH }),
    revoked: t("display.notice.revoked"),
  };

  const screens: DisplayLinkView[] = links.map((link) => ({
    id: link.id,
    label: link.label,
    showNames: link.showNames,
    createdLabel: t("display.list.created", {
      when: formatDateTimeTz(link.createdAt, locale, shop.timezone),
    }),
    lastShownLabel: link.lastShownAt
      ? t("display.list.lastShown", {
          when: formatDateTimeTz(link.lastShownAt, locale, shop.timezone),
        })
      : null,
  }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("display.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("display.title")}
        description={t("display.description")}
      />
      <DisplayLinksPanel copy={copy} screens={screens} maxLabelLength={DISPLAY_LABEL_MAX_LENGTH} />
    </main>
  );
}
