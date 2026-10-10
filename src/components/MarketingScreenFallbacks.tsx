import { RollCallMark } from "@/components/RollCallMark";
import { ROLL_CALL_ROW_TONE, rollCallRuleClass } from "@/components/row-tones";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { groupLabelClass, LedgerRow } from "@/components/ui/ledger";
import { ReadinessBar } from "@/components/ui/ProgressBar";
import { StatusMark } from "@/components/ui/StatusMark";
import { FIGURE_INLINE_CLASS, ITEM_TITLE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/**
 * Each fallback takes `locale` as a plain prop rather than reading
 * `requestLocale()` itself: these render inside the marketing pages'
 * `"use cache"` bodies (`src/app/page.tsx`, `src/app/product/page.tsx`), and
 * cached scopes cannot call `headers()`-backed functions themselves — see
 * AGENTS.md's `cacheComponents` notes.
 */

/**
 * **One edge for a mock's bar and body.** The app bar's shop name and the
 * body's first line start on one inset. The bar was `px-4` over bodies at
 * `p-5`, so the two missed each other by 4px on the seven card mocks (K-51),
 * which are all 20px now.
 *
 * The roll call is a phone screen and keeps a phone's 16px, bar and body, as
 * it always had. At 20px its bar no longer held "BLUE MANTIS DIVERS" and
 * "Offline copy · up to date" on one line in the landing hero's phone at 390
 * (135 + 136 in 272), and es-ES's "EMBARCADOS" (69.3px) outgrew its stat
 * tile's 67.3px label box.
 */
export const MOCK_INSET_X = "px-5";
export const MOCK_BODY = `${MOCK_INSET_X} py-5`;
export const PHONE_INSET_X = "px-4";
export const PHONE_BODY = `${PHONE_INSET_X} py-4`;

/**
 * The one primary button the mocks draw ("Mark boarded", "Download", "Leave my
 * review"), at the `sm` rung's 44px. The recap's was `min-h-10`, a 40px step
 * off the button ladder, in an otherwise identical string (K-516).
 */
export const MOCK_PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground";

/**
 * The shop name and the screen's label are each one unit. In /about's 290px
 * phone screen the pair does not fit on one line, and both used to wrap inside
 * themselves ("BLUE MANTIS / DIVERS" beside "Offline copy · up to / date",
 * K-398). Now the label moves under the name whole. Not `truncate`: the
 * ellipsis would land on "up to date", the half of the label that means
 * something. `gap-x-1.5` is only the floor between the two on one line,
 * where `justify-between` spreads them: the landing hero's phone holds the
 * pair with 9px to spare, and a 12px floor broke it onto two lines.
 */
/** The mocks' secondary button, the primary's twin in the bordered material. */
export const MOCK_SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface text-xs font-semibold text-foreground";

export function AppBar({ label, inset = MOCK_INSET_X }: { label: string; inset?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 border-b border-border bg-surface ${inset} py-3 text-xs text-muted`}
    >
      {/* i18n-exempt: sample shop name used only in marketing mockups */}
      <span className="font-semibold tracking-wide whitespace-nowrap text-primary uppercase">
        Blue Mantis Divers
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

/**
 * One line of a mock checklist (the ready brief's, the trip prep's): a label
 * and its done badge. The label wraps without leaving one word alone ("Crew
 * assigned (Mateo & / Sarah)" at 390 on /product, K-578) and gives way to the
 * badge, which keeps its size 8px clear of it: at 12px the gap took the 3px
 * "Tanks analyzed & loaded" needed at 390, and a row that had fitted wrapped
 * to start its second line with "&" (K-578 review).
 */
export function ChecklistRow({
  label,
  status,
  tone,
  mark = true,
}: {
  label: string;
  status: string;
  tone: string;
  /** The done-check, only on a step that is done. */
  mark?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5">
      <span className="min-w-0 text-sm font-semibold text-pretty">{label}</span>
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}
      >
        {mark ? <DiveDayIcon name="check" className="size-3" strokeWidth={2.2} /> : null} {status}
      </span>
    </div>
  );
}

/**
 * **The captain's roll call, drawn small** — the live Boat tab
 * (`trips/[id]/manifest/`), light by day, as the crew uses it at the rail (UX
 * audit #6: the selling screen is the shipped one). It carries what that page
 * carries at a glance: the head count's round figure ("4 of 9 divers aboard"),
 * the checkpoint switcher (Dock, Dive 1, Dive 2), the checkpoint's heading, and
 * a row per diver with its seat number, the name, the door into their sheet,
 * and the 56px circle the crew taps.
 *
 * **Drawn from the real parts.** The circle is `RollCallMark` and the row's
 * left rule and fill are `ROLL_CALL_ROW_TONE`, the same two pieces the live
 * rows and the offline copy wear, so a retune of the roll call reaches this
 * mock without anyone remembering it. The words are DiveDay's sample, not the
 * staff bundle's: the page's own copy can move without a marketing claim
 * moving under it.
 *
 * **Two checkpoints of one roll call.** `departure` is the dock, where the
 * hero's phone and the boat manifest page show it: four of nine aboard, Priya
 * tapped, Tom still to call. `afterDive` is the same list after the first dive
 * (the homepage's roll-call step, which would otherwise repeat the hero): the
 * switcher on Dive 1, eight of nine back aboard, Priya counted and Tom the one
 * still open.
 */
export function CaptainRollCallFallback({
  locale,
  checkpoint = "departure",
}: {
  locale: DiverLocale;
  checkpoint?: "departure" | "afterDive";
}) {
  const t = diverTranslator(locale);
  const afterDive = checkpoint === "afterDive";
  // i18n-exempt: sample diver names used only in marketing mockups
  const divers = ["Priya Sharma", "Tom Okafor"];
  const aboard = afterDive ? 8 : 4;
  return (
    <div className="bg-background text-foreground">
      <AppBar label={t("fallback.boatLabel")} inset={PHONE_INSET_X} />
      <div className={`space-y-4 ${PHONE_BODY}`}>
        <div>
          <h3 className={ITEM_TITLE_CLASS}>{t("fallback.tripName")}</h3>
          <p className="text-xs text-muted">{t("fallback.tripTime")}</p>
        </div>
        {/* The head count: the figure in its round glass, the water at its
            level, and the rest of the sentence beside it. */}
        <div className="flex items-center gap-3">
          <div className="relative size-14 shrink-0 overflow-hidden rounded-full border border-border bg-surface-sunken">
            <div
              aria-hidden="true"
              className="absolute inset-0 origin-bottom bg-shallows"
              style={{ transform: `scaleY(${aboard / 9})` }}
            />
            <span
              className={`absolute inset-0 flex items-center justify-center ${FIGURE_INLINE_CLASS}`}
            >
              {aboard}
            </span>
          </div>
          <p className="text-sm font-semibold tabular-nums">
            {t("fallback.ofTotalAboard", { total: 9 })}
          </p>
        </div>
        {/* The checkpoint switcher: one segmented track, the current
            checkpoint raised on it. */}
        <div className="inline-flex rounded-lg border border-border bg-surface-sunken p-0.5">
          {[
            [t("fallback.checkpointDock"), !afterDive],
            [t("fallback.checkpointDive", { n: 1 }), afterDive],
            [t("fallback.checkpointDive", { n: 2 }), false],
          ].map(([label, current]) => (
            <span
              key={String(label)}
              className={`inline-flex min-h-8 items-center justify-center rounded-md px-3 text-xs font-semibold whitespace-nowrap ${
                current ? "bg-surface text-foreground shadow-sm" : "text-muted"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <div>
          <h3 className="text-sm font-semibold">
            {afterDive ? t("fallback.afterDiveRollCallHeading") : t("fallback.rollCallHeading")}
          </h3>
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            {divers.map((name, index) => {
              // Priya has been tapped aboard at either checkpoint; Tom is the
              // one the crew is still to call.
              const isAboard = index === 0;
              return (
                <div
                  key={name}
                  className={`marketing-roll-call-row border-l-4 ${
                    isAboard ? ROLL_CALL_ROW_TONE.boarded : ROLL_CALL_ROW_TONE.awaiting
                  }`}
                >
                  {/* The rule between rows on the inner wrapper, as the live
                      rows draw it: the tone owns the row's border colour. */}
                  <div
                    className={`flex items-center gap-2.5 py-2 ps-2.5 pe-2 ${rollCallRuleClass({
                      firstOnScreen: index === 0,
                      firstOnPaper: index === 0,
                    })}`}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface text-xs font-semibold tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="min-w-0 flex-1 text-sm font-semibold">{name}</p>
                    <DiveDayIcon name="chevron-right" className="size-4 shrink-0 text-muted" />
                    <RollCallMark state={isAboard ? "aboard" : "toCall"} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* The list goes on below the frame: two rows drawn, nine on the
              boat, so the head count and the rows read as one list. */}
          <p className="mt-1.5 text-xs text-muted">
            {t("fallback.moreOnTheList", { count: 9 - divers.length })}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * **Today, drawn small** — the shop home's two halves (ADR 20261001-logbook,
 * decision 4): one departure card as `DayStation` draws it (the time, its
 * stage pill, the readiness bar and the words under it), then two rows of the
 * "Needs you" list, each naming one diver, the one thing missing and its boat.
 * The waiver row carries its own button, as the real row does.
 *
 * The waiver row is not Priya's: the homepage follows Priya from the release
 * she signs one step earlier to the recap that thanks her, so her name on an
 * unsigned waiver here would contradict the band's own title ("One booking…",
 * conversion review, 2026-10-05).
 */
export function FrontDeskReadinessFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const rows = [
    {
      kind: t("fallback.kindWaiver"),
      // i18n-exempt: sample diver name used only in marketing mockups
      name: "Hana Sato",
      detail: t("fallback.waiverNotSent"),
      action: t("fallback.sendWaiver"),
    },
    {
      kind: t("fallback.kindCertifications"),
      // i18n-exempt: sample diver name used only in marketing mockups
      name: "Diego Alvarez",
      detail: t("fallback.certPending"),
      action: null,
    },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.today")} />
      <div className={MOCK_BODY}>
        <div className="rounded-inset border border-border bg-surface p-4">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={FIGURE_INLINE_CLASS}>{t("fallback.todayStart")}</span>
            <span className="text-xs text-muted">{t("fallback.todayUntil")}</span>
            <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-strong">
              {t("fallback.phaseCheckin")}
            </span>
          </p>
          <h3 className="mt-1 text-sm font-semibold">{t("fallback.tripName")}</h3>
          {/* i18n-exempt: sample site, boat and crew used only in marketing mockups */}
          <p className="text-xs text-muted">French Reef · Mantis II · Keiko Tanaka</p>
          {/* Today's own bar (`ReadinessBar`): 7 ready and 2 blocked of a
              twelve-seat boat, the three open seats the bare track. */}
          <ReadinessBar className="mt-3" ready={7} blocked={2} of={12} />
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
            <span>{t("fallback.readyCount")}</span>
            <span className="font-medium text-danger">{t("fallback.blockedCount")}</span>
            <span className="text-muted">{t("fallback.spotsOpen")}</span>
          </p>
        </div>
        <p className={`mt-5 ${groupLabelClass()}`}>{t("fallback.needsYou")}</p>
        {/* Drawn as `DaySpine`'s `SpineRow` draws them: a stacked
            `LedgerRow` with the warning `StatusMark`, one word of kind, the
            person and the sentence, the boat on a quiet line under it, and
            the row's one fix. Only the type is the mock's smaller scale. */}
        <ul className="mt-2">
          {rows.map((row) => (
            <LedgerRow
              key={row.name}
              stacked
              leading={<StatusMark variant="warning" size="md" className="text-warning-strong" />}
              kind={{ word: row.kind, tone: "warning" }}
              trailing={
                row.action ? (
                  <button type="button" disabled className={`px-3 ${MOCK_SECONDARY_BUTTON}`}>
                    {row.action}
                  </button>
                ) : undefined
              }
            >
              <p className="min-w-0 text-sm leading-snug">
                <span className="font-medium">{row.name}</span>
                <span aria-hidden="true" className="text-muted">
                  {" · "}
                </span>
                {row.detail}
                <span className="block text-xs text-muted">{t("fallback.tripLine")}</span>
              </p>
            </LedgerRow>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The contacts importer's preview step, in miniature — the one screen that
 * answers "what actually comes across?" with a picture instead of a paragraph.
 *
 * Every element mirrors the real wizard
 * (`src/app/shop/[shopSlug]/settings/import/ImportWizard.tsx`): the
 * mapped-column chips it builds from the file's own headers, its
 * "Not recognized, so ignored" line, three of its eight stat tiles, and the
 * row table with the same `skipped` badge and `{level} · {status}` card line.
 * Keeping it a mirror is what makes it a claim rather than an illustration —
 * if the wizard's shape changes, this changes with it.
 */
export function ImportPreviewFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const rows = [
    // i18n-exempt: sample diver names and certification levels, marketing mockup only
    { row: 1, name: "Priya Sharma", card: "Open Water", skipped: false },
    { row: 2, name: "Tom Okafor", card: "Rescue Diver", skipped: false },
    { row: 3, name: null, card: null, skipped: true },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.import.label")} />
      <div className={MOCK_BODY}>
        <p className={groupLabelClass("primary")}>{t("fallback.import.eyebrow")}</p>
        <h3 className={`mt-1 ${SUB_TITLE_CLASS}`}>{t("fallback.import.title")}</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            [t("fallback.import.fieldName"), "Name"],
            [t("fallback.import.fieldEmail"), "email"],
            [t("fallback.import.fieldCard"), "CertLevel"],
            [t("fallback.import.fieldSuit"), "Suit"],
          ].map(([field, header]) => (
            <span
              key={header}
              className="inline-flex items-baseline gap-1.5 rounded-full bg-surface-sunken px-3 py-1 text-xs"
            >
              <span className="font-medium">{field}</span>
              {/* i18n-exempt: the file's own raw column headers, shown verbatim */}
              <span className="font-mono text-muted">{header}</span>
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-warning">{t("fallback.import.ignored")}</p>
        {/* No tile narrower than its longest word: es-ES's "Certificaciones"
            is one word of about 72.9px, past even the 68.67px `px-2` leaves
            at 360, so its column takes that and the other two share the rest.
            In en-US every label fits and the three stay equal (K-122). */}
        <dl className="mt-4 grid grid-cols-[repeat(3,minmax(min-content,1fr))] gap-2">
          {[
            [t("fallback.import.statDivers"), "128"],
            [t("fallback.import.statCards"), "96"],
            [t("fallback.import.statSkipped"), "2"],
          ].map(([label, value]) => (
            // `px-2` below sm: three tiles at 360 leave a 60.67px label box
            // with `px-3`, and "Certifications" is 64.8px (K-122).
            <div key={label} className="rounded-lg bg-surface-sunken px-2 py-2 sm:px-3">
              <dt className="text-[10px] text-muted">{label}</dt>
              <dd className={FIGURE_INLINE_CLASS}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 overflow-hidden rounded-inset border border-border bg-surface">
          {rows.map((row) => (
            <div
              key={row.row}
              className={`flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0 ${
                // `text-muted`, not `opacity-60` — see `ImportWizard`, the
                // real surface this is a still of.
                row.skipped ? "text-muted" : ""
              }`}
            >
              <p className="flex items-center gap-2 text-sm">
                <span className="tabular-nums text-muted">{row.row}</span>
                {row.name ? (
                  <span className="font-semibold">{row.name}</span>
                ) : (
                  <span className="text-danger">{t("fallback.import.noName")}</span>
                )}
                {row.skipped ? (
                  <span className="rounded bg-danger-tint px-1.5 py-0.5 text-xs text-danger">
                    {t("fallback.import.skippedBadge")}
                  </span>
                ) : null}
              </p>
              <p className="whitespace-nowrap text-xs text-muted">
                {row.card
                  ? t("fallback.import.cardLine", { level: row.card })
                  : t("fallback.import.emptyValue")}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Settings → Data export, in miniature — the screen behind "you can leave with
 * your records any day", which `/pricing` had been arguing in a paragraph.
 *
 * Every element mirrors the real surface
 * (`src/app/shop/[shopSlug]/settings/export/page.tsx`): its eyebrow and title,
 * the one download button in its header, the "What's in the bundle" row with the
 * file count on it, file cards carrying a real `EXPORT_FILE_NOTES` note and a row
 * count each, and the "Not included, on purpose:" line.
 *
 * That last line is the point of drawing this at all. It is the unflattering
 * part — it says out loud that login accounts and password hashes never leave —
 * and a mockup that cropped it out would be an illustration rather than a claim
 * (docs/product/marketing.md). The three files shown are three real entries from
 * `EXPORT_FILE_NOTES`, carrying their own notes, and the file count is the real
 * length of that list. Deliberately no `photos/` row: the bundled images are a
 * *directory* in the zip, not one of the counted files, so a row for them would
 * be an element the real screen does not have — the band's own copy is where the
 * photos claim belongs.
 */
export function ExportBundleFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  // **Numbers, not pre-grouped strings.** `fallback.export.rowCount` is an ICU
  // plural now (issue #778), and ICU formats `#` with the locale's own number
  // format — so `1204` renders as "1,204" here and "1204" for a reader in
  // Spanish, which the hard-coded English grouping never did. Passing the
  // string instead renders **NaN**, because a comma is not a number: that is
  // what the pricing page's visual capture caught.
  const files = [
    // i18n-exempt: the bundle's own file names, shown verbatim as they arrive
    { file: "contacts.csv", note: t("fallback.export.contactsNote"), rows: 128 },
    { file: "waiver_records.csv", note: t("fallback.export.waiversNote"), rows: 412 },
    { file: "bookings.csv", note: t("fallback.export.bookingsNote"), rows: 1204 },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.export.label")} />
      <div className={MOCK_BODY}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={groupLabelClass("primary")}>{t("fallback.export.eyebrow")}</p>
            <h3 className={`mt-1 ${SUB_TITLE_CLASS}`}>{t("fallback.export.title")}</h3>
          </div>
          <button type="button" disabled className={`shrink-0 ${MOCK_PRIMARY_BUTTON}`}>
            {t("fallback.export.download")}
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-inset border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">{t("fallback.export.bundleHeading")}</p>
            <p className="mt-0.5 text-xs text-muted">{t("fallback.export.fileCount")}</p>
          </div>
          {files.map(({ file, note, rows }) => (
            <div
              key={file}
              className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="font-mono text-sm text-foreground">{file}</p>
                <p className="mt-0.5 text-xs text-muted">{note}</p>
              </div>
              <span className="shrink-0 text-xs font-medium text-muted tabular-nums">
                {t("fallback.export.rowCount", { count: rows })}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          <span className="font-medium text-foreground">
            {t("fallback.export.notIncludedLabel")}
          </span>{" "}
          {t("fallback.export.notIncludedText")}
        </p>
      </div>
    </div>
  );
}

export function DiverBookingFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const trips = [
    { title: t("fallback.tripName"), time: t("fallback.tomorrowTime"), spots: 3 },
    { title: t("fallback.nightDive"), time: t("fallback.fridayTime"), spots: 5 },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.schedule")} />
      <div className={MOCK_BODY}>
        <p className={groupLabelClass("primary")}>{t("fallback.upcomingTrips")}</p>
        <h3 className={`mt-1 ${SUB_TITLE_CLASS}`}>{t("fallback.findNextDive")}</h3>
        <div className="mt-4 space-y-3">
          {trips.map((trip) => (
            <div key={trip.title} className="rounded-inset border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{trip.title}</h4>
                  <p className="mt-1 text-sm text-muted">{trip.time}</p>
                </div>
                <span className="rounded-full bg-primary-tint px-2.5 py-1 text-xs font-semibold text-primary">
                  {t("fallback.spotsLeft", { count: trip.spots })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * **The keepsake a diver keeps** — the dive record, the crew's word, and the
 * one thing the page asks. It is the thread's after-state
 * ([20260827-the-divers-thread](../../docs/architecture/decisions/20260827-the-divers-thread.md),
 * decision 4, slice 7d) drawn small, so a buyer sees the artifact their shop's
 * name ends up on rather than a description of it.
 *
 * It was a stat row, a crew note and a photo grid before that slice landed —
 * a picture of a page that no longer exists. The redraw follows the real
 * surface's order: the record first (the *only* place the day's facts render),
 * then the crew's word, then the review ask as the one primary. The photo and
 * tip doors are deliberately absent: they are quiet on the real page, and a
 * mockup that shows every door shows none of them as quiet.
 *
 * **Its caller describes this screen in its own `aria-label`**: the
 * homepage's recap step, the last of one booking's six (H-93), which first
 * drew it as the evening moment (docs/product/marketing-review-20260827.md,
 * "A third moment: the evening"). So a redraw of this component has to carry
 * `marketing.home.steps.recap.mockupLabel` with it, in both locales, or the
 * label stops naming what the reader is looking at.
 *
 * Every control stays `disabled`: the homepage's steps open no door into the
 * demo, and this screen is not one (`e2e/marketing.spec.ts`).
 */
export function RecapPageFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.recap.label")} />
      <div className={MOCK_BODY}>
        <h3 className={SUB_TITLE_CLASS}>{t("fallback.recap.greeting")}</h3>
        <p className="mt-1 text-sm text-muted">{t("fallback.recap.tripLine")}</p>

        {/* The dive record: the one place the day's facts render. */}
        <div className="mt-4 rounded-inset border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{t("fallback.recap.recordHeading")}</h4>
            <span className="rounded-md bg-primary-tint px-2 py-0.5 text-[10px] font-semibold text-primary">
              {t("fallback.recap.visits")}
            </span>
          </div>
          <dl className="mt-2 divide-y divide-border border-t border-border text-xs">
            {[
              // i18n-exempt: sample boat and crew used only in the marketing mockup
              [t("fallback.recap.boatLabel"), "Mantis II · Keiko Tanaka"],
              // The record stopped printing the *site's* deepest point as
              // though it were this diver's, so the mockup carries no depth
              // either — one that still did would sell a screen we do not
              // render.
              // i18n-exempt: sample site used only in the marketing mockup
              [t("fallback.recap.sitesLabel"), "French Reef"],
              // i18n-exempt: sample conditions used only in the marketing mockup
              [t("fallback.recap.conditionsLabel"), "27°C · 24 m"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-3 py-1.5">
                <dt className="w-20 shrink-0 text-muted">{label}</dt>
                <dd className="min-w-0 flex-1 font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* The crew's word, as a quote rather than a boxed panel. */}
        <figure className="mt-4">
          <blockquote className="text-sm leading-6">{t("fallback.recap.crewNote")}</blockquote>
          <figcaption className="mt-1 text-xs text-muted">
            {t("fallback.recap.crewNoteLabel")}
          </figcaption>
        </figure>

        {/* The one ask. */}
        <div className="mt-4 rounded-inset border border-border bg-surface p-3">
          <h4 className="text-sm font-semibold">{t("fallback.recap.reviewAsk")}</h4>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((star) => (
              <svg
                key={star}
                // The row is already `aria-hidden`, but the rule reads one
                // element at a time and cannot see the ancestor. Marking the
                // star itself is the same truth said twice, not a workaround:
                // it is a drawn mark in a fallback screenshot.
                aria-hidden="true"
                viewBox="0 0 18 18"
                className="size-5 fill-warning"
                focusable="false"
              >
                <path d="M9 1.8l2.1 4.4 4.8.6-3.5 3.3.9 4.8L9 12.6l-4.3 2.3.9-4.8L2.1 6.8l4.8-.6L9 1.8z" />
              </svg>
            ))}
          </div>
          <button type="button" disabled className={`mt-3 ${MOCK_PRIMARY_BUTTON}`}>
            {t("fallback.recap.reviewSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * **The diver's trip page the night before** (`/ready/[token]`), drawn small:
 * the dock call line, then the checklist in the page's own three words (Done,
 * Your turn, With the shop). The forecast is not here because the page does
 * not carry it; it arrives in the night-before email.
 */
export function NightBeforeBriefFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const done = "text-success-strong bg-success-tint";
  const yourTurn = "text-primary bg-primary-tint";
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.nightBefore.label")} />
      <div className={MOCK_BODY}>
        <h3 className={SUB_TITLE_CLASS}>{t("fallback.tripName")}</h3>
        <p className="mt-1 text-sm text-muted">{t("fallback.nightBefore.time")}</p>
        <p className="mt-4 rounded-inset bg-surface-sunken p-3 text-sm">
          {t("fallback.nightBefore.dockLine")}
        </p>
        <div className="mt-4 space-y-2">
          <ChecklistRow
            label={t("fallback.nightBefore.waiver")}
            status={t("fallback.nightBefore.done")}
            tone={done}
          />
          <ChecklistRow
            label={t("fallback.nightBefore.cert")}
            status={t("fallback.nightBefore.done")}
            tone={done}
          />
          <ChecklistRow
            label={t("fallback.nightBefore.gear")}
            status={t("fallback.nightBefore.yourTurn")}
            tone={yourTurn}
            mark={false}
          />
        </div>
      </div>
    </div>
  );
}
