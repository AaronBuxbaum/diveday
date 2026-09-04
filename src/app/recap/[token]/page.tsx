import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AfterState } from "@/app/ready/[token]/_components/AfterState";
import { buildAfterStateProps } from "@/app/ready/[token]/_lib/after-state-data";
import { EntryDone } from "@/components/account/EntryShell";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getRecapPageData, getRecapPageState, type RecapSite } from "@/db/recap";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale, requestTranslator } from "@/i18n/request";
import { cachedListFormat } from "@/lib/intl-cache";
import { publicSchedulePath } from "@/lib/public-routes";
import { verifyRecapToken } from "@/lib/recap-links";
import { openGraphSite } from "@/lib/site-metadata";
import { startTipAction, submitReviewAction, uploadRecapPhotoAction } from "./actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const t = diverTranslator(await requestLocale());
  const bookingId = verifyRecapToken(token);
  const db = bookingId ? await getDb() : null;
  const data = db && bookingId ? await getRecapPageData(db, bookingId) : null;
  if (!data) {
    return { title: t("recap.metaTitle"), robots: { index: false, follow: false } };
  }
  // Bearer-token page: the URL itself is the credential, so whoever already
  // has the link can see the whole page — but a link-preview unfurl (Slack,
  // iMessage, ...) renders for bystanders who never clicked it. Keep the
  // unfurl to the same non-personal facts a signed-out visitor of the shop's
  // own public schedule page already sees — trip title, shop name, dive
  // site names — never the diver's name, contact info, photos, review
  // words, or tip amount (checked against
  // docs/engineering/capability-telemetry-runbook.md; task 59).
  const { shop, trip, sites } = data;
  const siteNames = sitesSentence(sites, shop.defaultLocale);
  const ogTitle = `${trip.title} · ${shop.name}`;
  const ogDescription = siteNames
    ? `A dive recap from ${shop.name} — ${siteNames}.`
    : `A dive recap from ${shop.name}.`;
  return {
    title: t("recap.metaTitle"),
    robots: { index: false, follow: false },
    // No `url`: this is a bearer-token page, and `og:url` would put the
    // capability itself in a meta tag that unfurls for bystanders who never
    // clicked the link (docs/engineering/capability-telemetry-runbook.md).
    openGraph: { ...openGraphSite, title: ogTitle, description: ogDescription },
  };
}

/** Name the sites in prose: "French Reef", "French Reef and Molasses", etc. */
function sitesSentence(sites: RecapSite[], locale: string): string | null {
  const names = sites.map((s) => s.name);
  if (names.length === 0) return null;
  return cachedListFormat(locale, { type: "conjunction" }).format(names);
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * **The recap link, folded into the thread** — ADR 20260827-the-divers-thread,
 * decision 4 (slice 7d).
 *
 * This used to be a page of its own: 805 lines, a first act that said the
 * day's conditions and sites twice (a stat row and then the keepsake card
 * under it), a stylized boat-track map, and five things asked of one reader
 * below the fold. All of that is now the thread's after-state — the same
 * surface the diver's own `/ready` link renders once the boat is home
 * (`AfterState`) — and this route is what is left: verify the signed recap
 * token, read the booking, render it.
 *
 * **No redirect, deliberately.** A signed recap token cannot mint a readiness
 * capability (`recap-links.ts` domain-separates the two on purpose), so there
 * is no `/ready` URL to send this reader to. The two tokens render one
 * surface instead, which is what keeps every recap email already in the world
 * working — and why the three recap actions keep their signatures and their
 * `/recap/<token>` redirects.
 *
 * The `opengraph-image` beside this file stays for the same reason: this URL
 * is the one that travels in an email.
 */
export default async function DiveRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ photo?: string; tip?: string; review?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { photo, tip, review } = await searchParams;
  // A dead link resolves no shop, so there is no `shops.default_locale` to fall
  // back to — negotiate from the visitor's own device alone for those branches.
  const anonT = diverTranslator(await requestLocale());
  const bookingId = verifyRecapToken(token);
  if (!bookingId) {
    // `EntryDone` is the app's one warm terminal pattern
    // (docs/design/principles.md #4); the `expired` mark — a drawn clock
    // (ADR 20260827-first-light, decision 2) — is the app-wide "this link has
    // run out" mark, decorative.
    return (
      <EntryDone
        glyph="expired"
        title={anonT("recap.unavailableHeading")}
        text={anonT("recap.unavailableBody")}
      />
    );
  }

  const db = await getDb();
  const state = await getRecapPageState(db, bookingId);
  if (state.kind === "unknown") {
    // The signature verified and resolved no booking at all — a booking
    // deleted out from under a link DiveDay itself signed. There is no shop to
    // attribute it to without guessing, and a bearer token reveals only its
    // own record, so this is the account-tier door: warm, terminal, naming
    // nobody.
    return (
      <EntryDone
        glyph="expired"
        title={anonT("recap.unavailableHeading")}
        text={anonT("recap.unavailableBody")}
      />
    );
  }

  if (state.kind !== "recap") {
    const deadT = diverTranslator(await requestLocale(state.shop.defaultLocale));
    if (state.kind === "departure-cancelled") {
      // **The departure was called off, and this is the same sentence
      // `/ready` already says to this diver** (`ready/[token]/page.tsx`'s
      // stranded branch). A blow-out cancels the trip and leaves every booking
      // active, so the diver opening an older recap email has a live seat on a
      // boat that is not running. Telling them their link has run out is the
      // one thing that is false — and "ask your dive shop for a fresh link" is
      // advice that cannot help, because no fresher link will ever exist. The
      // `cancelled` mark rather than `expired`: the link did not expire.
      return (
        <ExpiredLinkCard
          glyph="cancelled"
          title={deadT("booking.cancelledHeading")}
          text={deadT("ready.tripCancelledBody")}
          shop={state.shop}
          t={deadT}
        >
          <Link href={publicSchedulePath(state.shop.slug)} className={buttonClass()}>
            {deadT("recap.seeWhatsNext")}
          </Link>
        </ExpiredLinkCard>
      );
    }

    // **The booking tier** (ADR 20260827-first-light, decision 3): a diver is
    // holding a phone and the link does not work, and their one question is
    // who to ask. The signature is DiveDay's own, so this is a real diver on a
    // real booking rather than a guess, and what the card adds is the shop's
    // own published name and contact details — nothing the shop hides, and
    // exactly what the other three booking tokens already hand over.
    //
    // **One sentence covers a cancelled booking and a no-show**, deliberately,
    // so the failure state never itself discloses which of the two happened —
    // the fail-closed uniformity `getRecapPageData` was written for, kept
    // where it is actually about the diver.
    const didNotDive = review === "did_not_dive" || photo === "cancelled";
    return (
      <ExpiredLinkCard
        title={deadT("recap.unavailableHeading")}
        text={deadT(didNotDive ? "recap.didNotDiveBody" : "waiver.unavailableBody")}
        shop={state.shop}
        t={deadT}
      />
    );
  }

  const { data } = state;
  const { locale, t } = await requestTranslator(data.shop.defaultLocale);
  const props = await buildAfterStateProps({
    db,
    data,
    bookingId,
    locale,
    t,
    params: { review, photo, tip },
    actions: {
      submitReview: submitReviewAction.bind(null, token),
      uploadPhoto: uploadRecapPhotoAction.bind(null, token),
      startTip: startTipAction.bind(null, token),
    },
  });

  return (
    <DiverIntlProvider
      locale={locale}
      timeZone={data.shop.timezone}
      namespaces={["recap", "common", "booking", "reviews", "trip"]}
    >
      <AfterState {...props} />
    </DiverIntlProvider>
  );
}
