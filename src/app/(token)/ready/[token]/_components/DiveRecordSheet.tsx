import { BrandStyle } from "@/components/BrandStyle";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import type { AfterStateProps } from "@/features/recap-after-state";
import { DIVEDAY_BRAND_COLOR, deriveBrandTheme } from "@/lib/brand";
import { publicAppUrl } from "@/lib/notifications";
import { PACKET_PAPER, printSheetPageRule, storefrontAddress } from "@/lib/print-sheets";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";
import { RecordFacts } from "./DiveRecordFacts";

/** The paper a logbook entry is printed on: whatever the diver's printer holds. */
export const DIVE_RECORD_PAPER = PACKET_PAPER;

/**
 * **The dive record on paper** (issue #2745): a logbook page in the shop's
 * colour, the one thing the diver's after-state prints.
 *
 * The same facts the card shows (`RecordFacts`, its sheet face), then what a
 * paper logbook page has and a screen does not: four ruled lines to write the
 * dive up on, and a rule for whoever signs it off. Nothing here taps, because
 * nothing that taps is rendered: no postcard drawing, no Save, no downloads,
 * and no sighting (see `RecordFacts`). The rules for what a line may claim are
 * `DiveRecord`'s, and they hold here because the lines are the same.
 *
 * **What ties the page to the shop's record** (reviews of #2745): the fold
 * carries the dive's day, then the booking's short reference and the instant
 * this page read the record, in the shop's zone with the zone named. A tab
 * printed after the shop corrected the record shows its old "as of", and the
 * divemaster signing it can see that. The signature line is the instructor's
 * on a course day (training and certification are signed by an instructor) and
 * the divemaster's otherwise, and it is not drawn at all unless the shop has
 * evidence the diver was aboard or at the desk (`sheet.signable`): a page for
 * a diver who never came reads "Not yet confirmed" where a name would go.
 */
export function DiveRecordSheet({
  t,
  shop,
  trip,
  when,
  sheet,
  diverName,
  sites,
  diveRecord,
  observedSpecies,
  course,
}: Pick<
  AfterStateProps,
  | "t"
  | "shop"
  | "when"
  | "sheet"
  | "diverName"
  | "sites"
  | "diveRecord"
  | "observedSpecies"
  | "course"
> & { trip: AfterStateProps["trip"] }) {
  const theme = deriveBrandTheme(shop.brandColor ?? DIVEDAY_BRAND_COLOR);
  return (
    <>
      {/* A fixed rule built from the sheet's own paper, never a request value. */}
      <style data-print-sheet="">{printSheetPageRule(DIVE_RECORD_PAPER)}</style>
      <BrandStyle brandColor={null} brandDisplayFont={shop.brandDisplayFont} />
      <PaperSheet
        paper={DIVE_RECORD_PAPER}
        tone={{ band: theme.primary, bandInk: theme.primaryForeground }}
        band={
          <>
            <SheetMark name={shop.name} size="sm" />
            <span className="font-brand-display text-sm font-bold">{shop.name}</span>
            <h1 className="ms-auto text-sm font-semibold">{t("recap.logbookHeading")}</h1>
          </>
        }
        foldLeft={`${trip.title} · ${when} · ${t("recap.printReference", { reference: sheet.reference })} · ${t("recap.printAsOf", { when: sheet.asOf })}`}
        foldRight={storefrontAddress(shop.slug, publicAppUrl())}
      >
        <RecordFacts
          t={t}
          shop={shop}
          trip={trip}
          when={when}
          diverName={diverName}
          sites={sites}
          diveRecord={diveRecord}
          observedSpecies={observedSpecies}
          course={course}
          paper
        />
        <div data-testid={AFTER_STATE_TEST_IDS.printNotes} className="mt-6">
          <p className="text-xs font-medium text-muted">{t("recap.printNotes")}</p>
          <div className="mt-2 flex flex-col gap-5" aria-hidden="true">
            {[0, 1, 2, 3].map((line) => (
              <span key={line} className="block border-b border-border" />
            ))}
          </div>
        </div>
        {sheet.signable ? (
          <div data-testid={AFTER_STATE_TEST_IDS.printSignature} className="mt-8">
            <span aria-hidden="true" className="block border-b border-border" />
            <p className="mt-2 text-xs font-medium text-muted">
              {t(course ? "recap.printSignatureInstructor" : "recap.printSignature")}
            </p>
          </div>
        ) : (
          <p
            data-testid={AFTER_STATE_TEST_IDS.printUnconfirmed}
            className="mt-8 text-sm font-medium"
          >
            {t("recap.printNotConfirmed", { shopName: shop.name })}
          </p>
        )}
        <p className="mt-6 text-xs text-muted">{t("recap.recordedBy", { shopName: shop.name })}</p>
      </PaperSheet>
    </>
  );
}
