import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { switchDemoRoleAction } from "@/app/actions/demo";
import { setLocaleAction } from "@/app/actions/set-locale";
import { DemoBanner } from "@/components/DemoBanner";
import type { LanguageChoice } from "@/components/LanguageChoices";
import { LanguageFallbackNotice } from "@/components/LanguageFallbackNotice";
import { PublicShopFooter, PublicShopHeader } from "@/components/PublicShopChrome";
import type { PublicShopNavItem } from "@/components/PublicShopNav";
import { SkipLink } from "@/components/SkipLink";
import { getDb } from "@/db/client";
import { hasActiveCourses } from "@/db/courses";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listShopSpokenLanguages } from "@/db/staff-accounts";
import { ErrorBoundaryIntlProvider } from "@/i18n/ErrorBoundaryIntlProvider";
import { ERROR_BOUNDARY_MESSAGES_BY_LOCALE } from "@/i18n/error-boundary-messages";
import { languageEndonym, localeEndonym } from "@/i18n/language-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLanguageFallback, requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { EMBED_REQUEST_HEADER } from "@/lib/auth.config";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { DEMO_ROLE_KEYS, DEMO_ROLE_META } from "@/lib/demo-roles";
import { cachedListFormat } from "@/lib/intl-cache";
import { publicCoursesPath, publicSchedulePath } from "@/lib/public-routes";
import { isLiveShopStaff } from "@/lib/session";

/**
 * The diver-facing shell for `/s/[shopSlug]/**` — the shop's own identity,
 * never staff chrome (ADR 20260803-public-shop-namespace). These surfaces used
 * to live inside the auth-gated `/shop` namespace and be carved back out by an
 * allowlist; they now have a namespace of their own, so "public" is a property
 * of the URL rather than of a regular expression.
 *
 * **This function is synchronous, and that is the whole point** (ADR
 * 20260804-instant-navigation). It used to `await` the embed header, the shop
 * row, the negotiated locale, the session, and a `hasActiveCourses` probe
 * before returning anything — five request-scoped reads sitting above
 * `{children}`, which is the one position a `<Suspense>` boundary cannot
 * rescue, because the page *is* the child. That is what `instant = false` was
 * buying here: permission to have no static shell at all.
 *
 * Everything request-scoped now lives in the two async components below, each
 * behind its own boundary, and `{children}` sits outside both. The static
 * shell is the page frame — skip link, a header band holding its own height,
 * the main landmark, and the page's own `loading.tsx` — served without waiting
 * on a database round trip, while the shop's identity and its live inventory
 * stream in behind it.
 */
export default function PublicShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shopSlug: string }>;
}) {
  const fallbackT = diverTranslator(DEFAULT_DIVER_LOCALE);
  return (
    <>
      {/* The fallback holds the header's height as well as its skip link. The
          skip link follows the root layout's pattern — the default-locale label
          is in the static shell so a keyboard user always has a target, and the
          negotiated one replaces it. The height matters more: this band sits
          *above* the page, so a fallback of nothing would let the schedule paint
          at the top of the viewport and then jump down when the shop's header
          arrived. The one case it reads oddly is `?embed=1`, where the real
          chrome is deliberately nothing and this bar therefore disappears —
          a layout cannot see `searchParams`, and the proxy's embed header is a
          request read, which is exactly what this component exists to defer. A
          brief bar inside an iframe is the cheaper of the two mistakes. */}
      <Suspense fallback={<PublicShopChromePlaceholder label={fallbackT} />}>
        <PublicShopChrome params={params} />
      </Suspense>
      <div id="public-shop-main-content" tabIndex={-1} className="flex-1 outline-none">
        {/* Words for `error.tsx`, which renders below this layout and above the
            page (ADR 20260803-error-boundary-copy-bridge). A boundary is a file
            convention with a fixed {error, reset} signature, so it can only read
            copy out of context — one namespace, four short strings. Both
            locales cross to the client, which is what lets this provider stay
            synchronous: a `requestLocale()` here would put a `headers()` read
            above `{children}` and take the static shell back. */}
        <ErrorBoundaryIntlProvider messagesByLocale={ERROR_BOUNDARY_MESSAGES_BY_LOCALE}>
          {children}
        </ErrorBoundaryIntlProvider>
      </div>
      {/* No placeholder: the footer is the last thing on the page, so arriving
          late moves nothing that is already on screen. Reserving space for it
          would only mean an empty bar to look at, and an embed — which drops
          the footer entirely — would have to un-reserve it. */}
      <Suspense fallback={null}>
        <PublicShopFooterSection params={params} />
      </Suspense>
    </>
  );
}

/**
 * Everything above the page: the negotiated skip link, the demo banner and its
 * role switcher, the "you work here" staff bar, and the shop's own header nav.
 * One boundary rather than four because they are one visual band — streaming
 * them in separately would reflow the top of the page three times.
 */
async function PublicShopChrome({ params }: { params: Promise<{ shopSlug: string }> }) {
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
  // "You asked for a language we don't have" — the acknowledgement that used to
  // be missing entirely (review finding I18N-L1). Null whenever the visitor's
  // `Accept-Language` matched a bundle, or carried no preference at all, so the
  // ordinary render is untouched. Gated on `!isEmbed` like every other band in
  // this component: an embed is framed by the shop's own site, which has already
  // told the visitor whose page they are on (ADR 20260726-schedule-embed).
  const languageFallback = isEmbed ? null : await requestLanguageFallback(locale);

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
  // Live-checked (issue #966): it discloses nothing sensitive, but the same
  // stale-JWT gap the other public surfaces had is worth closing uniformly.
  const showStaffBar = !isEmbed && shop !== null && (await isLiveShopStaff(db, shop.id, session));
  const staffT = staffTranslator(locale);
  // Each language named in itself (src/i18n/language-labels.ts): the reader
  // reaching for this is the one who cannot read the page around it.
  //
  // **Every** language, the one in force included — the header discloses them
  // behind a picker now rather than standing them in a row (`LanguagePicker`).
  // It used to pass only the alternatives, which at two locales is a single
  // button reading "español": self-describing, but a swap rather than a
  // choice, and a shape that has no honest rendering at three.
  const languages: LanguageChoice[] = DIVER_LOCALES.map((value) => ({
    locale: value,
    label: localeEndonym(value),
  }));

  return (
    <>
      {/* Diver copy from the diver bundle: this shell never renders staff
          chrome, so the only staff words on it are the "you work here" bar. */}
      <SkipLink href="#public-shop-main-content" label={t("shopChrome.skipToContent")} />
      {showBanner && shop ? (
        <DemoBanner
          switchRole={switchDemoRoleAction}
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
            active: t("demo.active"),
            tryLabel: t("demo.tryLabel"),
            current: t("demo.current"),
            switchAction: t("demo.switchAction"),
            switchFailed: t("demo.switchFailed"),
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
          locale={locale}
          localeLabel={localeEndonym(locale)}
          languages={languages}
          setLocale={setLocaleAction}
          languagePickerCopy={{
            ariaLabel: t("shopChrome.languageAriaLabel"),
            heading: t("shopChrome.languageHeading"),
          }}
        />
      ) : null}
      {/* Below the header on purpose: the shop's own identity is what a diver
          came for, and this line is about the words underneath it. */}
      {languageFallback && shop ? (
        <LanguageFallbackNotice fallback={languageFallback} shopName={shop.name} t={t} />
      ) : null}
    </>
  );
}

/** The shop's name and contact line — needs the shop row and the locale. */
async function PublicShopFooterSection({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const isEmbed = (await headers()).get(EMBED_REQUEST_HEADER) === "1";
  if (isEmbed) return null;
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) return null;
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  // "We speak …" — every language any active staff member has recorded
  // (issue #708), named in each language's own endonym (not the reader's
  // locale) so a diver who reads none of the site's two languages still
  // recognises their own among the badges. Nothing when nobody has recorded
  // one — additive, never a placeholder for an empty shop.
  const spokenLanguages = await listShopSpokenLanguages(db, shop.id);
  const spokenLanguagesLine =
    spokenLanguages.length === 0
      ? null
      : cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
          spokenLanguages.map((code) => languageEndonym(code) ?? code),
        );
  return <PublicShopFooter shop={shop} spokenLanguagesLine={spokenLanguagesLine} t={t} />;
}

/**
 * Holds the header band's height in the static shell, matching
 * `PublicShopHeader`'s own box exactly (`border-b`, `py-2`, and a `min-h-11`
 * row), so nothing below it moves when the real header streams in.
 *
 * Wordless and `aria-hidden`: every string in that header is the shop's own —
 * its name, and which of its pages exist — and none is knowable before the shop
 * row is read. Hiding it from the accessibility tree also keeps
 * `getByRole("banner")` in the e2e suite resolving to the real header rather
 * than to two candidates.
 */
function PublicShopChromePlaceholder({ label }: { label: DiverTranslator }) {
  return (
    <>
      <SkipLink href="#public-shop-main-content" label={label("shopChrome.skipToContent")} />
      <div className="border-b border-border bg-surface" aria-hidden>
        <div className="mx-auto flex w-full max-w-6xl items-center gap-x-4 px-4 py-2 sm:px-6">
          <div className="h-11 w-40 max-w-full" />
        </div>
      </div>
    </>
  );
}
