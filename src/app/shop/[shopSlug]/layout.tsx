import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { switchDemoRoleAction } from "@/app/actions/demo";
import { createDiverFromSearchAction } from "@/app/actions/divers";
import { setLocaleAction } from "@/app/actions/set-locale";
import { DemoBanner } from "@/components/DemoBanner";
import { OfflineManifestAutoSave } from "@/components/OfflineManifestAutoSave";
import { ShopNav } from "@/components/ShopNav";
import { SkipLink } from "@/components/SkipLink";
import { countBlockedDivers } from "@/db/blockers";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { todayNextDepartureTripId } from "@/db/today";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import {
  canManageShopSettings,
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canViewShopReports,
  isStaff,
} from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { DEMO_ROLE_KEYS, DEMO_ROLE_META } from "@/lib/demo-roles";

/**
 * Every /shop page reads the session, the shop row, and staff-role state up
 * front — genuinely request-scoped, not something a static shell can serve.
 * Under Cache Components, that unwrapped `headers()`/`auth()`/DB access would
 * otherwise fail the build ("blocking-prerender-dynamic": the fix options are
 * cache it, wrap it in `<Suspense>`, or explicitly allow the block). None of
 * `/shop/**` is a candidate for a static shell or Partial Prerendering — it's
 * staff-only, auth-gated, and safety-critical (manifests, roll call, cert and
 * medical data) — so this opts the whole subtree (schedule, manifest,
 * waivers, orders, divers, trips, offline-manifest, everything under
 * `/shop/[shopSlug]/**`) out with `instant = false` rather than restructure
 * it around Suspense boundaries. This keeps the route exactly as fully
 * dynamic and request-scoped as it was before Cache Components — same
 * render-per-request behavior, just no longer implied by the old
 * "reading headers() opts the whole route into dynamic rendering" model.
 * `instant = false` does not itself force dynamic rendering (a genuinely
 * prerenderable descendant would still get a static shell); it only permits
 * *this* layout's already-inherent blocking reads to run without erroring.
 * Do not remove without an accompanying restructure verified end to end —
 * see the safety-critical-surfaces rule in AGENTS.md.
 */
export const instant = false;

/**
 * Staff-surface shell. Every page below it is staff-only — the diver-facing
 * schedule, trip, and course pages that used to be carved out of this
 * namespace by an allowlist now live under `/s/[shopSlug]` with a shell of
 * their own (ADR 20260803-public-shop-namespace), so this layout no longer has
 * a signed-out branch or an embed mode to account for.
 *
 * If the shop is a demo shop, it hangs the demo banner (with its reset) above
 * every /shop page so the "this is a playground" framing is always present
 * (docs ADR 20260718-demo-mode).
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const db = await getDb();
  // The shop row and the session don't depend on one another — resolve them
  // together instead of serially. The tenant checks below still run before
  // anything renders, so the notFound() gating is unchanged.
  const [shop, session] = await Promise.all([getShopBySlug(db, shopSlug), auth()]);
  const showBanner = shop?.isDemo ?? false;
  // Staff read chrome in the language their own device asks for, same
  // negotiation as every other staff surface.
  const locale = await requestLocale(shop?.defaultLocale);

  async function todayBoatHref(
    dbi: typeof db,
    shopId: string,
    timeZone: string,
    slug: string,
  ): Promise<string | undefined> {
    const tripId = await todayNextDepartureTripId(dbi, shopId, timeZone);
    // The manifest opens on its "Before departure" checkpoint — the boarding pass.
    return tripId ? `/shop/${slug}/trips/${tripId}/manifest` : undefined;
  }

  // Owner and diver (public guest) are always offered; instructor/divemaster/
  // captain only appear when this shop actually seeded someone in that role, so
  // the role switcher never presents a card that would no-op.
  let availableRoles: string[] = ["owner", "diver"];
  if (showBanner && shop) {
    const present = new Set(
      (
        await db
          .selectDistinct({ role: personRoles.role })
          .from(personRoles)
          .innerJoin(people, eq(people.id, personRoles.personId))
          .where(eq(people.shopId, shop.id))
      ).map((row) => row.role),
    );
    availableRoles = [
      "owner",
      ...(["instructor", "divemaster", "captain"] as const).filter((role) => present.has(role)),
      "diver",
    ];
  }

  let currentRole: "owner" | "instructor" | "divemaster" | "captain" | "diver" = "diver";
  if (session?.user) {
    if (session.user.roles.includes("owner") || session.user.roles.includes("manager")) {
      currentRole = "owner";
    } else if (session.user.roles.includes("instructor")) {
      currentRole = "instructor";
    } else if (session.user.roles.includes("divemaster")) {
      currentRole = "divemaster";
    } else if (session.user.roles.includes("captain")) {
      currentRole = "captain";
    }
  }

  const demoT = showBanner ? diverTranslator(locale) : undefined;
  const staffT = staffTranslator(locale);

  // INVARIANT: staff chrome and counts are scoped to the session's own shop —
  // a mismatched slug renders nothing of the other tenant.
  //
  // This layout resolves the shop from the URL slug, but every staff *page*
  // below it reads its data from `session.user.shopId`. Without this check the
  // two disagree the moment someone signed into shop A opens
  // /shop/shop-b/anything: the page shows A's rows while the shell around it
  // shows B's name, B's next departure, and B's pending-work counts (reviews
  // awaiting moderation, blocked divers — which include medical review). Those
  // counts are another tenant's operational data, and no page-level gate can
  // catch them because they are read here, in the shell. Since the public
  // namespace split (ADR 20260803-public-shop-namespace) everything under
  // /shop is staff-only, so a cross-tenant visit has no public carve-out:
  // it is refused outright rather than rendered as a mix of two shops.
  const ownShop = Boolean(session?.user && shop && session.user.shopId === shop.id);
  if (session?.user && shop && !ownShop) notFound();
  // An unknown slug is nobody's shop: without this, a signed-in staffer
  // visiting /shop/no-such-shop/divers would get their *own* roster rendered
  // under a foreign-looking URL — not a leak, but a phishing-shaped breach of
  // the "slug and session agree" invariant above.
  if (session?.user && !shop) notFound();

  const showNav = ownShop;
  // The blocked-diver count for Today's nav badge (task 83) — a query the
  // shop's own pages already run on every visit, gated the same way the nav
  // itself is so a signed-out or embedded render never pays for it. (The old
  // Reviews badge moved onto Today's queue as a `reviews_pending` row — a
  // queue's signal belongs on the page that ranks work, not on a nav row.)
  // The boat-boarding link rides along: it doesn't depend on the count, so
  // the two resolve together instead of serially.
  const [navBlockersCount, boatBoardingHref] =
    showNav && session?.user && shop
      ? await Promise.all([
          countBlockedDivers(db, shop.id, nowDate()),
          todayBoatHref(db, shop.id, shop.timezone, shopSlug),
        ])
      : [0, undefined];

  return (
    <>
      {/* Every /shop page fronts ShopNav's 10-15 header tab stops (persona 14,
          ux-personas-20260730-findings.md) — this jumps a keyboard user past it and the
          demo banner straight to the page's own content. Unconditional, like
          the manifest's own skip link. */}
      <SkipLink href="#shop-main-content" label={staffT("shared.skipToContent")} />
      {showBanner && demoT ? (
        <DemoBanner
          switchRole={switchDemoRoleAction}
          currentRole={currentRole}
          currentName={session?.user?.name}
          shopSlug={shopSlug}
          roles={DEMO_ROLE_META.filter((role) => availableRoles.includes(role.id)).map((role) => {
            const title = demoT(DEMO_ROLE_KEYS[role.id].title);
            return {
              ...role,
              title,
              desc: demoT(DEMO_ROLE_KEYS[role.id].desc),
              tryThis: demoT(DEMO_ROLE_KEYS[role.id].tryThis),
              switchAriaLabel: demoT("demo.switchToAria", { role: title }),
            };
          })}
          copy={{
            shopLabel: demoT("demo.shopLabel"),
            viewingAs: demoT("demo.viewingAs"),
            switchRole: demoT("demo.switchRole"),
            sharedWarning: demoT("demo.sharedWarning"),
            sessionExpired: demoT("demo.sessionExpired"),
            withCredentials: demoT("demo.withCredentials"),
            active: demoT("demo.active"),
            tryLabel: demoT("demo.tryLabel"),
            current: demoT("demo.current"),
            switchAction: demoT("demo.switchAction"),
            switchFailed: demoT("demo.switchFailed"),
          }}
          // A minted (per-visitor) demo is addressable by its slug and readable
          // by anyone who has it, so warn against entering real customer data;
          // the canonical fixture demo holds only sample data and stays quiet.
          isMintedDemo={shop?.slug !== DEMO_SHOP_SLUG}
          currentEmail={session?.user?.email}
          demoPassword={DEMO_BYPASS_PASSWORD}
        />
      ) : null}
      {showNav && session?.user && shop ? (
        <ShopNav
          shopSlug={shopSlug}
          shopName={shop.name}
          logoUrl={shop.logoUrl ?? undefined}
          boatBoardingHref={boatBoardingHref}
          navGates={{
            waivers: canManageWaiverTemplates(session.user.roles),
            reports: canViewShopReports(session.user.roles),
            team: canManageStaffAccounts(session.user.roles),
            settings: canManageShopSettings(session.user.roles),
          }}
          navCounts={{ blockers: navBlockersCount }}
          locale={locale}
          setLocale={setLocaleAction}
          createDiverAction={createDiverFromSearchAction}
        />
      ) : null}
      {/* Keeps every trip in the shop's near-term board saved offline, not just
          a trip whose live manifest someone opened — see ADR
          20260726-shopwide-offline-manifest-priming. `ownShop` (the tenant
          invariant above) keeps staff of a *different* shop from silently
          saving their own shop's roster while the visible page is this one. */}
      {ownShop && session?.user && isStaff(session.user.roles) ? <OfflineManifestAutoSave /> : null}
      {/* Below `lg` the phone dock (StaffTabBar) owns the bottom edge, so the
          content wrapper both publishes the clearance it demands and pads
          itself by it — pages never end underneath the dock, and any fixed
          element that shares the bottom edge (UndoToast) adds the same
          `--dock-clearance` to its own offset. The live manifest's `.boat-mode`
          root under the trip main is the deliberate full-viewport exception;
          globals.css clears the variable there. From `lg` up it collapses to
          zero and everything sits where it always did. */}
      <div
        id="shop-main-content"
        tabIndex={-1}
        className="flex-1 outline-none [--dock-clearance:4.5rem] pb-(--dock-clearance) lg:[--dock-clearance:0rem]"
      >
        {children}
      </div>
    </>
  );
}
