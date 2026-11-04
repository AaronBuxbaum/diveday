import Link from "next/link";
import { bindFormDraft, draftForForm } from "@/app/actions/form-draft-props";
import { seatExistingDiverAction } from "@/app/actions/seat-diver";
import { SEAT_SURFACES, type SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { addToWaitlistAction } from "@/app/shop/[shopSlug]/trips/[id]/roster-seating-actions";
import { FormDraft } from "@/components/FormDraft";
import { formDraftCopy } from "@/components/form-draft-copy";
import { KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { keptTypedScope } from "@/components/kept-typed-scope";
import { SubmitButton } from "@/components/SubmitButton";
import { NameMatchCandidateFacts } from "@/components/seat-diver/NameMatchCandidateFacts";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { buttonClass } from "@/components/ui/button";
import { FieldActions } from "@/components/ui/form";
import { ShopNotice } from "@/components/ui/outcome";
import { isOpenDateRequestWithoutEmail } from "@/db/interest-dates";
import { getNewDiverPage } from "@/db/new-diver-page";
import { staffParticipantTypeLabel } from "@/i18n/participant-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { addPanelCloseHref } from "@/lib/add-panel";
import { maxPlausibleBirthDate } from "@/lib/age";
import { noDiveDayNeedsSaying } from "@/lib/name-match-evidence";
import { PARTICIPANT_TYPES } from "@/lib/participant-types";
import { diverSearchPrefill } from "@/lib/person-fields";
import type { ShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { WALK_IN_FIRST_ROW, WALK_IN_PARTY_FORM, WALK_IN_PARTY_MAX } from "@/lib/walk-in-party";
import { createDiverFormAction } from "../add-diver-actions";
import { NOTICES } from "./add-diver-notices";
import { PartyOnFileChoices } from "./PartyOnFileChoices";
import { WalkInPartyRows } from "./WalkInPartyRows";
import { type WalkInExtrasCopy, WalkInPersonExtras } from "./WalkInPersonExtras";

/** What the roster's URL carries into its add panel (`/divers?add=1`). */
export type AddDiverSearch = {
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
};

/** The panel's own URL keys, which closing it drops; the roster's search stays. */
const ADD_DIVER_KEYS = [
  "name",
  "email",
  "phone",
  "surface",
  "walkIn",
  "tripId",
  "waitlist",
  "request",
  "confirmName",
  "confirmEmail",
  "confirmPhone",
] as const;

/**
 * Where closing the panel goes: back to the departure that sent the staffer
 * here to type a diver the search did not find, or the roster as it was.
 */
export function addDiverCloseHref(shopSlug: string, search: AddDiverSearch): string {
  const tripId = search.tripId?.trim();
  if (search.surface === "departure" && tripId) {
    return `${shopPath(shopSlug, "trips", tripId)}#add-diver`;
  }
  const onFile = Object.keys(search).filter((key) => key.startsWith("onFile-"));
  return addPanelCloseHref(shopPath(shopSlug, "divers"), search, [...ADD_DIVER_KEYS, ...onFile]);
}

/**
 * **Add a diver**: the roster's add panel, from whichever door opened it — the
 * roster's own "Add diver", or a seat flow (`surface` + `tripId`, and
 * `waitlist` from a full trip) that sent the staffer here to type someone the
 * search did not find. A name that reads like somebody on file comes back with
 * them listed, to pick or to create anyway.
 */
export async function AddDiverPanel({
  surface: { db, shop, session },
  shopSlug,
  search,
  t,
  locale,
}: {
  surface: ShopSurface;
  shopSlug: string;
  search: AddDiverSearch;
  t: StaffTranslator;
  locale: string;
}) {
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
  } = search;

  const draftBinding = bindFormDraft(session.user);
  const keptScope = keptTypedScope(shopSlug, session.user.personId);

  const surface =
    surfaceParam && Object.hasOwn(SEAT_SURFACES, surfaceParam)
      ? (surfaceParam as SeatSurfaceId)
      : null;
  const isWaitlist = waitlistParam === "true";
  const tripId = tripIdParam?.trim() || null;
  const walkIn = walkInParam === "true" && surface === "departure" && tripId !== null;
  // What this person had typed here when they were last interrupted (ADR
  // 20260906-before-you-ask, decision 3), applied by `FormDraft` below; who a
  // name being confirmed reads like; and each party row the on-file check
  // stopped on, with who it reads like.
  const { draft, potentialMatches, onFileRows } = await getNewDiverPage(
    db,
    shop.id,
    session.user.personId,
    {
      confirmName,
      onFile:
        walkIn && notice === "party-on-file"
          ? Object.entries(rest)
              .flatMap(([key, value]) => {
                const row = /^onFile-(\d{1,4})$/.exec(key)?.[1];
                return row !== undefined && typeof value === "string" && value.trim()
                  ? [{ row: Number(row), typedName: value.trim() }]
                  : [];
              })
              .sort((a, b) => a.row - b.row)
              .slice(0, WALK_IN_PARTY_MAX)
          : [],
    },
  );
  const newDiverDraft = draftForForm(draft, locale, shop.timezone);
  // A candidate with no dive day says so only when a sibling has one; the rule
  // and the bias it corrects are in `noDiveDayNeedsSaying`.
  const sayNoDiveDay = noDiveDayNeedsSaying(potentialMatches);

  const rawQuery = q?.trim() ?? "";
  const prefill = diverSearchPrefill(rawQuery);
  const defaultName = name ?? prefill.name ?? "";
  const defaultEmail = email ?? prefill.email ?? "";
  const defaultPhone = phone ?? "";

  const closeHref = addDiverCloseHref(shopSlug, search);

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
  // The departure door waives the email for a date request that has none itself
  // (issue #3743); the action reads the same row, so this only spares the browser
  // from refusing a form the server accepts.
  const requestId = requestParam ? uuidParam(requestParam) : undefined;
  const requestHasNoEmail =
    surface === "departure" &&
    !isWaitlist &&
    !walkIn &&
    requestId !== undefined &&
    (await isOpenDateRequestWithoutEmail(db, shop.id, requestId));
  const emailRequired = Boolean(
    isWaitlist ||
      (surface && !walkIn && SEAT_SURFACES[surface].email === "required" && !requestHasNoEmail),
  );

  return (
    <div className="space-y-6">
      {/* Not where the form asks for an email: the lead would say the opposite. */}
      {emailRequired ? null : <p className="text-sm text-muted">{t("divers.page.newDiverLead")}</p>}

      {noticeText ? (
        <ShopNotice tone={noticeIsError ? "danger" : "success"}>
          <p role="status">{noticeText}</p>
        </ShopNotice>
      ) : null}

      {potentialMatches.length > 0 ? (
        <ShopNotice tone="warning">
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
                pendingLabel={t("words.busy.adding")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("divers.page.confirmMatchesSubmit")}
              </SubmitButton>
            </form>
          </div>
        </ShopNotice>
      ) : null}

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
        {walkIn ? (
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
          <SubmitButton pendingLabel={t("words.busy.adding")} className={buttonClass()}>
            {submitLabel}
          </SubmitButton>
          <Link
            href={closeHref}
            scroll={false}
            className={buttonClass({ variant: "secondary", className: "print:hidden" })}
          >
            {t("divers.page.cancel")}
          </Link>
        </FieldActions>
      </PersonFieldTrio>
    </div>
  );
}
