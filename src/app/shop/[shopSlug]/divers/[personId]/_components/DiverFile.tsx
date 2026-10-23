import type { personThread } from "@/db/inbound-messages";
import type { LastKnownDive } from "@/db/last-dive";
import type { listDiverRecordNotes, pagedDiverActivity } from "@/db/operations";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { DiverNotice } from "@/lib/diver-notices";
import type { splitDiverStatus } from "@/lib/diver-status";
import { noticeForForm } from "@/lib/staff-notices";
import { counterRentalFormPath } from "../../../gear/rentals/rental-form";
import type { loadDiverGear } from "../_lib/gear-load";
import { ActivitySection } from "./ActivitySection";
import { CertificationsGroup } from "./CertificationsGroup";
import { ConversationWithAssists } from "./ConversationWithAssists";
import { DiverDetailsGroup } from "./DiverDetailsGroup";
import { DiverNotesSection } from "./DiverNotesSection";
import { GearAndSizes } from "./GearAndSizes";
import { LastDiveGroup } from "./LastDiveGroup";
import type { DiverProfile, Shop } from "./shared";
import { WaiverGroup } from "./WaiverGroup";
import { WorkOrdersGroup } from "./WorkOrdersGroup";

/**
 * **The diver's file**: every group on the record between the masthead and
 * the story, as one list. Each group is a row that shares its hairline with
 * the next (`DiverFileGroupDisclosure`), so they stack flush rather than on
 * the page's section rhythm. Moved out of the route file when the Last dive
 * row joined it, so the page stays the composition and this stays the order.
 */
export function DiverFile({
  diver,
  shop,
  shopSlug,
  personId,
  locale,
  t,
  now,
  removed,
  edit,
  notice,
  statuses,
  gaps,
  gates,
  gear,
  thread,
  notes,
  activityPage,
  lastDive,
}: {
  diver: DiverProfile;
  shop: Shop;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  now: Date;
  removed: boolean;
  edit?: string;
  /** The page's `?notice=`, resolved once; each group takes its own. */
  notice: DiverNotice | undefined;
  /** The three notices the page already split out for its own reasons. */
  statuses: { cards?: DiverNotice; details?: DiverNotice; notes?: DiverNotice };
  gaps: ReturnType<typeof splitDiverStatus>;
  gates: { canOpenClearance: boolean; canOverrideFit: boolean };
  gear: Awaited<ReturnType<typeof loadDiverGear>>;
  thread: Awaited<ReturnType<typeof personThread>>;
  notes: Awaited<ReturnType<typeof listDiverRecordNotes>>;
  activityPage: Awaited<ReturnType<typeof pagedDiverActivity>>;
  lastDive: LastKnownDive;
}) {
  return (
    <div>
      {/* **The gates first, worst first.** Waiver (medical holds live
          here), then cards, then who to call: the order a gap that keeps
          a diver off the boat is ranked in (glossary — readiness), so the
          first red under the masthead is the one that matters most. */}
      <WaiverGroup
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        t={t}
        timezone={shop.timezone}
        canOpenClearance={gates.canOpenClearance}
        status={noticeForForm(notice, "waiver")}
        gap={gaps.file.waiver}
      />
      <CertificationsGroup
        diver={diver}
        shop={shop}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        t={t}
        status={statuses.cards}
        gap={gaps.file.certification}
        canAssist={gear.canAssist}
      />
      {/* When they last dived, beside what they are certified to do:
          the two facts a desk reads before it sells a deep dive. */}
      <LastDiveGroup
        diver={diver}
        known={lastDive}
        shopSlug={shopSlug}
        personId={personId}
        today={calendarDateInTimezone(now, shop.timezone)}
        timezoneDay={(date) => calendarDateInTimezone(date, shop.timezone)}
        locale={locale}
        t={t}
        removed={removed}
        status={noticeForForm(notice, "last-dive")}
      />
      <DiverDetailsGroup
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        t={t}
        locale={locale}
        timezone={shop.timezone}
        country={shop.addressCountry}
        status={statuses.details}
        gap={gaps.file.contact}
        // \`edit=1\` is only ever set by the roster's "Add a diver" form, which
        // lands here with a name and little else. \`FlashParams\` strips it
        // from the URL straight away, so a reload or a shared link is the
        // ordinary collapsed page. A refused save keeps the group open so the
        // staffer can correct the fields in place.
        open={edit === "1" || statuses.details?.tone === "danger"}
      />
      {/* What the diver said, after the paperwork that decides whether
        they board. Renders nothing for a diver who has never written. */}
      <ConversationWithAssists
        entries={thread}
        diverName={diver.person.fullName}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        timezone={shop.timezone}
        now={now}
        // `removed` alone, never `removed || anonymizedAt`: the CHECK
        // `people_anonymized_stays_removed` makes an anonymized person removed
        // by construction, so the second term could never add a case.
        removed={removed}
        t={t}
        status={noticeForForm(notice, "reply")}
      />
      <GearAndSizes
        diver={diver}
        shopSlug={shopSlug}
        personId={personId}
        rentalItems={shop.rentalItems}
        counterRentals={gear.counterRentals}
        rentGearHref={gear.hasFleet ? counterRentalFormPath(shopSlug, { personId }) : undefined}
        canOverride={gates.canOverrideFit}
        locale={locale}
        t={t}
        status={noticeForForm(notice, "fit")}
        canAssist={gear.canAssist}
      />
      <WorkOrdersGroup
        shopSlug={shop.slug}
        timezone={shop.timezone}
        reminders={gear.reminders}
        personId={personId}
        pieces={gear.ownPieces}
        orders={gear.workOrders}
        locale={locale}
        t={t}
        status={noticeForForm(notice, "work-orders")}
      />
      <DiverNotesSection
        notes={notes}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        timezone={shop.timezone}
        t={t}
        status={statuses.notes}
      />
      <ActivitySection
        page={activityPage}
        shopSlug={shopSlug}
        personId={personId}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />
    </div>
  );
}
