import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { switchDemoRoleAction } from "@/app/actions/demo";
import { createDiverFromSearchAction } from "@/app/actions/divers";
import { setLocaleAction } from "@/app/actions/set-locale";
import { DemoBanner } from "@/components/DemoBanner";
import { OfflineManifestAutoSave } from "@/components/OfflineManifestAutoSave";
import { ShopNav } from "@/components/ShopNav";
import { SkipLink } from "@/components/SkipLink";
import { WaterBandStyle } from "@/components/WaterBandStyle";
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
import { waterBandFor } from "@/lib/water-band";

/**
 * **Everything above a staff page that has to be asked of this request** — the
 * session, the shop row, the negotiated locale, the demo roles, the tenant
 * gate, the nav and its badge (issue #1446).
 *
 * It lives here rather than in `layout.tsx` for one reason: a layout wraps its
 * page, so no `<Suspense>` boundary can be placed between the two. Every await
 * the shell did above `{children}` was therefore a await the *page* waited on,
 * and the staff shell had six of them — `params`, the db handle, the shop row
 * and session together, the locale, a role query, and the blocked-diver count
 * with the boat link. A staffer turning a page of the roster watched the
 * server re-resolve all of it before anything painted, on every navigation,
 * for chrome that had not changed.
 *
 * Pulled into its own component, all of it sits *beside* `{children}` instead
 * of above it, behind a boundary that holds the bar's own height. The page's
 * `loading.tsx` paints immediately and the chrome streams in at its own pace.
 * This is the same shape `src/app/s/[shopSlug]/layout.tsx` already uses for the
 * diver-facing shell.
 *
 * **The tenant gate moved with it, and that is safe because it was never the
 * only copy** — not because this component is careful. Every staff *page*
 * below gates itself: 43 of the 47 call `requireShopSurface`
 * (`src/lib/session.ts`), which `notFound()`s when the session's shop
 * disagrees with the slug; `check-in`, `check-in/walk-in` and `courses` assert
 * the same two conditions inline; and the shop home does now too. The home is
 * worth naming because it did **not** before this change — it resolved its own
 * shop by `session.user.shopId` and never compared the slug, because this
 * shell compared it on the home's behalf. A shell that streams beside the page
 * cannot do that any more, which is exactly what a `security-reviewer` pass on
 * this change found. The doubling is real; it just had one hole, and closing
 * it is part of the same change.
 *
 * What `ownShop` adds is the second half: every piece of chrome that names a
 * shop — its name, its counts, its next departure, the demo banner, the water
 * band, the offline priming — is behind it, so nothing here renders for a
 * request that has not proved it may see this shop. That matters most for a
 * request whose session did not resolve at all: the two refusals below both
 * require a session, and the edge check in `src/proxy.ts` is a cookie-presence
 * test rather than a signature one, so a forged cookie arrives here with
 * `session` null. The page beside this one refuses it; this renders it
 * nothing.
 */
export async function ShopChrome({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const db = await getDb();
  // The shop row and the session don't depend on one another — resolve them
  // together instead of serially, and nothing else is read until the two
  // refusals below have run — so the gate's correctness does not depend on
  // where a later line happens to sit in this file.
  const [shop, session] = await Promise.all([getShopBySlug(db, shopSlug), auth()]);

  // INVARIANT: staff chrome and counts are scoped to the session's own shop —
  // a mismatched slug renders nothing of the other tenant.
  //
  // This component resolves the shop from the URL slug, but every staff *page*
  // beside it reads its data from `session.user.shopId`. Without this check the
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

  const showBanner = shop?.isDemo ?? false;
  // Staff read chrome in the language their own device asks for, same
  // negotiation as every other staff surface.
  const locale = await requestLocale(shop?.defaultLocale);

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

  // Staff, not merely this shop's session. `OfflineManifestAutoSave` below
  // already asks both questions; the nav asked only the first, and it carries
  // the blocked-diver count — divers held back by medical review — as well as
  // the shop's next departure. Nothing can reach here without a staff role
  // today (`verifyCredentials` refuses a non-staff sign-in and the proxy
  // bounces one), but neither of those is this file's boundary to lean on.
  const showNav = ownShop && session?.user ? isStaff(session.user.roles) : false;
  // The blocked-diver count for Today's nav badge (task 83) and the
  // boat-boarding link, gated the same way the nav itself is so a render that
  // shows no nav never pays for them. They do not depend on one another, so
  // they resolve together rather than serially.
  //
  // **The count stays here rather than streaming into the badge separately.**
  // It is the chrome's one expensive read — about ten queries and ~37ms on the
  // seeded fixture (`src/db/blockers.ts`) — so a slot was the obvious next
  // optimisation, and it is the wrong one: the number is also the `{count}` of
  // the badge's pluralised accessible label (`shared.shopNavLinks.badgeBlocked`
  // in `ShopNavLinks`), so an opaque ReactNode would leave a screen reader
  // hearing "0 blocked" until it arrived, on a badge that counts divers held
  // back by medical review. The whole chrome already streams beside the page,
  // which is what issue #1446 was about; buying 37ms off the chrome by
  // mislabelling a safety count is not a trade worth making.
  const [navBlockersCount, boatBoardingHref] =
    showNav && shop
      ? await Promise.all([
          countBlockedDivers(db, shop.id, nowDate()),
          todayNextDepartureTripId(db, shop.id, shop.timezone).then((tripId) =>
            // The manifest opens on its "Before departure" checkpoint — the boarding pass.
            tripId ? `/shop/${shopSlug}/trips/${tripId}/manifest` : undefined,
          ),
        ])
      : [0, undefined];

  return (
    <>
      {/* Reef's page top, at the shop's own hour — see `WaterBandStyle` for why
          it is a `<style>` and not an attribute. Behind `ownShop` like every
          other shop read here, so nothing is emitted and the day wash on the
          base class stands: an unknown slug has no zone, and a request whose
          session did not resolve has not proved it may see this one. The
          refusals above only fire for a request that *has* a session, and the
          proxy's own bounce is a cookie-presence check rather than a signature
          one, so a forged cookie reaches here with `session` null — the page
          beside this one still refuses it, and this renders it nothing. */}
      {ownShop && shop ? <WaterBandStyle band={waterBandFor(nowDate(), shop.timezone)} /> : null}
      {/* Every /shop page fronts ShopNav's 10-15 header tab stops (persona 14,
          ux-personas-20260730-findings.md) — this jumps a keyboard user past it and the
          demo banner straight to the page's own content. Unconditional, like
          the manifest's own skip link. */}
      <SkipLink href="#shop-main-content" label={staffT("shared.skipToContent")} />
      {ownShop && showBanner && demoT ? (
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
    </>
  );
}

/**
 * The bar's own height, and nothing else.
 *
 * It must be exactly `--chrome-h` (`globals.css`): the chrome sits *above* the
 * page, so a fallback of nothing would let a staff page paint at the top of the
 * viewport and jump down the moment the nav arrived — the reflow this whole
 * change exists to avoid, reintroduced one layer up. Nothing is drawn in it: a
 * skeleton of a nav that arrives in a few hundred milliseconds is a flicker,
 * where a reserved band is simply the page starting where it will stay.
 */
export function ShopChromeSkeleton() {
  return <div aria-hidden="true" className="h-(--chrome-h) shrink-0" />;
}
