/**
 * **The shop's chrome, as four components a route other than `layout.tsx` can
 * also render.**
 *
 * Every one of these used to live in `src/app/s/[shopSlug]/layout.tsx` and is
 * moved here byte for byte — no prop, no wrapper, no reordering — so the
 * pixels on every live `/s/**` page are identical by construction and a visual
 * diff on one of them means a mistake rather than a decision.
 *
 * The second caller is `src/app/not-found.tsx`. Since the public namespace
 * started refusing dead URLs above the streaming boundary (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge), a diver who taps a link
 * that has outlived its departure is answered by a proxy rewrite to
 * `/_not-found` — which renders under the *root* layout, where the segment
 * layout below this folder never runs. Issue #765's rule is that such a diver
 * still lands somewhere that looks like the shop they were trying to reach, so
 * `/_not-found` composes these four itself for the slug the proxy named.
 *
 * They stay under `src/app/**` rather than moving to `src/components/`:
 * `PublicShopChrome` takes two Server Actions from `@/app/actions`, and
 * `scripts/check-architecture.mjs` bans `src/components` → `src/app`.
 */

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { switchDemoRoleAction } from "@/app/actions/demo";
import { setLocaleAction } from "@/app/actions/set-locale";
import { BrandStyle } from "@/components/BrandStyle";
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
import { languageEndonym, localeEndonym } from "@/i18n/language-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { requestLanguageFallback, requestLocale } from "@/i18n/request";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import { DEMO_ROLE_KEYS, DEMO_ROLE_META } from "@/lib/demo-roles";
import {
  EMBED_BRAND_HEADER,
  EMBED_FONT_HEADER,
  EMBED_REQUEST_HEADER,
  parseEmbedBrandParam,
  parseEmbedFontParam,
} from "@/lib/embed-routes";
import { cachedListFormat } from "@/lib/intl-cache";
import { publicCoursesPath, publicSchedulePath } from "@/lib/public-routes";
import { isLiveShopStaff } from "@/lib/session";

/**
 * Everything above the page: the negotiated skip link, the demo banner and its
 * role switcher, the "you work here" staff bar, and the shop's own header nav.
 * One boundary rather than four because they are one visual band — streaming
 * them in separately would reflow the top of the page three times.
 */
export async function PublicShopChrome({ params }: { params: Promise<{ shopSlug: string }> }) {
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
export async function PublicShopFooterSection({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
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
 * `PublicShopHeader`'s own box exactly — which since ADR
 * 20260827-clearwater-surface-language (decision 10) is one token,
 * `--chrome-h`, rather than a padded row this had to re-derive — so nothing
 * below it moves when the real header streams in.
 *
 * Wordless and `aria-hidden`: every string in that header is the shop's own —
 * its name, and which of its pages exist — and none is knowable before the shop
 * row is read. Hiding it from the accessibility tree also keeps
 * `getByRole("banner")` in the e2e suite resolving to the real header rather
 * than to two candidates.
 */
export function PublicShopChromePlaceholder({ label }: { label: DiverTranslator }) {
  return (
    <>
      <SkipLink href="#public-shop-main-content" label={label("shopChrome.skipToContent")} />
      {/* Marked so a visual capture can tell this band from the real chrome.
          `capture()` (e2e/visual.spec.ts) waits for the page's own skeleton to
          leave `<main>`, and this bar is *above* `<main>` — so a shot fired
          while it still stood photographed a header with no shop name and,
          on a staffer's own shop, no "you work here" bar at all. One run had
          that at vw-390 and the real chrome at vw-1280, a second apart. */}
      <div
        className="h-(--chrome-h) border-b border-border bg-background"
        data-suspense-placeholder
        aria-hidden
      />
    </>
  );
}

export async function PublicShopBrand({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const shop = await getShopBySlug(await getDb(), shopSlug);
  if (!shop) return null;
  // An embed that inherits its host page arrives with the host's colour and
  // face, validated and forwarded by the proxy; the host wins over the shop's
  // own setting, because the widget is sitting *on* that page.
  const requestHeaders = await headers();
  const hostColor = parseEmbedBrandParam(requestHeaders.get(EMBED_BRAND_HEADER));
  const hostFont = parseEmbedFontParam(requestHeaders.get(EMBED_FONT_HEADER));
  return (
    <BrandStyle
      brandColor={hostColor ?? shop.brandColor}
      brandDisplayFont={hostFont ? null : shop.brandDisplayFont}
      hostFont={hostFont}
    />
  );
}
