import type { Metadata } from "next";
import { DeadLink } from "@/components/DeadLink";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import { getBookingTripId } from "@/db/waiver-signing";
import {
  closedCounterCode,
  doorNeedsDeskGuardian,
  getWaiverForToken,
  signedElsewhereShop,
  staleWaiverRecordForToken,
  waiverLinkDoor,
} from "@/db/waivers";
import { connectionForRoute } from "@/features/render-connection";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { isUnresolvedMedicalHold } from "@/lib/waivers";
import { autosaveWaiverDraftAction, completeWaiverAction, saveWaiverDraftAction } from "./actions";
import { completedMedicalState } from "./completed-medical-state";
import { counterDevice } from "./counter-device";
import { completedWaiverRail, WaiverCompleted } from "./WaiverCompleted";
import {
  ExpiredLink,
  GuardianAtCounterCard,
  SignedElsewhereCard,
  UnavailableWaiverLink,
} from "./WaiverDoorCards";
import { waiverSigningForm } from "./WaiverSigningForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("waiver.metaTitle"),
    robots: { index: false, follow: false },
  };
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function WaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    field?: string;
    /** The shop question a refusal names (`shopQuestionsForPage`). */
    q?: string;
    sent?: string;
    at?: string;
  }>;
}) {
  await connectionForRoute("/waivers/[token]");
  const { token } = await params;
  // `at` is the refusal's own nonce, minted by the actions below on every refused submit. It
  // exists so a *repeat* of the identical refusal (same wrong name twice) still remounts
  // `FieldErrorFocus` and re-runs the scroll-and-ring — without it the second attempt renders an
  // unchanged tree and the effect never fires again (see FieldErrorFocus's own docstring).
  const { saved, error, field, q, sent, at } = await searchParams;
  const db = await getDb();
  // A dead or expired link resolves no shop, so there is no
  // `shops.default_locale` to fall back to — negotiate from the visitor's own
  // device alone for those branches.
  const anonT = diverTranslator(await requestLocale());
  // A counter link (a seat's QR, or Copy link on a release with no seat), or
  // a release link mailed for a release with no seat (issue #3983). Nothing
  // else opens here: a seat's release is signed in its holder's thread.
  const door = await waiverLinkDoor(db, token, { device: await counterDevice() });
  const state = door ? await getWaiverForToken(db, door.key) : { state: "unavailable" as const };
  const counter = door?.door === "counter";

  if (state.state === "unavailable") {
    // A Sign through this link found its release signed through another door
    // (issue #4044): what was entered was not saved, and the card says so and
    // names the shop, never the release.
    const signedElsewhere = error === "signed" ? await signedElsewhereShop(db, token) : null;
    const signedShop = signedElsewhere ? await getShopById(db, signedElsewhere.shopId) : null;
    if (signedShop) {
      const signedT = diverTranslator(await requestLocale(signedShop.defaultLocale));
      return <SignedElsewhereCard shop={signedShop} t={signedT} />;
    }
    // A release link that expired, or that a newer link or a corrected
    // contact revoked, opens nothing; so does one whose release was replaced.
    // Resolve the stale record so this URL (and every later refresh of it,
    // after the rescue below has sent a fresh link) lands on the rescue card
    // with its confirmation, rather than a dead end that reads as if the tap
    // broke the link.
    const stale = await staleWaiverRecordForToken(db, token);
    const staleShop = stale ? await getShopById(db, stale.shopId) : null;
    if (staleShop) {
      const staleT = diverTranslator(await requestLocale(staleShop.defaultLocale));
      return <ExpiredLink token={token} shop={staleShop} t={staleT} sent={sent} />;
    }
    // A counter code that ran out or was replaced: its way on is a fresh code
    // from the staff, so the card says that and names the shop (issue #3985).
    const closed = await closedCounterCode(db, token);
    const closedShop = closed ? await getShopById(db, closed.shopId) : null;
    if (closedShop) {
      const closedT = diverTranslator(await requestLocale(closedShop.defaultLocale));
      return <DeadLink t={closedT} next={closedT("waiver.counterClosedNext")} shop={closedShop} />;
    }
    // No record at all reached through this token (garbage, or a completed
    // link long since replaced) — there is no shop to attribute it to
    // without weakening the token model's own guarantee that a bearer token
    // reveals only its own record.
    return <UnavailableWaiverLink t={anonT} />;
  }

  // Every remaining state carries a real record, so the shop it belongs to
  // is always resolvable from here on.
  const shop = await getShopById(db, state.record.shopId);
  if (!shop) {
    return <UnavailableWaiverLink t={anonT} />;
  }
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);

  if (state.state === "completed") {
    // A diver revisiting their own still-live link after a physician cleared
    // them was told a doctor still had to confirm — one surface saying "held"
    // while every staff surface said cleared (issue #1252, security review N1).
    const needsReview = isUnresolvedMedicalHold(state.record);
    const bookingId = state.record.bookingId;
    const bookingTripId = bookingId
      ? await getBookingTripId(db, state.record.shopId, bookingId)
      : null;

    const diveSitesList = bookingTripId ? await getTripDiveSitesPeek(db, bookingTripId) : [];

    const signedRail = completedWaiverRail(needsReview, !!state.record.shopAnswers);
    return (
      <WaiverCompleted
        shop={shop}
        t={t}
        locale={locale}
        waiverOnly={counter}
        // A counter submit that found its release already signed: what was
        // just entered was not saved, and the receipt says so.
        notSaved={counter && error === "signed"}
        medicalState={completedMedicalState(state.record)}
        // A waiver link opens no thread (issue #2743): a seat's release is on
        // the holder's own link, and so is its doctor's page; a counter QR's
        // is printed at the desk.
        showPrepHelp={false}
        readyPath={null}
        doctorPath={null}
        signedRail={signedRail}
        diveSitesList={diveSitesList}
      />
    );
  }

  // A minor on a door the desk never vouched a guardian for (#4003), or on a
  // mailed link to a contact a party's lead typed (#4019): Sign would refuse,
  // so the page says why before anyone fills it in.
  if (
    (door?.door === "counter" || door?.door === "release") &&
    (await doorNeedsDeskGuardian(db, door.key))
  )
    return <GuardianAtCounterCard t={t} />;

  return waiverSigningForm({
    db,
    record: state.record,
    // Only the draft saved through this door comes back to it (issues #4008, #4130).
    draft: state.draft,
    shop,
    locale,
    t,
    search: { saved, error, field, q, at },
    completeAction: completeWaiverAction.bind(null, token),
    saveAction: saveWaiverDraftAction.bind(null, token),
    // A release link says how long it works; a counter link lasts the day
    // and says its time only in its last hour (issue #4064).
    linkExpiresAt: door?.door === "release" ? door.key.expiresAt : null,
    // The counter QR can be read by any camera, so it never shows the medical
    // answers the diver saved in their own thread (security review S2); it
    // shows only what this code saved, and only on the phone that saved it
    // (issue #4064: any phone opens it), so a refused Sign or a Save never
    // blanks the questionnaire on the phone that typed it (dock B1).
    // A release link likewise prefills only what was saved through itself:
    // never a counter phone's answers, and never an old link's (issue #3983);
    // `state.draft` is this link's own and no other door's (issue #4130).
    prefillMedical: door !== null && (door.door !== "counter" || door.ownDevice),
    // A counter QR's time left, said in its last hour, and its answers saved on each
    // step, so the record holds them when it runs out (issue #3985); a fresh
    // code never shows the medical answers saved through this one (S2).
    counter:
      door?.door === "counter"
        ? {
            expiresAt: door.key.expiresAt,
            autosaveAction: autosaveWaiverDraftAction.bind(null, token),
          }
        : undefined,
  });
}
