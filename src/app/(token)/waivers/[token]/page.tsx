import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getTripDiveSitesPeek } from "@/db/trips";
import { getBookingTripId } from "@/db/waiver-signing";
import { getWaiverForToken, staleWaiverRecordForToken, waiverLinkDoor } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { connectionForRoute } from "@/lib/observability/render-connection";
import { isUnresolvedMedicalHold } from "@/lib/waivers";
import { completeWaiverAction, saveWaiverDraftAction } from "./actions";
import { completedMedicalState } from "./completed-medical-state";
import { counterDevice } from "./counter-device";
import { completedWaiverRail, WaiverCompleted } from "./WaiverCompleted";
import {
  CounterClaimCard,
  CounterElsewhereCard,
  ExpiredLink,
  HeldWaiverCard,
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
  // A counter tablet's link, or a release with no seat. A seat's own waiver
  // link opens nothing (issue #2743): its release is signed in the holder's
  // thread, so it lands on the card below that sends them their thread link.
  const door = await waiverLinkDoor(db, token, { device: await counterDevice() });
  // A counter QR opens on the first phone that taps "open here", and on no
  // other (attacker review S1).
  if (door?.door === "counter_unclaimed") return <CounterClaimCard token={token} t={anonT} />;
  if (door?.door === "counter_elsewhere") return <CounterElsewhereCard t={anonT} />;
  const state = door ? await getWaiverForToken(db, door.key) : { state: "unavailable" as const };
  const counter = door?.door === "counter";

  if (state.state === "unavailable") {
    // A rescue send supersedes the very record that asked for it, so this
    // token stops resolving through `getWaiverForToken` the moment the diver
    // uses the button below — as does an old link a staff reissue replaced.
    // Resolve the stale record so the redirect back here (and every later
    // refresh of the same URL) lands on the rescue card with its confirmation,
    // rather than a dead end that reads as if the tap broke the link.
    const stale = await staleWaiverRecordForToken(db, token);
    const staleShop = stale ? await getShopById(db, stale.shopId) : null;
    if (staleShop) {
      const staleT = diverTranslator(await requestLocale(staleShop.defaultLocale));
      return <ExpiredLink token={token} shop={staleShop} t={staleT} sent={sent} />;
    }
    // No record at all reached through this token (garbage, or a completed
    // link long since replaced) — there is no shop to attribute it to
    // without weakening the token model's own guarantee that a bearer token
    // reveals only its own record.
    return <UnavailableWaiverLink t={anonT} />;
  }

  // Every remaining state carries a real record, so the shop it belongs to
  // is always resolvable from here on — including "expired", which used to
  // bail out before the shop (and so its contact info) was ever loaded.
  const shop = await getShopById(db, state.record.shopId);
  if (!shop) {
    return <UnavailableWaiverLink t={anonT} />;
  }
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);

  if (state.state === "expired") {
    return <ExpiredLink token={token} shop={shop} t={t} sent={sent} />;
  }
  if (state.state === "held") return <HeldWaiverCard shop={shop} t={t} />;

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
        // A waiver link opens no thread and no doctor's page (issue #2743): a
        // seat's release, and its doctor's page, are on the holder's own link.
        showPrepHelp={false}
        readyPath={null}
        doctorPath={null}
        signedRail={signedRail}
        diveSitesList={diveSitesList}
      />
    );
  }

  return waiverSigningForm({
    db,
    record: state.record,
    shop,
    locale,
    t,
    search: { saved, error, field, q, at },
    completeAction: completeWaiverAction.bind(null, token),
    saveAction: saveWaiverDraftAction.bind(null, token),
    // A counter link's half hour is not the release's own expiry.
    showLinkExpiry: !counter,
    // The counter QR can be read by any camera, so it never shows the medical
    // answers the diver saved in their own thread (security review S2); it
    // shows only what this claimed code saved, so a refused Sign or a Save
    // never blanks the questionnaire on the phone that typed it (dock B1).
    prefillMedical: door?.door !== "counter" || state.record.draftViaLinkId === door.key.linkId,
  });
}
