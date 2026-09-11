import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { discardFormDraftAction, saveFormDraftAction } from "@/app/actions/form-drafts";
import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import { SEAT_SURFACES, type SeatSurfaceId } from "@/app/actions/seat-diver-surfaces";
import { addToWaitlistAction } from "@/app/shop/[shopSlug]/trips/[id]/actions";
import { FormDraft } from "@/components/FormDraft";
import { formDraftCopy } from "@/components/form-draft-copy";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { createDiver, findSimilarDivers } from "@/db/divers";
import { discardFormDraft, readFormDraft } from "@/db/form-drafts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import {
  blankableDiverEmailSchema,
  blankableDiverNameSchema,
  diverPhoneSchema,
  diverSearchPrefill,
} from "@/lib/person-fields";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import {
  type NoticeTone,
  noticeFromParam,
  safeShopReturnPath,
  shopPath,
} from "@/lib/staff-notices";

export const instant = true;

export const metadata: Metadata = { title: "Add diver — DiveDay" };

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  duplicate: { tone: "danger", key: "divers.page.noticeDuplicate" },
  invalid: { tone: "danger", key: "divers.page.noticeInvalid" },
  "diver-full": { tone: "danger", key: "trips.notices.diverFull" },
  "diver-already": { tone: "danger", key: "trips.notices.diverAlready" },
  "diver-course-unstaffed": { tone: "danger", key: "trips.notices.diverCourseUnstaffed" },
  "diver-course-prerequisite": { tone: "danger", key: "trips.notices.diverCoursePrerequisite" },
  "diver-course-ratio-full": { tone: "danger", key: "trips.notices.diverCourseRatioFull" },
  "diver-course-min-age": { tone: "danger", key: "trips.notices.diverCourseMinAge" },
  "diver-trip-prerequisite": { tone: "danger", key: "trips.notices.diverTripPrerequisite" },
  "diver-unavailable": { tone: "danger", key: "trips.notices.diverUnavailable" },
  "diver-invalid": { tone: "danger", key: "divers.page.noticeInvalid" },
};

const diverSchema = z
  .object({
    fullName: blankableDiverNameSchema,
    email: blankableDiverEmailSchema,
    phone: diverPhoneSchema,
  })
  .refine(({ fullName, email, phone }) => Boolean(fullName || email || phone));

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
    tripId?: string;
    waitlist?: string;
    returnTo?: string;
    request?: string;
    confirmName?: string;
    confirmEmail?: string;
    confirmPhone?: string;
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
    tripId: tripIdParam,
    waitlist: waitlistParam,
    returnTo: returnToParam,
    request: requestParam,
    confirmName,
    confirmEmail,
    confirmPhone,
  } = await searchParams;

  const { db, shop, session } = await requireShopSurface(shopSlug);

  const locale = await requestLocale(shop.defaultLocale);
  // What this person had typed here when they were last interrupted (ADR
  // 20260906-before-you-ask, decision 3), applied by `FormDraft` below.
  const draft = await readFormDraft(db, shop.id, session.user.personId, "new_diver");
  const newDiverDraft = draft
    ? { fields: draft.fields, savedAtLabel: formatTime(draft.savedAt, locale, shop.timezone) }
    : null;
  const t = staffTranslator(locale);

  const potentialMatches = confirmName ? await findSimilarDivers(db, shop.id, confirmName) : [];

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
  // `?returnTo=` is whatever was in the address bar, and it becomes the back
  // link's href here and the redirect target in `createDiverFormAction` below.
  // Only a path inside this staffer's own shop survives; anything else falls
  // back to the roster, which is where the page lands with no `returnTo` at all.
  const returnTo = safeShopReturnPath(shop.slug, returnToParam);

  const backLink = returnTo
    ? { href: returnTo, label: t("divers.page.backToRoster") }
    : surface === "trip-guests" && tripId
      ? {
          href: `${shopPath(shopSlug, "trips", tripId)}#add-diver`,
          label: t("divers.page.backToTripGuests"),
        }
      : surface === "walk-in" && tripId
        ? {
            href: shopPath(shopSlug, "check-in", "walk-in", tripId),
            label: t("divers.page.backToWalkIn"),
          }
        : surface === "new-booking" && tripId
          ? {
              href: shopPath(shopSlug, "bookings", "new", tripId),
              label: t("divers.page.backToNewBooking"),
            }
          : {
              href: shopPath(shopSlug, "divers"),
              label: t("divers.page.backToRoster"),
            };

  const submitLabel =
    surface === "trip-guests" && isWaitlist
      ? t("divers.page.addToWaitlistButton")
      : surface === "trip-guests"
        ? t("divers.page.addToTripButton")
        : surface === "walk-in"
          ? t("divers.page.addToBoatButton")
          : surface === "new-booking"
            ? t("divers.page.addToTripButton")
            : t("divers.page.addDiver");

  async function createDiverFormAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const activeDb = await getDb();
    const parsed = diverSchema.safeParse(Object.fromEntries(formData));
    const activeSurface = formData.get("surface") as SeatSurfaceId | null;
    const activeTripId = formData.get("tripId") ? String(formData.get("tripId")) : null;
    const activeWaitlist = formData.get("waitlist") === "true";
    // Re-validated against the *session's* shop, not the page's: the hidden
    // input is as client-supplied as the query param was, and this value is
    // handed to `revalidateAndRedirect` as both the revalidate key and the
    // redirect target.
    const returnToField = formData.get("returnTo");
    const activeReturnTo = safeShopReturnPath(
      staff.user.shopSlug,
      typeof returnToField === "string" ? returnToField : null,
    );
    const force = formData.get("force") === "true";

    const buildNewDiverUrl = (extraParams: Record<string, string>) => {
      const search = new URLSearchParams(extraParams);
      return `${shopPath(staff.user.shopSlug, "divers", "new")}?${search.toString()}`;
    };

    if (!parsed.success) {
      const search: Record<string, string> = { notice: "invalid" };
      if (activeSurface) search.surface = activeSurface;
      if (activeTripId) search.tripId = activeTripId;
      if (activeWaitlist) search.waitlist = "true";
      if (activeReturnTo) search.returnTo = activeReturnTo;
      redirect(buildNewDiverUrl(search));
    }

    if (!force) {
      const matches = await findSimilarDivers(activeDb, staff.user.shopId, parsed.data.fullName);
      if (matches.length > 0) {
        const search: Record<string, string> = {
          confirmName: parsed.data.fullName,
        };
        if (parsed.data.email) search.confirmEmail = parsed.data.email;
        if (parsed.data.phone) search.confirmPhone = parsed.data.phone;
        if (activeSurface) search.surface = activeSurface;
        if (activeTripId) search.tripId = activeTripId;
        if (activeWaitlist) search.waitlist = "true";
        if (activeReturnTo) search.returnTo = activeReturnTo;
        redirect(buildNewDiverUrl(search));
      }
    }
    // The form was accepted: whatever draft of it was kept is finished with.
    await discardFormDraft(activeDb, staff.user.shopId, staff.user.personId, "new_diver");

    if (activeSurface === "trip-guests" && activeWaitlist && activeTripId) {
      await addToWaitlistAction(staff.user.shopSlug, activeTripId, formData);
    } else if (
      activeSurface &&
      activeTripId &&
      Object.hasOwn(SEAT_SURFACES, activeSurface) &&
      (activeSurface === "trip-guests" ||
        activeSurface === "walk-in" ||
        activeSurface === "new-booking")
    ) {
      await seatNewDiverAction(activeSurface, staff.user.shopSlug, formData);
    } else if (activeReturnTo) {
      const diver = await createDiver(activeDb, {
        shopId: staff.user.shopId,
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        phone: parsed.data.phone,
      });
      if (!diver) {
        redirect(buildNewDiverUrl({ notice: "duplicate", returnTo: activeReturnTo }));
      }
      const separator = activeReturnTo.includes("?") ? "&" : "?";
      revalidateAndRedirect(
        activeReturnTo,
        `${activeReturnTo}${separator}personId=${encodeURIComponent(diver.id)}`,
      );
    } else {
      const diver = await createDiver(activeDb, {
        shopId: staff.user.shopId,
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        phone: parsed.data.phone,
      });
      if (!diver) {
        redirect(buildNewDiverUrl({ notice: "duplicate" }));
      }
      revalidateAndRedirect(
        shopPath(staff.user.shopSlug, "divers"),
        `${shopPath(staff.user.shopSlug, "divers", diver.id)}?edit=1`,
      );
    }
  }

  const banner = noticeFromParam(notice, NOTICES);
  const noticeText = banner ? t(banner.key) : null;
  const noticeIsError = banner?.tone === "danger";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={backLink.label}
        eyebrowHref={backLink.href}
        title={t("divers.page.newDiverTitle")}
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
                          : seatExistingDiverAction.bind(null, surface, shopSlug)
                      }
                      className="inline"
                    >
                      <input type="hidden" name="tripId" value={tripId} />
                      <input type="hidden" name="personId" value={match.id} />
                      {/* The *matched* diver's details, not the spelling the
                          staffer just typed: a tap here says "this is the same
                          person", and `addToWaitlistAction` ignores `personId`
                          — `joinTripWaitlist` resolves the person from the name
                          and email it is handed, so the typed spelling would
                          spawn the second person row this prompt exists to
                          prevent. The seating arm reaches the same record by
                          id. */}
                      <input type="hidden" name="fullName" value={match.fullName} />
                      <input type="hidden" name="email" value={match.email ?? ""} />
                      <input type="hidden" name="phone" value={match.phone ?? ""} />
                      {/* Only on the seating arm: a tap here is a guess off a
                          trigram name match, so the seat it takes is
                          identity-unconfirmed until a staffer confirms it
                          (issue #1556). The wait-list arm writes an entry, not
                          a seat, and nobody boards from one. */}
                      {isWaitlist ? null : (
                        <input type="hidden" name="fromNameMatch" value="true" />
                      )}
                      <button type="submit" className="underline font-medium text-left">
                        {match.fullName}
                      </button>
                    </form>
                  ) : (
                    <Link
                      href={shopPath(shopSlug, "divers", match.id)}
                      className="underline font-medium"
                    >
                      {match.fullName}
                    </Link>
                  )}
                  {match.email || match.phone ? (
                    <span className="text-muted text-sm ms-1">
                      ({[match.email, match.phone].filter(Boolean).join(", ")})
                    </span>
                  ) : null}
                  {match.lastDiveDayAt ? (
                    <span className="text-muted text-sm ms-1">
                      {t("divers.page.confirmMatchesLastDive", {
                        date: formatShortDate(match.lastDiveDayAt, locale, shop.timezone),
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <form action={createDiverFormAction} className="mt-2">
              <input type="hidden" name="fullName" value={confirmName} />
              <input type="hidden" name="email" value={confirmEmail ?? ""} />
              <input type="hidden" name="phone" value={confirmPhone ?? ""} />
              <input type="hidden" name="surface" value={surfaceParam ?? ""} />
              <input type="hidden" name="tripId" value={tripIdParam ?? ""} />
              <input type="hidden" name="waitlist" value={waitlistParam ?? ""} />
              <input type="hidden" name="returnTo" value={returnTo ?? ""} />
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
          as="form"
          action={createDiverFormAction}
          name={surface ? "required" : "optional"}
          email={surface && SEAT_SURFACES[surface].email === "required" ? "required" : "optional"}
          nameLabel={t("divers.page.fullNameLabel")}
          emailLabel={t("divers.page.emailLabel")}
          phoneLabel={t("divers.page.phoneLabel")}
          optionalHint={t("divers.page.optionalHint")}
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
            actions={{ save: saveFormDraftAction, discard: discardFormDraftAction }}
            copy={formDraftCopy(t)}
          />
          <input type="hidden" name="surface" value={surfaceParam ?? ""} />
          <input type="hidden" name="tripId" value={tripIdParam ?? ""} />
          <input type="hidden" name="waitlist" value={waitlistParam ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo ?? ""} />
          <input type="hidden" name="request" value={requestParam ?? ""} />
          <FieldActions className="mt-6">
            <SubmitButton pendingLabel={t("divers.page.adding")} className={buttonClass()}>
              {submitLabel}
            </SubmitButton>
            <Link href={backLink.href} className={buttonClass({ variant: "secondary" })}>
              {t("divers.page.cancel")}
            </Link>
          </FieldActions>
        </PersonFieldTrio>
      </SectionCard>
    </main>
  );
}
