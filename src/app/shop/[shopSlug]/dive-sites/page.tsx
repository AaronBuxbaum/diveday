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
import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { QueryForm } from "@/components/ui/QueryForm";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { getDb } from "@/db/client";
import {
  currentGlobalDiveSiteVersions,
  diveSiteLibrarySize,
  type GlobalDiveSiteTemplateRow,
  getGlobalDiveSiteTemplate,
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
  const [sitePage, librarySize] = await Promise.all([
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
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.diveSites)}
        title={t("diveSites.list.title")}
        description={t("diveSites.list.description")}
        // An empty library gets no header actions: the empty card below is
        // already the whole page, and it carries these same two doors. Two
        // identical primaries on one screen is what principle 8 forbids — so
        // the card owns them until there is a library to act on.
        actions={
          librarySize === 0 ? undefined : (
            <>
              <Link
                href={`/shop/${shopSlug}/dive-sites/new`}
                className={buttonClass({ className: "rounded-xl" })}
              >
                <span aria-hidden="true">+</span> {t("diveSites.list.createSite")}
              </Link>
              <Link
                href={catalogHref}
                scroll={false}
                className={buttonClass({ variant: "secondary", className: "rounded-xl" })}
              >
                {t("diveSites.list.browseTemplates")}
              </Link>
            </>
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
          // The card's chrome without its anatomy: `QueryForm` is a `<form>`,
          // which `SectionCard`'s closed element set deliberately excludes, and
          // the band has no heading of its own.
          className={sectionCardClass({ className: "mb-6" })}
        >
          <FieldGrid columns={2}>
            <Field label={t("diveSites.list.searchLabel")}>
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder={t("diveSites.list.searchPlaceholder")}
                maxLength={120}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              {/* Secondary: the page's one primary is the header's create
                action (principle 8). */}
              <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
                {t("diveSites.list.searchApply")}
              </button>
              {query ? (
                <Link
                  href={`/shop/${shopSlug}/dive-sites`}
                  scroll={false}
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  {t("diveSites.list.searchClear")}
                </Link>
              ) : null}
            </FieldActions>
          </FieldGrid>
        </QueryForm>
      ) : null}

      {sites.length === 0 ? (
        <EmptyState
          title={query ? t("diveSites.list.noMatchHeading") : t("diveSites.list.emptyHeading")}
          body={t("diveSites.list.emptyBody")}
          action={
            <>
              {query || librarySize > 0 ? null : (
                // The only place these two doors exist on an empty library: the
                // header drops its actions when the library is empty precisely so
                // this card owns them, and a shop reading "start with a site your
                // crew knows well" can start from that sentence.
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Link
                    href={`/shop/${shopSlug}/dive-sites/new`}
                    className={buttonClass({ className: "rounded-xl" })}
                  >
                    <span aria-hidden="true">+</span> {t("diveSites.list.createSite")}
                  </Link>
                  <Link
                    href={catalogHref}
                    scroll={false}
                    className={buttonClass({ variant: "secondary", className: "rounded-xl" })}
                  >
                    {t("diveSites.list.browseTemplates")}
                  </Link>
                </div>
              )}
            </>
          }
          className="mt-4"
        />
      ) : (
        // A table, not a grid of cards (issue #608). A library is a list of
        // like things a staffer scans down one column of — name, then where it
        // is, then what it demands — and a card grid made that scan a
        // zig-zag across three columns at two sizes. The site's own briefing
        // prose is the one thing the card carried that has no column: it is a
        // paragraph, and a wrapped paragraph cell sets every row a different
        // height. It lives one tap away, on the row's own page.
        //
        // No `SectionCard` around this: `<Table>` brings the same shell at the
        // same radius, and a card inside a card reads as a rendering bug.
        <Table shellClassName="mt-4">
          {/* The table's accessible name, which the `<ul>` carried as an
              `aria-label`. A caption is the element HTML has for it. */}
          <caption className="sr-only">{t("diveSites.list.gridAriaLabel")}</caption>
          <THead>
            <Th>{t("diveSites.list.table.site")}</Th>
            {/* Location and the template line fold under the site's name on a
                phone, leaving the name beside the gates — the two a staffer is
                answering "can this diver go here?" with — rather than four
                columns to scroll sideways through. */}
            <Th hideBelow="sm">{t("diveSites.list.table.location")}</Th>
            <Th>{t("diveSites.list.table.requirements")}</Th>
            <Th hideBelow="sm">{t("diveSites.list.table.template")}</Th>
          </THead>
          <TBody>
            {sites.map((site) => {
              const location = site.locationName || t("diveSites.list.locationToAdd");
              const published = currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? 0;
              const adopted = site.sourceTemplateVersion;
              const updateReady = adopted !== null && published > adopted;
              const template = !adopted
                ? null
                : updateReady
                  ? t("diveSites.list.templateUpdateReady", { version: published })
                  : t("diveSites.list.diveDayTemplateVersion", { version: adopted });
              // An update waiting is the one thing in this column a staffer can
              // act on, so it is the one thing that carries ink; the version a
              // site was adopted at is provenance, and stays quiet.
              const templateTone = updateReady ? "font-medium text-primary" : "text-muted";
              return (
                <tr key={site.id}>
                  <Td align="middle">
                    <Link
                      href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {site.name}
                    </Link>
                    <div className="text-xs text-muted sm:hidden">{location}</div>
                    {template ? (
                      <div className={`mt-1 text-xs sm:hidden ${templateTone}`}>{template}</div>
                    ) : null}
                  </Td>
                  <Td muted hideBelow="sm" align="middle">
                    {location}
                  </Td>
                  <Td align="middle">
                    <div className="flex flex-wrap gap-2">
                      {site.minimumCertificationLevel ? (
                        <Badge tone="primary" size="sm">
                          {t(CERTIFICATION_LEVEL_KEYS[site.minimumCertificationLevel])}
                        </Badge>
                      ) : null}
                      {site.requiresNitrox ? (
                        <Badge tone="warning" size="sm">
                          {t("diveSites.list.nitroxBadge")}
                        </Badge>
                      ) : null}
                      {site.requiredSpecialties.length > 0 ? (
                        <Badge tone="neutral" size="sm">
                          {site.requiredSpecialties.length === 1
                            ? t("diveSites.list.oneRequiredSpecialty")
                            : t("diveSites.list.manyRequiredSpecialties", {
                                count: site.requiredSpecialties.length,
                              })}
                        </Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td hideBelow="sm" align="middle" className={`text-xs ${templateTone}`}>
                    {template}
                  </Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
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
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
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
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {catalog.templates.map(({ template, version }) => (
          // No `title`: the version line is an eyebrow *above* the name, and
          // `SectionCard`'s header puts the heading first — so the card is
          // taken as a shell and the catalog entry keeps its own reading order.
          <SectionCard as="li" key={template.id}>
            <p className="text-sm font-medium text-primary">
              {t("diveSites.catalog.templateVersion", { version: version.version })}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{version.briefing.name}</h2>
            {version.briefing.locationName ? (
              <p className="mt-0.5 text-sm text-muted">{version.briefing.locationName}</p>
            ) : null}
            <p className="mt-2 text-sm text-muted">{version.briefing.description}</p>
            {/* Two doors, and neither is this page's primary — a grid of
                twenty-four identical filled buttons is exactly what principle 8
                forbids, and the act itself belongs on the page that shows what
                is being taken. The card carrying only "Import to my library"
                made adopting a template the one way to find out what was in it;
                reading it first is the door that leads now. */}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href={`${catalogHref}&template=${encodeURIComponent(template.slug)}`}
                scroll={false}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("diveSites.catalog.preview")}
              </Link>
              <form action={importAction}>
                <input type="hidden" name="templateId" value={template.id} />
                <SubmitButton
                  pendingLabel={t("diveSites.catalog.importing")}
                  className={buttonClass({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  {t("diveSites.catalog.importToLibrary")}
                </SubmitButton>
              </form>
            </div>
          </SectionCard>
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
                className={buttonClass({ className: "rounded-xl" })}
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
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                {fact.label}
              </dt>
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
        <section className="mt-6 rounded-2xl bg-primary/10 p-5">
          <h2 className="font-semibold text-primary">{t("diveSites.catalog.preview_fit")}</h2>
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
