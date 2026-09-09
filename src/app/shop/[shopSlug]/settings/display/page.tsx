import type { Metadata } from "next";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions, FieldGrid } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonManageShopSettings } from "@/db/authz";
import { listDisplayTokens } from "@/db/display-tokens";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { DISPLAY_LABEL_MAX_LENGTH } from "@/lib/display-tokens";
import { formatDateTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { savePublicBoatLineAction, saveYearOnDivedayAction } from "./actions";
import { DisplayLinksPanel } from "./DisplayLinksPanel";
import type { DisplayLinkCopy, DisplayLinkView } from "./display-panel-types";
import { WorldPanel } from "./WorldPanel";

/**
 * What the year switch says back. Resolved through `noticeFromParam` and never
 * a bare index: the parameter is attacker-supplied.
 */
/** Names the year section and the form inside it — see the render for why. */
const YEAR_SECTION_ID = "year-on-diveday";

const YEAR_NOTICES: Record<string, { tone: NoticeTone; text: StaffMessageKey }> = {
  "year-on-diveday": { tone: "success", text: "display.year.noticeOn" },
  "year-off-diveday": { tone: "success", text: "display.year.noticeOff" },
  "display-not-authorized": { tone: "warning", text: "display.notice.denied" },
};

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
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const links = await listDisplayTokens(db, { shopId: session.user.shopId });
  const yearNotice = noticeFromParam(notice, YEAR_NOTICES);

  const copy: DisplayLinkCopy = {
    createHeading: t("display.create.heading"),
    labelField: t("display.create.labelField"),
    labelPlaceholder: t("display.create.labelPlaceholder"),
    purposeLegend: t("display.create.purposeLegend"),
    purposeBoard: t("display.create.purposeBoard"),
    purposeCheckIn: t("display.create.purposeCheckIn"),
    purposeCheckInDescription: t("display.create.purposeCheckInDescription"),
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
    purposeLabel: t(
      link.purpose === "check_in" ? "display.create.purposeCheckIn" : "display.create.purposeBoard",
    ),
    // Only a board link has a names setting to report. A kiosk names exactly
    // one diver, to that diver, and saying "Nobody named" beside it would
    // describe a switch it does not have.
    showNamesLabel:
      link.purpose === "check_in"
        ? null
        : link.showNames
          ? t("display.list.namesOn")
          : t("display.list.namesOff"),
    createdLabel: t("display.list.created", {
      when: formatDateTimeTz(link.createdAt, locale, shop.timezone),
    }),
    lastShownLabel: link.lastShownAt
      ? t("display.list.lastShown", {
          when: formatDateTimeTz(link.lastShownAt, locale, shop.timezone),
        })
      : null,
    revokeLabel: t("display.list.revokeNamed", { label: link.label }),
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
      {/* **What the world can see** (ADR 20260908-one-hand, decision 6, lever
          U). Below the screens rather than above them: the page's own subject
          is the links a shop puts on its own walls, and this is the one row
          about what leaves the building. */}
      <WorldPanel
        action={savePublicBoatLineAction}
        on={shop.publicBoatLine}
        copy={{
          heading: t("display.world.heading"),
          rowHeading: t("display.world.boatLine.heading"),
          detail: t("display.world.boatLine.detail"),
          label: t("display.world.boatLine.label"),
          valueOn: t("display.world.boatLine.valueOn"),
          valueOff: t("display.world.boatLine.valueOff"),
          submit: t("display.world.boatLine.submit"),
          submitting: t("display.world.boatLine.submitting"),
        }}
      />

      {/*
        **What the shop shows the world, on the page about screens the shop
        puts things on** (ADR 20260908-one-hand, decision 6, lever T). The
        sentence under the heading names exactly what leaves: the year card,
        and no money on it. Off until an owner says otherwise — DiveDay's
        homepage carries a real shop's card only with that shop's yes, which is
        the whole of H-71 (k).
      */}
      {/*
        **The form carries its own name**, from the heading above it, because
        this page holds more than one form with a Save button on it: an
        unqualified "Save" is ambiguous to a screen reader reading the page's
        controls, and to anything else addressing them one at a time.
      */}
      <SectionCard as="section" className="mt-10 p-5 sm:p-6">
        <h2 id={YEAR_SECTION_ID} className={SECTION_TITLE_CLASS}>
          {t("display.year.heading")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("display.year.description")}</p>
        {yearNotice ? (
          <ShopNotice tone={yearNotice.tone} className="mt-4">
            {t(yearNotice.text)}
          </ShopNotice>
        ) : null}
        <FieldGrid
          as="form"
          action={saveYearOnDivedayAction}
          columns={1}
          className="mt-4"
          aria-labelledby={YEAR_SECTION_ID}
        >
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              name="showYearOnDiveday"
              type="checkbox"
              defaultChecked={shop.showYearOnDiveday}
              className="size-4 accent-primary"
            />
            {t("display.year.label")}
          </label>
          <p className="text-sm text-muted">{t("display.year.detail")}</p>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("display.year.submitting")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("display.year.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </SectionCard>
    </main>
  );
}
