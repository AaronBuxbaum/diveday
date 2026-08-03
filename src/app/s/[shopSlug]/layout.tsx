import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { DemoBanner } from "@/components/DemoBanner";
import { PreserveFormScroll } from "@/components/PreserveFormScroll";
import { PublicShopFooter, PublicShopHeader } from "@/components/PublicShopChrome";
import type { PublicShopNavItem } from "@/components/PublicShopNav";
import { SkipLink } from "@/components/SkipLink";
import { getDb } from "@/db/client";
import { hasActiveCourses } from "@/db/courses";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { EMBED_REQUEST_HEADER } from "@/lib/auth.config";
import { isStaff } from "@/lib/authz";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { DEMO_ROLE_KEYS, DEMO_ROLE_META } from "@/lib/demo-roles";
import { publicCoursesPath, publicSchedulePath } from "@/lib/public-routes";

/**
 * Same reasoning as `/shop/[shopSlug]`'s layout: every page below reads
 * `headers()`, the session, and the shop row per request, so Cache Components
 * would otherwise fail the build on the blocking read. The schedule is live
 * inventory — a static shell would show yesterday's seats.
 */
export const instant = false;

/**
 * The diver-facing shell for `/s/[shopSlug]/**` — the shop's own identity,
 * never staff chrome (ADR 20260803-public-shop-namespace). These surfaces used
 * to live inside the auth-gated `/shop` namespace and be carved back out by an
 * allowlist; they now have a namespace of their own, so "public" is a property
 * of the URL rather than of a regular expression.
 */
export default async function PublicShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // Set only by src/proxy.ts on a genuine embed request — a layout is never
  // handed searchParams directly, so this header is the one way it learns
  // "this render is going into someone else's iframe" (ADR
  // 20260726-schedule-embed). Everything chrome-shaped comes off in that mode.
  const isEmbed = (await headers()).get(EMBED_REQUEST_HEADER) === "1";
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  const locale = await requestLocale(shop?.defaultLocale);
  const t = diverTranslator(locale);
  const showBanner = !isEmbed && (shop?.isDemo ?? false);

  // Owner and diver (public guest) are always offered; instructor/divemaster/
  // captain only appear when this shop actually seeded someone in that role.
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

  // The public map, built once for the whole namespace so no page has to grow
  // its own cross-links. Courses only earns a tab when the shop has something
  // to teach — an existence probe (`limit 1`), not a catalog read, because it
  // runs on every public render and the header shows no number. Skipped
  // entirely for an embed, which drops the header anyway.
  const navItems: PublicShopNavItem[] = [];
  if (!isEmbed && shop) {
    navItems.push({ href: publicSchedulePath(shop.slug), label: t("schedule.title") });
    if (await hasActiveCourses(db, shop.id)) {
      navItems.push({ href: publicCoursesPath(shop.slug), label: t("courses.index.title") });
    }
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

  // Staff are no longer redirected off their own shop's public pages — this is
  // the page divers buy from, and staff need to be able to look at it. A slim
  // bar says "you work here" and points back at the operations board, so
  // nobody is stranded on a diver surface with no staff chrome (task 153).
  const showStaffBar =
    !isEmbed &&
    Boolean(session?.user) &&
    Boolean(shop) &&
    isStaff(session?.user?.roles) &&
    session?.user?.shopId === shop?.id;
  const staffT = staffTranslator(locale);

  return (
    <>
      {/* Diver copy from the diver bundle: this shell never renders staff
          chrome, so the only staff words on it are the "you work here" bar. */}
      <SkipLink href="#public-shop-main-content" label={t("shopChrome.skipToContent")} />
      {showBanner && shop ? (
        <DemoBanner
          currentRole={currentRole}
          currentName={session?.user?.name}
          shopSlug={shopSlug}
          roles={DEMO_ROLE_META.filter((role) => availableRoles.includes(role.id)).map((role) => {
            const title = t(DEMO_ROLE_KEYS[role.id].title);
            return {
              ...role,
              title,
              desc: t(DEMO_ROLE_KEYS[role.id].desc),
              tryThis: t(DEMO_ROLE_KEYS[role.id].tryThis),
              switchAriaLabel: t("demo.switchToAria", { role: title }),
            };
          })}
          copy={{
            shopLabel: t("demo.shopLabel"),
            viewingAs: t("demo.viewingAs"),
            switchRole: t("demo.switchRole"),
            sharedWarning: t("demo.sharedWarning"),
            sessionExpired: t("demo.sessionExpired"),
            withCredentials: t("demo.withCredentials"),
            chooseRole: t("demo.chooseRole"),
            active: t("demo.active"),
            tryLabel: t("demo.tryLabel"),
            current: t("demo.current"),
            switchAction: t("demo.switchAction"),
          }}
          isMintedDemo={shop.slug !== DEMO_SHOP_SLUG}
          currentEmail={session?.user?.email}
          demoPassword={DEMO_BYPASS_PASSWORD}
        />
      ) : null}
      {showStaffBar && shop ? (
        <div className="border-b border-border bg-surface-sunken">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
            <p className="text-muted">{staffT("shared.publicPreview.youWorkHere")}</p>
            <Link
              href={`/shop/${shop.slug}/schedule/board`}
              className="font-medium text-primary hover:underline"
            >
              {staffT("shared.publicPreview.openTheBoard")}
            </Link>
          </div>
        </div>
      ) : null}
      {!isEmbed && shop ? (
        <PublicShopHeader
          shop={shop}
          navAriaLabel={t("shopChrome.navAriaLabel")}
          navItems={navItems}
        />
      ) : null}
      <PreserveFormScroll />
      <div id="public-shop-main-content" tabIndex={-1} className="flex-1 outline-none">
        {/* Words for `error.tsx`, which renders below this layout and above the
            page (ADR 20260803-error-boundary-copy-bridge). A boundary is a
            file convention with a fixed {error, reset} signature, so it can
            only read copy out of context — one namespace, four short strings.
            Unlike the bearer-token layouts this one already knows the shop, so
            `requestLocale` keeps its default and the timezone is the real one. */}
        <DiverIntlProvider
          locale={locale}
          timeZone={shop?.timezone ?? "UTC"}
          namespaces={["errorBoundary"]}
        >
          {children}
        </DiverIntlProvider>
      </div>
      {!isEmbed && shop ? <PublicShopFooter shop={shop} t={t} /> : null}
    </>
  );
}
