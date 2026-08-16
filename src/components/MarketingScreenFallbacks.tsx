import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/**
 * Each fallback takes `locale` as a plain prop rather than reading
 * `requestLocale()` itself: these render inside the marketing pages'
 * `"use cache"` bodies (`src/app/page.tsx`, `src/app/product/page.tsx`), and
 * cached scopes cannot call `headers()`-backed functions themselves — see
 * AGENTS.md's `cacheComponents` notes.
 */

function AppBar({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 text-xs text-muted">
      {/* i18n-exempt: sample shop name used only in marketing mockups */}
      <span className="font-semibold tracking-wide text-primary uppercase">Blue Mantis Divers</span>
      <span>{label}</span>
    </div>
  );
}

export function CaptainRollCallFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.offlineCopy")} />
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">
            {t("fallback.boatManifest")}
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">{t("fallback.tripName")}</h3>
          <p className="text-xs text-muted">{t("fallback.tripTime")}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [t("fallback.diversLabel"), "9"],
            [t("fallback.readyLabel"), "7"],
            [t("fallback.boardedLabel"), "4"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface p-2">
              <p className="text-[10px] font-medium text-muted uppercase">{label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{t("fallback.rollCall")}</h3>
          <div className="mt-2 space-y-2">
            {/* i18n-exempt: sample diver names used only in marketing mockups */}
            {["Priya Sharma", "Tom Okafor"].map((name) => (
              <div key={name} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="text-xs text-success">{t("fallback.readyToBoard")}</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    {t("fallback.markBoarded")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FrontDeskReadinessFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const rows = [
    { name: "Priya Sharma", status: t("fallback.waiverNeedsAttention"), tone: "text-danger" },
    { name: "Lena Fischer", status: t("fallback.readyToBoard"), tone: "text-success" },
    { name: "Diego Alvarez", status: t("fallback.certificationPending"), tone: "text-warning" },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.tripDetail")} />
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          {t("fallback.readiness")}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">
          {t("fallback.answerBeforeDock")}
        </h3>
        <p className="mt-1 text-sm text-muted">{t("fallback.noDiverClears")}</p>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {/* i18n-exempt: sample diver names used only in marketing mockups */}
          {rows.map(({ name, status, tone }) => (
            <div key={name} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm font-semibold">{name}</p>
              <p className={`text-xs font-medium ${tone}`}>{status}</p>
            </div>
          ))}
        </div>
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
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          {t("fallback.import.eyebrow")}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">{t("fallback.import.title")}</h3>
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
        <dl className="mt-4 grid grid-cols-3 gap-2">
          {[
            [t("fallback.import.statDivers"), "128"],
            [t("fallback.import.statCards"), "96"],
            [t("fallback.import.statSkipped"), "2"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-sunken px-3 py-2">
              <dt className="text-[10px] text-muted">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          {rows.map((row) => (
            <div
              key={row.row}
              className={`flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0 ${
                row.skipped ? "opacity-60" : ""
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
                  <span className="rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger">
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
  const files = [
    // i18n-exempt: the bundle's own file names, shown verbatim as they arrive
    { file: "contacts.csv", note: t("fallback.export.contactsNote"), rows: "128" },
    { file: "waiver_records.csv", note: t("fallback.export.waiversNote"), rows: "412" },
    { file: "bookings.csv", note: t("fallback.export.bookingsNote"), rows: "1,204" },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.export.label")} />
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-widest text-primary uppercase">
              {t("fallback.export.eyebrow")}
            </p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight">
              {t("fallback.export.title")}
            </h3>
          </div>
          <button
            type="button"
            disabled
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
          >
            {t("fallback.export.download")}
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
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
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          {t("fallback.upcomingTrips")}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">{t("fallback.findNextDive")}</h3>
        <div className="mt-4 space-y-3">
          {trips.map((trip) => (
            <div key={trip.title} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{trip.title}</h4>
                  <p className="mt-1 text-sm text-muted">{trip.time}</p>
                </div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
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
 * A slice of the post-trip page a diver keeps and shares: the trip identity,
 * useful dive facts, a crew note, and the diver's own photos. It gives the
 * product page a concrete picture of the memory the trip creates after the
 * operational work is finished.
 */
export function RecapPageFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.recap.label")} />
      <div className="p-5">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">
          {t("fallback.recap.eyebrow")}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{t("fallback.recap.greeting")}</h3>
            <p className="mt-1 text-sm text-muted">{t("fallback.recap.tripLine")}</p>
          </div>
          <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
            {t("fallback.recap.completed")}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {/* i18n-exempt: sample dive facts used only in the marketing mockup */}
          {[
            [t("fallback.recap.depth"), "18 m"],
            [t("fallback.recap.visibility"), "24 m"],
            [t("fallback.recap.water"), "27°C"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface p-2">
              <p className="text-[10px] font-medium text-muted uppercase">{label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-border bg-surface p-3">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">
            {t("fallback.recap.crewNoteLabel")}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">{t("fallback.recap.crewNote")}</p>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">{t("fallback.recap.photos")}</h4>
            <span className="text-xs text-muted">{t("fallback.recap.photoCount")}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-primary/35 via-primary/10 to-surface" />
            <div className="aspect-[4/3] rounded-lg bg-gradient-to-br from-success/30 via-primary/10 to-surface" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
          >
            {t("fallback.recap.share")}
          </button>
          <button
            type="button"
            disabled
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 text-xs font-semibold"
          >
            {t("fallback.recap.addPhoto")}
          </button>
        </div>
      </div>
    </div>
  );
}
