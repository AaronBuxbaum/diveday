import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { checkDatabase } from "@/db/health";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { overallPlatformStatus, type PlatformComponent } from "@/lib/platform-status";
import { openGraphSite } from "@/lib/site-metadata";
import { StatusReport, StatusReportFallback } from "./_components/StatusReport";

// `instant = true`: the chrome and the page's shape paint immediately from
// `loading.tsx` while the checks below run (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = {
  title: "DiveDay status",
  description: "Whether DiveDay is running right now, checked when you open the page.",
  alternates: { canonical: "/status" },
  openGraph: {
    // `openGraphSite` rather than `sharedLinkCard`: no card image of its own,
    // and Next merges `metadata` shallowly, so a page-level `openGraph` block
    // that omitted this would drop `og:site_name` (src/lib/site-metadata.ts).
    ...openGraphSite,
    title: "DiveDay status",
    description: "Whether DiveDay is running right now.",
    url: "/status",
  },
  twitter: {
    card: "summary",
    title: "DiveDay status",
    description: "Whether DiveDay is running right now.",
  },
  // Not indexed. Someone searching for DiveDay should land on the product, not
  // on a page whose whole content is a state that was true when the crawler
  // read it; a cached "Everything is running" in a result snippet is the one
  // way this page could tell a shop something false.
  robots: { index: false, follow: true },
};

/**
 * The page a shop owner opens when they think DiveDay is down.
 *
 * ## Why it is inside the app it reports on
 *
 * It looks backwards, and the alternative was considered: the AWS dossier's
 * AWS-2 row proposes a static page in S3 behind CloudFront in another region,
 * written by a Lambda subscribed to the alarms. That page survives an outage
 * this one does not. It is also a page that can only ever repeat what an alarm
 * said minutes ago, and the failure it has to survive — total loss of the
 * deployment — is precisely the one the **external monitor** already covers by
 * mailing a human (§22 of `infra/lib/infra-stack.ts`).
 *
 * What this page does instead is the thing a mirrored page cannot: it *checks*,
 * in the request that renders it, and says so with a timestamp. The failure
 * mode it removes is the common one — the app is serving, the database is gone,
 * and every surface a shop touches fails in a way that looks like their wifi.
 * Its own failure mode is honest and legible: if it does not load, that is an
 * answer too. See ADR 20260907-external-uptime-monitor.
 *
 * ## Nothing here is cacheable
 *
 * No `"use cache"` anywhere near the body, unlike every other marketing page.
 * A cached status is a status page that lies, and the `Cache-Control` reasoning
 * in `/api/health` applies with more force to the page a person reads.
 */
export default async function StatusPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<StatusReportFallback />}>
        <StatusBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Runs the checks, then hands codes and finished strings to the view. */
async function StatusBody() {
  // The same line `/api/health` opens with, for the same reason. Under
  // `cacheComponents` a value that changes between renders — the clock, a live
  // query — is refused unless a dynamic access has already opted the render out
  // of the static shell, and neither `nowDate()` nor a direct Drizzle query is
  // something Next tracks. Without it the page's whole point evaporates: the
  // build's answer, frozen, served forever as though it were current.
  await connection();

  const [locale, database] = await Promise.all([requestLocale(), checkDatabase()]);

  const components: PlatformComponent[] = [
    // Not a check: there is a page, so the app is serving. Anything cleverer
    // here would be the app grading its own homework.
    { id: "serving", state: "up" },
    { id: "database", state: database },
  ];

  return (
    <StatusReport
      locale={locale}
      status={overallPlatformStatus(components)}
      components={components}
      // UTC, named on the page: the reader is anonymous, so there is no shop
      // timezone to render in, and an unlabelled time on an incident page is
      // the one that gets misread by hours. `nowDate()` rather than
      // `new Date()` keeps the e2e fleet's frozen clock in charge of the
      // pixels.
      checkedAt={formatDateTimeTz(nowDate(), locale, "UTC")}
      supportEmail={SUPPORT_EMAIL}
    />
  );
}
