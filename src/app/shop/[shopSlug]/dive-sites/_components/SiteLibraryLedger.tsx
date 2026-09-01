import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { SiteLibraryGroup } from "@/db/dive-sites";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { SiteLibraryGroupLabel } from "@/lib/dive-site-difficulty";
import { siteFitCutsAgainstGroup, siteLibraryRequirement } from "@/lib/dive-sites";
import { type SiteFitTone, siteFit } from "@/lib/diver-planning";

/**
 * **The dive-site library as one ledger** — ADR 20260827-the-shops-shelves,
 * the library pattern: "a search/filter toolbar, grouped rows (by the
 * collection's own shared fact), exceptional badges only, the row as the door",
 * with the DiveDay catalog as a quiet door at the tail rather than a second
 * surface style.
 *
 * What this replaced was a three-column table beside a card grid one query
 * param away — two renderings of one noun. It is now the same rows the day
 * spine and the week ledger are built from (`src/components/ui/ledger.tsx`),
 * grouped by how demanding the site is, easiest first, unrated last.
 *
 * Four rules hold here, and `SiteLibraryLedger.test.tsx` pins each one:
 *
 * - **A shared fact belongs to the group header.** The difficulty word is the
 *   heading, never a column; the fit reading appears on a row only where it
 *   cuts against the group it is filed under (`siteFitCutsAgainstGroup`).
 * - **Requirement words only above Open Water.** The level word is silent at
 *   the floor every recreational diver already holds; specialty and nitrox
 *   words speak at any level, and warning ink is reserved for the rows whose
 *   level is also above Open Water (`siteLibraryRequirement`).
 * - **One badge, and only for the exceptional state.** A waiting template
 *   update is a thing a staffer can act on and wears the app's one pill; the
 *   version a site was *adopted* at is provenance and has gone back to the site
 *   page, taking the `◆`/`◇` glyph pair with it.
 * - **Grouping composes with the Pager.** The rows arrive sorted group-major
 *   from `listDiveSitesPage`, so a heading re-rendered on page 2 continues its
 *   group rather than opening a second one, and the count the Pager states
 *   keeps the row query's exact scope (ADR 20260803-one-pagination-model).
 *
 * A Server Component: staff copy never crosses to the client
 * (`src/i18n/staff-messages.ts`). The diver translator rides along for the
 * three difficulty words, which are diver copy the staffer reads in their own
 * language — the same pairing the catalog preview already makes.
 */
export function SiteLibraryLedger({
  groups,
  shopSlug,
  t,
  diverT,
  currentTemplateVersion,
  catalog,
}: {
  groups: readonly SiteLibraryGroup[];
  shopSlug: string;
  t: StaffTranslator;
  /** The three difficulty words are diver copy; the staffer reads them in their own language. */
  diverT: DiverTranslator;
  /** Published version per source template id, for the one badge a row may wear. */
  currentTemplateVersion: ReadonlyMap<string, number>;
  /** The tail door, or null when DiveDay publishes nothing to browse. */
  catalog: { href: string; count: number } | null;
}) {
  // A ledger with no rows is not a ledger, and the door is its *tail*: with an
  // empty library the page's own two-door empty state owns the write-one-or-
  // import-one choice, and a second catalog door underneath it would be the
  // third identical destination on one screen.
  if (groups.length === 0) return null;
  return (
    <div className="mt-8">
      <div className="space-y-8">
        {groups.map((group) => {
          const headingId = `site-group-${group.label}`;
          return (
            <LedgerGroup
              key={group.label}
              as="h2"
              id={headingId}
              label={groupWord(group.label, t, diverT)}
            >
              <ul className="mt-2" aria-labelledby={headingId}>
                {group.sites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    group={group.label}
                    shopSlug={shopSlug}
                    t={t}
                    currentTemplateVersion={currentTemplateVersion}
                  />
                ))}
              </ul>
            </LedgerGroup>
          );
        })}
      </div>
      {catalog ? <CatalogDoor href={catalog.href} count={catalog.count} t={t} /> : null}
    </div>
  );
}

/** The heading word for a group: DiveDay's three difficulty words, or "Unrated". */
function groupWord(
  label: SiteLibraryGroupLabel,
  t: StaffTranslator,
  diverT: DiverTranslator,
): string {
  return label === "unrated"
    ? t("diveSites.list.groups.unrated")
    : diveSiteDifficultyLabel(label, diverT);
}

/** The words the three fit readings go by, in the staffer's language. */
const FIT_TONE_KEYS = {
  welcoming: "diveSites.form.fitToneWelcoming",
  demanding: "diveSites.form.fitToneDemanding",
  unknown: "diveSites.form.fitToneAskCrew",
} as const satisfies Record<SiteFitTone, StaffMessageKey>;

function SiteRow({
  site,
  group,
  shopSlug,
  t,
  currentTemplateVersion,
}: {
  site: SiteLibraryGroup["sites"][number];
  group: SiteLibraryGroupLabel;
  shopSlug: string;
  t: StaffTranslator;
  currentTemplateVersion: ReadonlyMap<string, number>;
}) {
  const fit = siteFit({
    difficultyLevel: site.difficultyLevel,
    depthRange: site.depthRange,
    currentNote: site.currentNote,
    fitTone: site.fitTone,
  }).tone;
  // Location · the fit reading where it disagrees with the group · depth. The
  // depth is the shop's own prose ("6–12 m", "shallow ledge to 18") and renders
  // exactly as typed: it carries a shape a single number cannot, and it is
  // already the fragment the diver-facing card shows.
  const meta = [
    site.locationName || t("diveSites.list.locationToAdd"),
    siteFitCutsAgainstGroup(group, fit) ? t(FIT_TONE_KEYS[fit]) : null,
    site.depthRange?.trim() || null,
  ].filter((fragment): fragment is string => Boolean(fragment));

  const requirement = siteLibraryRequirement(site);
  const requirementWords = [
    requirement.level ? t(CERTIFICATION_LEVEL_KEYS[requirement.level]) : null,
    ...requirement.specialties.map((specialty) => t(SPECIALTY_KEYS[specialty])),
    requirement.nitrox ? t("diveSites.list.nitroxBadge") : null,
  ].filter((word): word is string => Boolean(word));

  const published = currentTemplateVersion.get(site.sourceTemplateId ?? "") ?? 0;
  const adopted = site.sourceTemplateVersion;
  const updateReady = adopted !== null && published > adopted;

  return (
    <LedgerRow
      href={`/shop/${shopSlug}/dive-sites/${site.id}`}
      // The site's own name, and nothing appended: the roster, the visual
      // captures and the depth spec all address a site by exactly this, and a
      // stretched link's accessible name is the only name it has.
      linkLabel={site.name}
      // At 390px a name, a location, a depth and "Advanced Open Water · Deep ·
      // Nitrox" on one line leave the name about 90px to wrap in. `stacked` is
      // the primitive's own answer (ADR 20260827-clearwater-surface-language):
      // the name and its meta lead, the requirement words drop to a line of
      // their own beneath, and from `sm` up the row is byte-for-byte the row
      // the artboard draws.
      stacked
      trailing={
        // Nothing in here is interactive, and `LedgerRow` lifts its trailing
        // slot above the row-wide link overlay — so without this a tap landing
        // on the requirement words or the badge would do nothing at all. The
        // door's chevron is the row's own.
        <div className="pointer-events-none flex items-center gap-3">
          {updateReady ? (
            <Badge tone="primary" size="sm">
              {t("diveSites.list.templateUpdateReady", { version: published })}
            </Badge>
          ) : null}
          {requirementWords.length > 0 ? (
            <span
              className={
                requirement.emphasised
                  ? "text-end text-sm font-medium text-warning-strong"
                  : "text-end text-sm text-muted"
              }
            >
              {requirementWords.join(" · ")}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="min-w-0 py-2">
        <p className="font-medium break-words">{site.name}</p>
        <p className="mt-0.5 text-sm break-words text-muted">{meta.join(" · ")}</p>
      </div>
    </LedgerRow>
  );
}

/**
 * **The catalog, as a door rather than a destination.** DiveDay's published
 * site catalog was a second surface style — a two-column card grid behind a
 * header button — for a thing a shop opens once or twice a year. It is now the
 * last row of the library it feeds, in the same grammar as the rows above it,
 * and the header's secondary action has gone with it.
 *
 * The count is the whole catalog's, never a fetched page's total, and it never
 * claims to be near anybody: the catalog's *ordering* leans on the shop's
 * coordinates, its size does not, so the door renders the same line for a shop
 * that has not set an address yet.
 */
function CatalogDoor({ href, count, t }: { href: string; count: number; t: StaffTranslator }) {
  const title = t("diveSites.list.browseTemplates");
  return (
    <div className="mt-10">
      <LedgerRow
        as="div"
        href={href}
        linkLabel={title}
        leading={<DiveDayIcon name="diveSites" className="size-5 text-muted" />}
      >
        <div className="min-w-0 py-2">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-muted tabular-nums">
            {t("diveSites.list.catalogSiteCount", { count })}
          </p>
        </div>
      </LedgerRow>
    </div>
  );
}
