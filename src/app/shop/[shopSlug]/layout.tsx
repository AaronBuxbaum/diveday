import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { DemoBanner } from "@/components/DemoBanner";
import { OfflineManifestAutoSave } from "@/components/OfflineManifestAutoSave";
import { PreserveFormScroll } from "@/components/PreserveFormScroll";
import { ShopNav } from "@/components/ShopNav";
import { countBlockedDivers } from "@/db/blockers";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { countReviewsAwaitingModeration } from "@/db/reviews";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { todayNextDepartureTripId } from "@/db/today";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { auth } from "@/lib/auth";
import { EMBED_REQUEST_HEADER } from "@/lib/auth.config";
import {
  canManageStaffAccounts,
  canManageWaiverTemplates,
  canViewShopReports,
  isStaff,
} from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { DEMO_ROLE_KEYS, DEMO_ROLE_META } from "@/lib/demo-roles";

/**
 * Staff-surface shell. If the shop is a demo shop, it hangs the demo banner
 * (with its reset) above every /shop page so the "this is a playground" framing
 * is always present (docs ADR 20260718-demo-mode).
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // Set only by src/proxy.ts on a genuine embed request — a layout is never
  // handed searchParams directly, so this header is the one way it learns
  // "this render is going into someone else's iframe." Forces every bit of
  // staff chrome off, even for a signed-in staff member previewing their own
  // embed (docs ADR 20260726-schedule-embed).
  const isEmbed = (await headers()).get(EMBED_REQUEST_HEADER) === "1";
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const showBanner = !isEmbed && (shop?.isDemo ?? false);
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

  const session = await auth();
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

  const demoT = showBanner ? diverTranslator(await requestLocale(shop?.defaultLocale)) : undefined;

  const showNav = !isEmbed && Boolean(session?.user) && Boolean(shop);
  // Small "pending work" counts for the Reviews/Blockers nav badges (task 83,
  // UX persona 11 "Kai"/12 "Maren") — both queries the shop's own pages
  // already run on every visit, gated the same way the nav itself is so a
  // signed-out or embedded render never pays for them.
  const [navReviewsCount, navBlockersCount] =
    showNav && session?.user && shop
      ? await Promise.all([
          countReviewsAwaitingModeration(db, shop.id),
          countBlockedDivers(db, shop.id, nowDate()),
        ])
      : [0, 0];

  return (
    <>
      {showBanner && demoT ? (
        <DemoBanner
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
            chooseRole: demoT("demo.chooseRole"),
            active: demoT("demo.active"),
            tryLabel: demoT("demo.tryLabel"),
            current: demoT("demo.current"),
            switchAction: demoT("demo.switchAction"),
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
          boatBoardingHref={await todayBoatHref(db, shop.id, shop.timezone, shopSlug)}
          navGates={{
            waivers: canManageWaiverTemplates(session.user.roles),
            reports: canViewShopReports(session.user.roles),
            team: canManageStaffAccounts(session.user.roles),
          }}
          navCounts={{ reviews: navReviewsCount, blockers: navBlockersCount }}
          locale={locale}
        />
      ) : null}
      {/* Keeps every trip in the shop's near-term board saved offline, not just
          a trip whose live manifest someone opened — see ADR
          20260726-shopwide-offline-manifest-priming. Gated to staff actually
          signed into *this* routed shop: several /shop/[shopSlug] pages
          (schedule, courses) are public per isPublicShopRoute, so a signed-out
          visitor, a diver account, or staff of a *different* shop browsing
          this one's public page must never mount it — the first two would
          just poll a 401 every five minutes, and the third would silently
          save their own shop's roster while the visible page is this one. */}
      {!isEmbed &&
      session?.user &&
      shop &&
      isStaff(session.user.roles) &&
      session.user.shopId === shop.id ? (
        <OfflineManifestAutoSave />
      ) : null}
      <PreserveFormScroll />
      <div className="flex-1">{children}</div>
    </>
  );
}
