import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SearchField } from "@/components/ui/form";
import { groupLabelClass, LedgerRow } from "@/components/ui/ledger";
import { QueryForm } from "@/components/ui/QueryForm";
import { getDb } from "@/db/client";
import {
  countGlobalDiveSiteTemplates,
  currentGlobalDiveSiteVersions,
  diveSiteLibrarySize,
  type GlobalDiveSiteTemplateRow,
  getGlobalDiveSiteTemplate,
  groupSiteLibrary,
  importGlobalDiveSiteTemplate,
  listDiveSitesPage,
  listGlobalDiveSiteTemplates,
} from "@/db/dive-sites";
import { isMarineLifeSlug } from "@/db/marine-life-catalog";
import { getShopById } from "@/db/shops";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import { type DiverTranslator, diverTranslator } from "@/i18n/messages";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { parseDiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import { SiteLibraryLedger } from "./_components/SiteLibraryLedger";

/** `?notice=` codes this page redirects back to itself with. Read through
 * `noticeFromParam`, never a bare `NOTICES[notice]` — the param is
 * attacker-supplied (src/lib/staff-notices.ts). */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  deleted: { tone: "success", key: "diveSites.list.siteDeletedNotice" },
};

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Dive sites — DiveDay" };

export default async function DiveSitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    q?: string;
    page?: string;
    view?: string;
    template?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { notice, q, page, view, template } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // A template's field guide is diver copy, so the catalog preview reads it
  // through the diver bundle -- in the staffer's own language, same locale.
  const diverT = diverTranslator(locale);

  // The published site catalog re-sorts nothing of the library's own evidence
  // — it is DiveDay's own dataset — but it was reachable from exactly two
  // buttons on this page and nowhere else, so it earns the same treatment as
  // Not ready (ADR 20260803-not-ready-is-a-view / 20260806-dive-site-catalog-is-a-view):
  // one route, a `?view=` switch, and a 308 from the URL it used to own.
  if (view === "catalog") {
    return <CatalogView shopSlug={shopSlug} t={t} diverT={diverT} page={page} slug={template} />;
  }

  // A non-numeric or missing `?page=` reads as page 1 rather than NaN.
  const requestedPage = Number.parseInt(page ?? "", 10);
  const query = q?.trim() ?? "";
  const [sitePage, librarySize, catalogSize] = await Promise.all([
    listDiveSitesPage(
      db,
      shop.id,
      { query: query || undefined },
      { page: Number.isFinite(requestedPage) ? requestedPage : 1 },
    ),
    // Shop-wide, never page- or search-scoped. It answers one question — does
    // this shop have a library yet? — which is what separates the day-one
    // empty state from a search that simply matched nothing.
    diveSiteLibrarySize(db, shop.id),
    // The tail door's number, over the whole published catalog — never the
    // `total` of a page nobody has fetched yet (ADR 20260827-the-shops-shelves).
    countGlobalDiveSiteTemplates(db),
  ]);
  const sites = sitePage.rows;
  const banner = noticeFromParam(notice, NOTICES);
  // Looked up for exactly the imported sites on this page, not read off the
  // whole published catalog — that catalog pages now, and indexing one page of
  // it would quietly drop the "newer version published" badge for every site
  // sourced from a template past it.
  const currentTemplateVersion = await currentGlobalDiveSiteVersions(
    db,
    sites.map((site) => site.sourceTemplateId).filter((id): id is string => Boolean(id)),
  );

  /** This page's URL with the search kept and only `page` swapped. */
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (target > 1) search.set("page", String(target));
    const encoded = search.toString();
    return encoded ? `/shop/${shopSlug}/dive-sites?${encoded}` : `/shop/${shopSlug}/dive-sites`;
  };
  const catalogHref = `/shop/${shopSlug}/dive-sites?view=catalog`;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
        title={t("diveSites.list.title")}
        // An empty library gets no header action: the empty card below is
        // already the whole page, and it carries both doors. Two identical
        // primaries on one screen is what principle 8 forbids — so the card
        // owns them until there is a library to act on.
        //
        // One action, not two: the catalog's "Browse templates" secondary
        // retired the day the ledger grew its own tail door (ADR
        // 20260827-the-shops-shelves), which is where a shop looking for a site
        // it has not written yet is already looking.
        actions={
          librarySize === 0 ? undefined : (
            <Link href={`/shop/${shopSlug}/dive-sites/new`} className={buttonClass()}>
              <span aria-hidden="true">+</span> {t("diveSites.list.createSite")}
            </Link>
          )
        }
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      {/* Unconditional once there is anything to search: a library that hid
        its search box below some size would teach staff to scroll, and the
        one shop that grows past a screenful is exactly the one that never
        learned the box exists. Hidden only when the library is empty, where
        the empty state has the single thing to do. */}
      {librarySize > 0 ? (
        <QueryForm
          aria-label={t("diveSites.list.searchAriaLabel")}
          // A toolbar, not a card: the one search box every staff list wears
          // (`SearchField`), and beside it only the way back out. The bordered
          // band with a "Find a site" caption and a Search button that stood
          // here was the third grammar for the same control in the app.
          className="mb-6 flex items-center gap-2"
        >
          <SearchField
            id="site-search"
            name="q"
            label={t("diveSites.list.searchLabel")}
            defaultValue={query}
            placeholder={t("diveSites.list.searchPlaceholder")}
            className="w-full min-w-0 sm:w-80"
          />
          {query ? (
            // The glyph a search box clears with everywhere else, through the
            // shared `size: "icon"` box rather than a hand-spelled square —
            // 44px, and the same construction as the crew chip's unassign and
            // the report navigator's arrows. The words survive as the
            // accessible name, so nothing is lost to a screen reader or to
            // the e2e spec that clicks it by name.
            <Link
              href={`/shop/${shopSlug}/dive-sites`}
              scroll={false}
              aria-label={t("diveSites.list.searchClear")}
              title={t("diveSites.list.searchClear")}
              className={buttonClass({ variant: "ghost", size: "icon" })}
            >
              <span aria-hidden="true">×</span>
            </Link>
          ) : null}
        </QueryForm>
      ) : null}

      {sites.length === 0 ? (
        <EmptyState
          title={query ? t("diveSites.list.noMatchHeading") : t("diveSites.list.emptyHeading")}
          body={t("diveSites.list.emptyBody")}
          action={
            query || librarySize > 0 ? null : (
              // The only place these two doors exist on an empty library: the
              // header drops its actions when the library is empty precisely so
              // this card owns them, and a shop reading "start with a site your
              // crew knows well" can start from that sentence.
              // Same pair, same order as the header's: the primary last.
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Link
                  href={catalogHref}
                  scroll={false}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("diveSites.list.browseTemplates")}
                </Link>
                <Link href={`/shop/${shopSlug}/dive-sites/new`} className={buttonClass()}>
                  <span aria-hidden="true">+</span> {t("diveSites.list.createSite")}
                </Link>
              </div>
            )
          }
          className="mt-4"
        />
      ) : (
        <SiteLibraryLedger
          groups={groupSiteLibrary(sites)}
          shopSlug={shopSlug}
          t={t}
          diverT={diverT}
          currentTemplateVersion={currentTemplateVersion}
          // The tail door renders only when there is something behind it. A
          // catalog DiveDay has not published into yet would otherwise offer a
          // shop a page of nothing at the foot of its own library.
          catalog={catalogSize > 0 ? { href: catalogHref, count: catalogSize } : null}
        />
      )}

      <Pager
        page={sitePage.page}
        pageCount={sitePage.pageCount}
        href={pageHref}
        total={t("diveSites.list.pagination.total", { count: sitePage.total })}
        t={t}
        className="mt-4"
      />
    </main>
  );
}

/**
 * DiveDay's published site catalog, folded in from its own former route
 * (ADR 20260806-dive-site-catalog-is-a-view). Reachable only from the
 * library's own "Browse templates" doors, so it renders as this page's
 * `?view=catalog` rather than a peer destination — the same move
 * 20260803-not-ready-is-a-view made for the by-departure queue.
 */
async function CatalogView({
  shopSlug,
  t,
  diverT,
  page,
  slug,
}: {
  shopSlug: string;
  t: StaffTranslator;
  diverT: DiverTranslator;
  page?: string;
  /** A template to open in full before deciding — `?view=catalog&template=<slug>`. */
  slug?: string;
}) {
  const back = shopPath(shopSlug, "dive-sites");
  const catalogHref = `${back}?view=catalog`;
  const activeSession = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, activeSession.user.shopId);
  const locationIsProvided = !!(shop.addressStreet && shop.addressLocality);

  if (!locationIsProvided) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href={back}
          scroll={false}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("diveSites.backToLibrary")}
        </Link>
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center bg-card">
          <h2 className="text-lg font-semibold text-foreground">
            {t("diveSites.catalog.locationRequiredTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted max-w-md">
            {t("diveSites.catalog.locationRequiredDescription")}
          </p>
          <div className="mt-6">
            <Link
              href={`${shopPath(shopSlug, "settings")}?section=address`}
              className={buttonClass({ variant: "primary" })}
            >
              {t("diveSites.catalog.goToSettings")}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const shopCoordinates =
    shop.latitude != null && shop.longitude != null
      ? { latitude: shop.latitude, longitude: shop.longitude }
      : null;

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it
  // into range so a bookmarked page past the end lands on the last real one.
  const catalog = await listGlobalDiveSiteTemplates(db, {
    page: Number.parseInt(page ?? "", 10),
    shopCoordinates,
  });
  const pageHref = (target: number) => (target > 1 ? `${catalogHref}&page=${target}` : catalogHref);
  async function importAction(formData: FormData) {
    "use server";
    const active = await requireStaffSession();
    const id = String(formData.get("templateId") ?? "");
    const site = await importGlobalDiveSiteTemplate(await getDb(), active.user.shopId, id);
    if (!site) revalidateAndRedirect(back);
    revalidateAndRedirect(back, noticeUrl(`${back}/${site.id}`, "imported"));
  }

  // Reading a template before taking it. Importing was a one-tap commitment
  // against a name and one sentence — so a shop found out what it had adopted
  // by opening the site it now owned and deleting it again. The whole briefing
  // is public DiveDay content; there was never a reason to withhold it.
  const previewSlug = slug?.trim();
  const preview = previewSlug ? await getGlobalDiveSiteTemplate(await getDb(), previewSlug) : null;
  if (previewSlug && preview) {
    return (
      <TemplatePreview
        template={preview}
        backHref={catalogHref}
        importAction={importAction}
        t={t}
        diverT={diverT}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} scroll={false} className="text-sm font-medium text-primary hover:underline">
        {t("diveSites.backToLibrary")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
          title={t("diveSites.catalog.title")}
          description={t("diveSites.catalog.description")}
        />
      </div>
      {/* The same ledger grammar as the library this feeds (ADR
          20260827-the-shops-shelves): the catalog is not a second surface
          style. The row **is** the preview door — a template's whole briefing
          is public DiveDay content and reading it before taking it is the
          ordinary path — so the separate "Read it first" button retired with
          the card it sat in, and Import stays as the row's one act. */}
      <ul className="mt-8">
        {catalog.templates.map(({ template, version }) => (
          <LedgerRow
            key={template.id}
            href={`${catalogHref}&template=${encodeURIComponent(template.slug)}`}
            linkLabel={version.briefing.name}
            // On a phone "Import to my library" beside a name and a paragraph
            // leaves the paragraph a column two words wide; `stacked` gives the
            // act the first line and the briefing the full width beneath.
            stacked
            trailing={
              <form action={importAction}>
                <input type="hidden" name="templateId" value={template.id} />
                <SubmitButton
                  pendingLabel={t("diveSites.catalog.importing")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("diveSites.catalog.importToLibrary")}
                </SubmitButton>
              </form>
            }
          >
            <div className="min-w-0 py-3">
              <p className="font-medium">{version.briefing.name}</p>
              <p className="mt-0.5 text-sm text-muted">
                {[
                  version.briefing.locationName,
                  t("diveSites.catalog.templateVersion", { version: version.version }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {/* The one paragraph that earns a row of its own: a shop choosing
                  among thirty-four reefs it has never dived has nothing else to
                  choose on, which is the opposite of its own library. */}
              {version.briefing.description ? (
                <p className="mt-1 text-sm text-muted">{version.briefing.description}</p>
              ) : null}
            </div>
          </LedgerRow>
        ))}
      </ul>
      <Pager
        page={catalog.page}
        pageCount={catalog.pageCount}
        href={pageHref}
        total={t("diveSites.catalog.pagination.total", { count: catalog.total })}
        t={t}
        className="mt-6"
      />
    </main>
  );
}

/**
 * One catalog template, whole, before a shop decides to take it.
 *
 * Deliberately not the diver-facing briefing component: this is the *staff*
 * question "what would I be adopting, and what would I still have to write?",
 * so it shows the fields as fields — including the ones a diver never sees as
 * a list, like the cert gate and the field guide's species names.
 */
function TemplatePreview({
  template,
  backHref,
  importAction,
  t,
  diverT,
}: {
  template: GlobalDiveSiteTemplateRow;
  backHref: string;
  // i18n-exempt: type annotation, not copy.
  importAction: (formData: FormData) => void | Promise<void>;
  t: StaffTranslator;
  /** The field guide is diver copy; the preview shows it as a diver will read it. */
  diverT: DiverTranslator;
}) {
  const briefing = template.version.briefing;
  // Resolved for the reader, exactly as the imported site's own briefing will
  // render it -- the preview's whole job is showing what you are about to take.
  const templateDifficulty = diveSiteDifficultyLabel(
    briefing.difficultyLevel ?? parseDiveSiteDifficulty(briefing.difficulty),
    diverT,
  );
  const species = (briefing.creatureSlugs ?? [])
    .filter(isMarineLifeSlug)
    .map((slug) => marineLifeCard(slug, diverT));
  const facts: Array<{ label: string; value: string }> = [
    briefing.locationName
      ? { label: t("diveSites.catalog.preview_location"), value: briefing.locationName }
      : null,
    briefing.depthRange
      ? { label: t("diveSites.catalog.preview_depth"), value: briefing.depthRange }
      : null,
    // Resolved for the reader, like the field guide below it: an older
    // published version holds free text here, a newer one a code, and both
    // narrow to the same three readings.
    templateDifficulty
      ? { label: t("diveSites.catalog.preview_difficulty"), value: templateDifficulty }
      : null,
    briefing.currentNote
      ? { label: t("diveSites.catalog.preview_conditions"), value: briefing.currentNote }
      : null,
  ].filter((fact) => fact !== null);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link
        href={backHref}
        scroll={false}
        className="text-sm font-medium text-primary hover:underline"
      >
        {t("diveSites.catalog.backToCatalog")}
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow={t("diveSites.catalog.templateVersion", {
            version: template.version.version,
          })}
          title={briefing.name}
          description={briefing.description ?? ""}
          actions={
            <form action={importAction}>
              <input type="hidden" name="templateId" value={template.template.id} />
              <SubmitButton
                pendingLabel={t("diveSites.catalog.importing")}
                className={buttonClass()}
              >
                {t("diveSites.catalog.importToLibrary")}
              </SubmitButton>
            </form>
          }
        />
      </div>
      <p className="mt-2 text-sm text-muted">{t("diveSites.catalog.previewNote")}</p>

      {facts.length > 0 ? (
        <dl
          className={sectionCardClass({
            className: "mt-6 grid gap-4 sm:grid-cols-2",
          })}
        >
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className={groupLabelClass()}>{fact.label}</dt>
              <dd className="mt-1 text-sm font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {briefing.minimumCertificationLevel ||
      briefing.requiresNitrox ||
      (briefing.requiredSpecialties?.length ?? 0) > 0 ? (
        // Framed like the facts panel above it, and for a reason worth stating:
        // those are prose a shop can rewrite, these are the gates that decide
        // who may board. On the one screen answering "what am I adopting", the
        // gates may not read quieter than the description — which is what
        // happened the moment the facts list became a raised card.
        <section className={sectionCardClass({ className: "mt-6" })}>
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_requirements")}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {briefing.minimumCertificationLevel ? (
              <Badge tone="primary" size="sm">
                {t(CERTIFICATION_LEVEL_KEYS[briefing.minimumCertificationLevel])}
              </Badge>
            ) : null}
            {(briefing.requiredSpecialties ?? []).map((specialty) => (
              <Badge key={specialty} tone="neutral" size="sm">
                {t(SPECIALTY_KEYS[specialty])}
              </Badge>
            ))}
            {briefing.requiresNitrox ? (
              <Badge tone="warning" size="sm">
                {t("diveSites.list.nitroxBadge")}
              </Badge>
            ) : null}
          </div>
        </section>
      ) : null}

      {briefing.fitNote ? (
        <section className="mt-6 rounded-panel bg-primary-tint p-5">
          <h2 className="text-lg font-semibold text-primary">
            {t("diveSites.catalog.preview_fit")}
          </h2>
          <p className="mt-1 text-sm text-muted">{briefing.fitNote}</p>
        </section>
      ) : null}

      {briefing.divePlan ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_divePlan")}
          </h2>
          <p className="mt-2 leading-relaxed text-muted">{briefing.divePlan}</p>
        </section>
      ) : null}

      {briefing.marineLifeDescription ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_underwater")}
          </h2>
          <p className="mt-2 leading-relaxed text-muted">{briefing.marineLifeDescription}</p>
        </section>
      ) : null}

      {(briefing.landmarks?.length ?? 0) > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_landmarks")}
          </h2>
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-2 divide-y divide-border overflow-hidden",
            })}
          >
            {(briefing.landmarks ?? []).map((landmark) => (
              <li key={landmark.name} className="px-4 py-3">
                <p className="font-medium">{landmark.name}</p>
                {landmark.note ? (
                  <p className="mt-0.5 text-sm text-muted">{landmark.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {species.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-medium tracking-widest text-muted uppercase">
            {t("diveSites.catalog.preview_fieldGuide")}
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4">
            {species.map((entry) => (
              <li key={entry.slug}>
                <StoredPhoto
                  src={entry.imageUrl}
                  alt={entry.name}
                  className="aspect-[4/3] w-full rounded-lg bg-surface-sunken"
                  sizes="(min-width: 640px) 25vw, 50vw"
                />
                <p className="mt-1.5 text-sm font-medium leading-tight">{entry.name}</p>
                <p className="text-xs text-muted">{entry.kind}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
