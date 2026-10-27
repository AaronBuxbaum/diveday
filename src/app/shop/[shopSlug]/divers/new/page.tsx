import type { Metadata } from "next";
import Link from "next/link";
import { bindFormDraft, draftForForm } from "@/app/actions/form-draft-props";
import { seatExistingDiverAction } from "@/app/actions/seat-diver";
import { SEAT_SURFACES, type SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { addToWaitlistAction } from "@/app/shop/[shopSlug]/trips/[id]/roster-seating-actions";
import { FormDraft } from "@/components/FormDraft";
import { formDraftCopy } from "@/components/form-draft-copy";
import { KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { keptTypedScope } from "@/components/kept-typed-scope";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { NameMatchCandidateFacts } from "@/components/seat-diver/NameMatchCandidateFacts";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions } from "@/components/ui/form";
import { findSimilarDivers } from "@/db/divers";
import { readFormDraft } from "@/db/form-drafts";
import { staffParticipantTypeLabel } from "@/i18n/participant-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { maxPlausibleBirthDate } from "@/lib/age";
import { noDiveDayNeedsSaying } from "@/lib/name-match-evidence";
import { PARTICIPANT_TYPES } from "@/lib/participant-types";
import { diverSearchPrefill } from "@/lib/person-fields";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { WALK_IN_FIRST_ROW, WALK_IN_PARTY_FORM, WALK_IN_PARTY_MAX } from "@/lib/walk-in-party";
import { PartyOnFileChoices, type PartyOnFileRow } from "./_components/PartyOnFileChoices";
import { WalkInPartyRows } from "./_components/WalkInPartyRows";
import { type WalkInExtrasCopy, WalkInPersonExtras } from "./_components/WalkInPersonExtras";
import { createDiverFormAction } from "./actions";

export const instant = true;

export const metadata: Metadata = { title: "Add diver — DiveDay" };

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  duplicate: { tone: "danger", key: "divers.page.noticeDuplicate" },
  invalid: { tone: "danger", key: "divers.page.noticeInvalid" },
  "diver-full": { tone: "danger", key: "trips.notices.diverFull" },
  "diver-divers-full": { tone: "danger", key: "participants.notices.diversFull" },
  "diver-type-unavailable": { tone: "danger", key: "participants.notices.typeUnavailable" },
  "diver-already": { tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-trip-prerequisite": { tone: "danger", key: "trips.notices.diverTripPrerequisite" },
  "diver-unavailable": { tone: "danger", key: "trips.notices.diverUnavailable" },
  "diver-invalid": { tone: "danger", key: "divers.page.noticeInvalid" },
  "seat-busy": { tone: "danger", key: "seatDiver.busy" },
  // A walk-in party with names that read like somebody on file (fifth loop,
  // item 9): each such row is settled on its own, below.
  "party-on-file": { tone: "danger", key: "divers.page.partyOnFile" },
};

export default async function NewDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    q?: string;
    name?: string;
    email?: string;
    phone?: string;
    surface?: string;
    /** `true`: the departure door's counter mode (a walk-in on a boat that has not left). */
    walkIn?: string;
    tripId?: string;
    waitlist?: string;
    request?: string;
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
    /** `onFile-<row>`: a party row the on-file check stopped on, by the name typed. */
    [onFile: `onFile-${number}`]: string | undefined;
  }>;
}) {
  const { shopSlug } = await params;
  const {
    notice,
    q,
    name,
    email,
    phone,
    surface: surfaceParam,
    walkIn: walkInParam,
    tripId: tripIdParam,
    waitlist: waitlistParam,
    request: requestParam,
    confirmName,
    confirmEmail,
    confirmPhone,
    ...rest
  } = await searchParams;

  const { db, shop, session } = await requireShopSurface(shopSlug);
  const draftBinding = bindFormDraft(session.user);
  const keptScope = keptTypedScope(shopSlug, session.user.personId);

  const locale = await requestLocale(shop.defaultLocale);
  // What this person had typed here when they were last interrupted (ADR
  // 20260906-before-you-ask, decision 3), applied by `FormDraft` below.
  const draft = await readFormDraft(db, shop.id, session.user.personId, "new_diver");
  const newDiverDraft = draftForForm(draft, locale, shop.timezone);
  const t = staffTranslator(locale);

  const potentialMatches = confirmName ? await findSimilarDivers(db, shop.id, confirmName) : [];
  // A candidate with no dive day says so only when a sibling has one; the rule
  // and the bias it corrects are in `noDiveDayNeedsSaying`.
  const sayNoDiveDay = noDiveDayNeedsSaying(potentialMatches);

  const rawQuery = q?.trim() ?? "";
  const prefill = diverSearchPrefill(rawQuery);
  const defaultName = name ?? prefill.name ?? "";
  const defaultEmail = email ?? prefill.email ?? "";
  const defaultPhone = phone ?? "";

  const surface =
    surfaceParam && Object.hasOwn(SEAT_SURFACES, surfaceParam)
      ? (surfaceParam as SeatSurfaceId)
      : null;
  const isWaitlist = waitlistParam === "true";
  const tripId = tripIdParam?.trim() || null;
  const walkIn = walkInParam === "true" && surface === "departure" && tripId !== null;
  const backLink =
    surface === "departure" && tripId
      ? {
          href: `${shopPath(shopSlug, "trips", tripId)}#add-diver`,
          label: t("divers.page.backToTripGuests"),
        }
      : {
          href: shopPath(shopSlug, "divers"),
          label: t("divers.page.backToRoster"),
        };

  const submitLabel =
    surface === "departure" && isWaitlist
      ? t("divers.page.addToWaitlistButton")
      : walkIn
        ? t("divers.page.addToBoatButton")
        : surface === "departure"
          ? t("divers.page.addToTripButton")
          : t("divers.page.addDiver");

  const banner = noticeFromParam(notice, NOTICES);
  const noticeText = banner ? t(banner.key) : null;
  const noticeIsError = banner?.tone === "danger";
  const walkInParty = walkIn;
  // Each party row the on-file check stopped on, with who it reads like.
  const onFileRows: PartyOnFileRow[] =
    walkInParty && notice === "party-on-file"
      ? (
          await Promise.all(
            Object.entries(rest)
              .flatMap(([key, value]) => {
                const row = /^onFile-(\d{1,4})$/.exec(key)?.[1];
                return row !== undefined && typeof value === "string" && value.trim()
                  ? [{ row: Number(row), typedName: value.trim() }]
                  : [];
              })
              .sort((a, b) => a.row - b.row)
              .slice(0, WALK_IN_PARTY_MAX)
              .map(async (entry) => ({
                ...entry,
                matches: await findSimilarDivers(db, shop.id, entry.typedName),
              })),
          )
        ).filter((entry) => entry.matches.length > 0)
      : [];
  const extrasCopy: WalkInExtrasCopy = {
    comingAs: t("participants.roster.typeLabel"),
    types: Object.fromEntries(
      PARTICIPANT_TYPES.map((type) => [type, staffParticipantTypeLabel(t, type)]),
    ) as WalkInExtrasCopy["types"],
    under18: t("divers.page.party.under18"),
    under18Hint: t("divers.page.party.under18Hint"),
    dob: t("divers.page.party.dob"),
    dobHint: t("divers.page.party.dobHint"),
  };
  const dobMax = maxPlausibleBirthDate();

  // A wait-list entry is the one departure form that needs a way to reach the
  // diver when the seat opens.
  const emailRequired = Boolean(
    isWaitlist || (surface && !walkIn && SEAT_SURFACES[surface].email === "required"),
  );

  return (
    <StaffPage width="reading">
      <ShopPageHeader
        eyebrow={backLink.label}
        eyebrowHref={backLink.href}
        title={t("divers.page.newDiverTitle")}
        // Not where the form asks for an email: the lead would say the opposite.
        description={emailRequired ? undefined : t("divers.page.newDiverLead")}
      />

      {noticeText ? (
        <ShopNotice tone={noticeIsError ? "danger" : "success"} className="mt-6">
          <p role="status">{noticeText}</p>
        </ShopNotice>
      ) : null}

      {potentialMatches.length > 0 ? (
        <ShopNotice tone="warning" className="mt-6">
          <div className="flex flex-col gap-2 text-left">
            <h3 className="font-semibold text-base">
              {t("divers.page.confirmMatchesTitle", { name: confirmName ?? "" })}
            </h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted">
              {potentialMatches.map((match) => (
                <li key={match.id}>
                  {surface && tripId ? (
                    <form
                      action={
                        isWaitlist
                          ? addToWaitlistAction.bind(null, shopSlug, tripId)
                          : seatExistingDiverAction.bind(
                              null,
                              walkIn ? "walk-in" : surface,
                              shopSlug,
                            )
                      }
                      className="inline"
                    >
                      <input type="hidden" name="tripId" value={tripId} />
                      <input type="hidden" name="personId" value={match.id} />
                      {/* The *matched* diver's details, not the spelling the
                          staffer just typed: a tap here says "this is the same
                          person", and `addToWaitlistAction` ignores `personId`
                          — `askForDeparture` resolves the person from the name
                          and email it is handed, so the typed spelling would
                          spawn the second person row this prompt exists to
                          prevent. The seating arm reaches the same record by
                          id. */}
                      <input type="hidden" name="fullName" value={match.fullName} />
                      <input type="hidden" name="email" value={match.email ?? ""} />
                      <input type="hidden" name="phone" value={match.phone ?? ""} />
                      {/* Only on the seating arm: a tap here came off a name
                          match, so the booking is told the name it matched on —
                          the prompt fires on an exact spelling too, and only the
                          comparison says whether the seat is
                          identity-unconfirmed (issue #1556). The wait-list arm
                          writes an entry, not a seat, and nobody boards from
                          one. */}
                      {isWaitlist ? null : (
                        <>
                          <input type="hidden" name="fromNameMatch" value="true" />
                          <input type="hidden" name="nameMatchQuery" value={confirmName ?? ""} />
                          <input type="hidden" name="request" value={requestParam ?? ""} />
                        </>
                      )}
                      <SubmitButton
                        pendingLabel={match.fullName}
                        className="underline font-medium text-left"
                      >
                        {match.fullName}
                      </SubmitButton>
                    </form>
                  ) : (
                    <Link
                      href={shopPath(shopSlug, "divers", match.id)}
                      className="underline font-medium"
                    >
                      {match.fullName}
                    </Link>
                  )}
                  <NameMatchCandidateFacts
                    match={match}
                    sayNoDiveDay={sayNoDiveDay}
                    t={t}
                    locale={locale}
                    timeZone={shop.timezone}
                    size="sm"
                  />
                </li>
              ))}
            </ul>
            <form action={createDiverFormAction} className="mt-2">
              <input type="hidden" name="fullName" value={confirmName} />
              <input type="hidden" name="email" value={confirmEmail ?? ""} />
              <input type="hidden" name="phone" value={confirmPhone ?? ""} />
              <input type="hidden" name="surface" value={surfaceParam ?? ""} />
              <input type="hidden" name="walkIn" value={walkInParam ?? ""} />
              <input type="hidden" name="tripId" value={tripIdParam ?? ""} />
              <input type="hidden" name="waitlist" value={waitlistParam ?? ""} />
              <input type="hidden" name="request" value={requestParam ?? ""} />
              <input type="hidden" name="force" value="true" />
              <SubmitButton
                pendingLabel={t("divers.page.adding")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("divers.page.confirmMatchesSubmit")}
              </SubmitButton>
            </form>
          </div>
        </ShopNotice>
      ) : null}

      <SectionCard padding="lg" className="mt-6">
        <PersonFieldTrio
          key={draftBinding.scope}
          as="form"
          action={createDiverFormAction}
          name={surface ? "required" : "optional"}
          email={emailRequired ? "required" : "optional"}
          nameLabel={t("divers.page.fullNameLabel")}
          emailLabel={t("divers.page.emailLabel")}
          phoneLabel={t("divers.page.phoneLabel")}
          // "Optional" is said once, by the lead line under the heading
          // (visual review 2026-10-24, A18); a required field keeps its mark.
          optionalHint=""
          defaultValues={{
            fullName: defaultName,
            email: defaultEmail,
            phone: defaultPhone,
          }}
          emailMaxLength={320}
          phoneMaxLength={40}
        >
          <FormDraft
            form="new_diver"
            draft={newDiverDraft}
            actions={draftBinding.actions}
            copy={formDraftCopy(t)}
          />
          <input type="hidden" name="surface" value={surfaceParam ?? ""} />
          <input type="hidden" name="walkIn" value={walkInParam ?? ""} />
          <input type="hidden" name="tripId" value={tripIdParam ?? ""} />
          <input type="hidden" name="waitlist" value={waitlistParam ?? ""} />
          <input type="hidden" name="request" value={requestParam ?? ""} />
          {/* **The rest of a walk-in family** (fifth loop, item 9): only at
              the counter, where the party is standing at the desk. */}
          {walkInParty ? (
            <>
              <KeepTypedOnRefusal
                form={WALK_IN_PARTY_FORM}
                scope={keptScope}
                restore={noticeIsError}
              />
              <div className="col-span-full">
                <WalkInPersonExtras
                  row={WALK_IN_FIRST_ROW}
                  typeField="participantType"
                  copy={extrasCopy}
                  dobMax={dobMax}
                />
              </div>
              {onFileRows.length > 0 ? (
                <PartyOnFileChoices
                  rows={onFileRows}
                  t={t}
                  locale={locale}
                  timeZone={shop.timezone}
                />
              ) : null}
              <WalkInPartyRows
                keptScope={keptScope}
                restore={noticeIsError}
                dobMax={dobMax}
                copy={{
                  add: t("divers.page.party.add"),
                  person: t.raw("divers.page.party.person"),
                  name: t("divers.page.fullNameLabel"),
                  extras: extrasCopy,
                  remove: t("divers.page.party.remove"),
                  removeFor: t.raw("divers.page.party.removeFor"),
                }}
              />
            </>
          ) : null}
          {/* No margin: the trio's grid gap is the one field gap every form
              stands its action row under (K-182). */}
          <FieldActions>
            <SubmitButton pendingLabel={t("divers.page.adding")} className={buttonClass()}>
              {submitLabel}
            </SubmitButton>
            <Link
              href={backLink.href}
              className={buttonClass({ variant: "secondary", className: "print:hidden" })}
            >
              {t("divers.page.cancel")}
            </Link>
          </FieldActions>
        </PersonFieldTrio>
      </SectionCard>
    </StaffPage>
  );
}
