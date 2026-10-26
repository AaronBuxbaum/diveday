import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { proseLinkClass } from "@/components/ui/button";
import { cardSummaryClass, SectionCard } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { canPersonImportShopData } from "@/db/import";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { IMPORT_HONESTY_TABLE, type ImportScopeRowId } from "@/lib/import";
import { getMigrationGuide } from "@/lib/migration-guides";
import { requireShopSurface } from "@/lib/session";
import { DataTabs } from "../_components/DataTabs";
import { settingsPaneClass } from "../_components/settings-pane";
import { DiveSiteImportPanel } from "./DiveSiteImportPanel";
import { GearImportPanel } from "./GearImportPanel";
import { ImportKindTabs } from "./ImportKindTabs";
import { ImportWizard, type ImportWizardAssist } from "./ImportWizard";
import { importAssists } from "./import-assists";
import { importWizardCopy } from "./import-wizard-copy";
import { WebsiteSetupTab } from "./WebsiteSetupTab";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Import — DiveDay" };

/**
 * **One Import page, a tab per kind of file** (Aaron, 2026-10-03). Divers,
 * gear history and dive sites were three Settings pages and three rows on the
 * hub and the rail, each a file picker and a submit. `?what=` picks the tab;
 * anything else is the Divers tab, the one a switching shop arrives for.
 */
const IMPORT_TABS = ["divers", "gear", "dive-sites", "website"] as const;
type ImportTab = (typeof IMPORT_TABS)[number];

function importTab(what: string | undefined): ImportTab {
  return IMPORT_TABS.find((tab) => tab === what) ?? "divers";
}

/**
 * This surface's words for {@link IMPORT_HONESTY_TABLE}'s rows — the staff
 * bundle's map, mirroring the diver-bundle `IMPORT_SCOPE_ROW_KEYS` the
 * /switching pages use (one bundle per surface; the table's rows and buckets
 * stay the single source in src/lib/import.ts).
 */
const SCOPE_ROW_KEYS: Record<ImportScopeRowId, { what: StaffMessageKey; detail: StaffMessageKey }> =
  {
    contact: {
      what: "settings.import.scopeTable.contact.what",
      detail: "settings.import.scopeTable.contact.detail",
    },
    emergencyContact: {
      what: "settings.import.scopeTable.emergencyContact.what",
      detail: "settings.import.scopeTable.emergencyContact.detail",
    },
    diveInsurance: {
      what: "settings.import.scopeTable.diveInsurance.what",
      detail: "settings.import.scopeTable.diveInsurance.detail",
    },
    rentalSizes: {
      what: "settings.import.scopeTable.rentalSizes.what",
      detail: "settings.import.scopeTable.rentalSizes.detail",
    },
    certificationCard: {
      what: "settings.import.scopeTable.certificationCard.what",
      detail: "settings.import.scopeTable.certificationCard.detail",
    },
    specialtyCards: {
      what: "settings.import.scopeTable.specialtyCards.what",
      detail: "settings.import.scopeTable.specialtyCards.detail",
    },
    nitrox: {
      what: "settings.import.scopeTable.nitrox.what",
      detail: "settings.import.scopeTable.nitrox.detail",
    },
    signedWaivers: {
      what: "settings.import.scopeTable.signedWaivers.what",
      detail: "settings.import.scopeTable.signedWaivers.detail",
    },
    waiverDocuments: {
      what: "settings.import.scopeTable.waiverDocuments.what",
      detail: "settings.import.scopeTable.waiverDocuments.detail",
    },
    role: {
      what: "settings.import.scopeTable.role.what",
      detail: "settings.import.scopeTable.role.detail",
    },
    cardOnFile: {
      what: "settings.import.scopeTable.cardOnFile.what",
      detail: "settings.import.scopeTable.cardOnFile.detail",
    },
    pastVisits: {
      what: "settings.import.scopeTable.pastVisits.what",
      detail: "settings.import.scopeTable.pastVisits.detail",
    },
    paymentHistory: {
      what: "settings.import.scopeTable.paymentHistory.what",
      detail: "settings.import.scopeTable.paymentHistory.detail",
    },
    serviceHistory: {
      what: "settings.import.scopeTable.serviceHistory.what",
      detail: "settings.import.scopeTable.serviceHistory.detail",
    },
    diverNotes: {
      what: "settings.import.scopeTable.diverNotes.what",
      detail: "settings.import.scopeTable.diverNotes.detail",
    },
  };

/**
 * **Only the exception wears a chip.** The card is headed "What comes across"
 * and fourteen of its fifteen rows do, so a green "Comes across" pill on each
 * was the group's own fact reprinted fifteen times — the surface saying once
 * what it then repeats (principle 9). The one row that does *not* come across
 * is the fact a shop is reading this table for, and it is the only row marked.
 *
 * Built inside the request, not at module scope, so the chip text tracks the
 * negotiated locale rather than freezing to whichever locale first imported
 * this file.
 */
function staysBehindChip(t: StaffTranslator): { label: string; className: string } {
  return {
    label: t("settings.import.scopeChip.staysBehind"),
    // `bg-surface`, not the `bg-surface-sunken` the /switching guides use for
    // this same chip: the rows here are themselves sunken, so a sunken chip
    // was drawn in the exact colour of the row behind it and read as bare grey
    // text.
    className: "bg-surface text-muted",
  };
}

/**
 * The intake side of the portability wedge (ADR 20260723-contact-importer):
 * bring a shop's people, cards, and sizes in from a CSV — and say plainly, up
 * front, what does and doesn't come across. Gated to owner/manager like the
 * export, and re-checked against the database in the commit action.
 */
export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ what?: string; notice?: string; from?: string }>;
}) {
  const { shopSlug } = await params;
  const { what, notice, from } = await searchParams;
  // Settings, not Today — Import is a Settings sub-page, and its parent is
  // where the refusal is legible. Same pattern as promos/WhatsApp/team.
  const { shop, db, session } = await requireShopSurface(shopSlug, {
    allow: canPersonImportShopData,
    refusal: { notice: "import-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const staysBehind = staysBehindChip(t);
  const base = `/shop/${shopSlug}/settings/import`;
  const assists = await importAssists(db, shop.id, session.user.personId, t);
  const tab = assists.tab(importTab(what));

  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.data.title")}
      />

      <DataTabs t={t} shopSlug={shopSlug} current="import" />

      <ImportKindTabs t={t} base={base} current={tab} website={assists.website} />

      {tab === "gear" ? (
        <div className="space-y-6">
          <GearImportPanel t={t} notice={notice} />
        </div>
      ) : tab === "website" ? (
        <WebsiteSetupTab db={db} shop={shop} t={t} locale={locale} notice={notice} />
      ) : tab === "dive-sites" ? (
        <div className="space-y-6">
          <DiveSiteImportPanel t={t} notice={notice} />
        </div>
      ) : (
        diversTab({
          t,
          shopSlug,
          locale,
          staysBehind,
          timeZone: shop.timezone ?? "UTC",
          assist: assists.wizard,
          // A switching guide's import button says which system the shop is
          // leaving. Only a registered guide's name is ever shown.
          sourceSystem:
            (from ? getMigrationGuide(from)?.competitor : undefined) ??
            t("settings.import.wizard.oldSystem"),
        })
      )}
    </main>
  );
}

/** A link to one of the /switching guides, opened beside the import. */
function switchingGuide(guide: string) {
  return (chunks: ReactNode) => (
    <a href={`/switching/${guide}`} target="_blank" rel="noreferrer" className={proseLinkClass}>
      {chunks}
    </a>
  );
}

/**
 * The Divers tab: import first, then the complete source/provenance reference. Called, not rendered as
 * a component, so the page's tree carries its rows directly (`page.test.tsx`
 * walks it).
 */
function diversTab({
  t,
  shopSlug,
  locale,
  staysBehind,
  timeZone,
  sourceSystem,
  assist,
}: {
  t: StaffTranslator;
  shopSlug: string;
  locale: string;
  staysBehind: { label: string; className: string };
  timeZone: string;
  sourceSystem: string;
  assist?: ImportWizardAssist;
}) {
  return (
    <>
      {/* Three links inside one sentence. The space between them is the words
          between them (", " and ", or "), so the pixel probe's uneven-gaps
          check, which measures 7.8 then 24.9px, is reading prose rather than
          layout (settled in docs/design/settled-questions.md). */}
      <p className="mb-6 text-sm text-muted">
        {t.rich("settings.import.comingFrom", {
          eve: switchingGuide("eve"),
          diveshop360: switchingGuide("diveshop360"),
          spreadsheet: switchingGuide("spreadsheet"),
        })}
      </p>

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        <p className="text-sm text-muted">{t("settings.import.importantExclusions")}</p>
        <ImportWizard
          diversHref={`/shop/${shopSlug}/divers`}
          intro={t.rich("settings.import.wizard.intro", {
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
          copy={importWizardCopy(t, sourceSystem)}
          locale={locale}
          timeZone={timeZone}
          assist={assist}
        />
        <SectionCard as="details" padding="none" className="group/reference">
          <summary
            className={cardSummaryClass({ className: "min-h-11 justify-between p-5 sm:p-6" })}
          >
            {t("settings.import.comesAcross.heading")}
            <SummaryCaret className="size-4 text-muted group-open/reference:rotate-90" />
          </summary>
          <div className="border-t border-border p-5 sm:p-6">
            <ul className="space-y-2">
              {IMPORT_HONESTY_TABLE.map((row) => (
                <li
                  key={row.id}
                  className="grid gap-1 rounded-inset bg-surface-sunken px-4 py-3 sm:grid-cols-[10rem_7rem_1fr] sm:items-baseline sm:gap-3"
                >
                  <span className="font-medium text-foreground">
                    {t(SCOPE_ROW_KEYS[row.id].what)}
                  </span>
                  {/* The chip's cell renders only on a row that has the chip,
                    and the detail names its own column from `sm` up, so it
                    keeps its start edge down the whole list either way. The
                    cell used to stay even when empty, to hold that edge, and on
                    a phone, where the row is one column, the empty cell took a
                    4px gap of its own (the pixel probe: 8px between a row's
                    name and its detail where the chip rows sit 4px apart). */}
                  {row.scope === "stays-behind" ? (
                    <span>
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${staysBehind.className}`}
                      >
                        {staysBehind.label}
                      </span>
                    </span>
                  ) : null}
                  <span className="text-sm text-muted sm:col-start-3">
                    {t(SCOPE_ROW_KEYS[row.id].detail)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
