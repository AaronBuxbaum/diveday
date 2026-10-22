"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { importAssistSample } from "@/lib/assists/import-mapping";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { type ImportAssist, type PreparedImport, prepareContactImport } from "@/lib/import";
import { type ImportActionState, importContactsAction } from "./actions";
import { ImportPreview, PREVIEW_LIMIT } from "./ImportPreview";
import { ImportResult } from "./ImportResult";
import type { ImportWizardCopy } from "./import-wizard-copy";

/** The `import` assist's action and words (ADR 20261018-claude-assists); absent while dark. */
export type ImportWizardAssist = {
  map: (csv: string) => Promise<ImportAssist | null>;
  words: {
    map: string;
    mapping: string;
    mapHint: string;
    mapNothing: string;
    /** "{field}, suggested". */
    suggested: string;
    pendingCards: string;
  };
};

export function ImportWizard({
  diversHref,
  intro,
  copy,
  locale,
  assist,
  timeZone,
}: {
  diversHref: string;
  /** Rendered on the server via `t.rich` for the embedded `contacts.csv` mono span. */
  intro: ReactNode;
  copy: ImportWizardCopy;
  /**
   * The reader's negotiated locale, for the one list this component joins
   * itself. Passed down rather than left to the runtime default, which in a
   * browser is the *device's* language and not the one the page is written in.
   */
  locale: string;
  assist?: ImportWizardAssist;
  /** The shop's timezone: a booking after the shop's today is listed, never filed as a visit. */
  timeZone: string;
}) {
  const [state, formAction] = useActionState<ImportActionState, FormData>(importContactsAction, {
    status: "idle",
  });
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  // Claude's mapping for this file, once asked for, and whether asking found
  // nothing. Both reset with the file.
  const [mapped, setMapped] = useState<ImportAssist | null>(null);
  const [mapNothing, setMapNothing] = useState(false);
  const [mapping, startMapping] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Bumped whenever the file in hand changes. An answer for an older file (a
  // mapping still running when the staffer picks another) is dropped, so the
  // preview never shows one file while the hidden `csv` posts another.
  const fileGeneration = useRef(0);
  // The whole preview runs in the browser off this input's change event, so a
  // file chosen before hydration is silently dropped. Marked here so a test can
  // wait for the real thing rather than race it (same pattern as the booking
  // party fields).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Import/export is security- and data-sensitive (AGENTS.md). This route has
  // no dynamic id, so if `cacheComponents: true`'s Activity-based navigation
  // is ever re-enabled, a stale parsed preview — and the hidden `csvText` a
  // submit would commit — could otherwise survive a navigate-away-and-back
  // for a file the staffer no longer has open (docs ADR
  // 20260801-cache-components-activity-state, currently reverted, commit
  // 100fcf8). Clear the whole preview on the leading edge of any
  // (re)navigation, same pattern as InlineConfirm.
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change clears the preview, which is the point.
  useEffect(() => {
    fileGeneration.current += 1;
    setFileName(null);
    setCsvText("");
    setPrepared(null);
    setMapped(null);
    setMapNothing(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [pathname]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const generation = ++fileGeneration.current;
    const text = await file.text();
    if (generation !== fileGeneration.current) return;
    setFileName(file.name);
    setCsvText(text);
    // The preview's today; the commit re-reads it on the server.
    setPrepared(prepareContactImport(text, { today: calendarDateInTimezone(nowDate(), timeZone) }));
    setMapped(null);
    setMapNothing(false);
  }

  // Offered only when the file has a column or a level spelling the importer
  // could not read on its own, and the shop's assists are on.
  const canMap =
    assist !== undefined &&
    prepared !== null &&
    !prepared.fatal &&
    mapped === null &&
    importAssistSample(csvText) !== null;

  function mapColumns() {
    if (!assist) return;
    const text = csvText;
    const generation = fileGeneration.current;
    startMapping(async () => {
      let answer: ImportAssist | null = null;
      try {
        answer = await assist.map(text);
      } catch {
        answer = null;
      }
      if (generation !== fileGeneration.current) return;
      const useful =
        answer && (Object.keys(answer.headers).length > 0 || Object.keys(answer.levels).length > 0);
      if (!answer || !useful) {
        setMapNothing(true);
        return;
      }
      setMapped(answer);
      // The same preparation the confirm re-runs on the server with this mapping.
      setPrepared(
        prepareContactImport(text, {
          today: calendarDateInTimezone(nowDate(), timeZone),
          assist: answer,
        }),
      );
    });
  }

  const showResult = state.status === "done";
  const previewRows = prepared?.rows.slice(0, PREVIEW_LIMIT) ?? [];
  const hiddenRows = (prepared?.rows.length ?? 0) - previewRows.length;

  return (
    <SectionCard padding="lg" title={copy.heading} description={intro}>
      <div className="flex flex-wrap items-center gap-3">
        <label className={buttonClass({ variant: "secondary", className: "cursor-pointer" })}>
          {fileName ? copy.chooseDifferentFile : copy.chooseFile}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            data-hydrated={hydrated ? "true" : "false"}
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
        {fileName ? <span className="text-sm text-muted">{fileName}</span> : null}
      </div>

      {/* A file this wizard cannot read is a refusal of the control just used,
          not news about the page — so it renders in the chooser's own row
          rather than as a banner (see `FormStatus`, components/ui/form.tsx). */}
      <FormStatus tone="danger" className="mt-3">
        {prepared?.fatal
          ? fill(copy.errors[prepared.fatal.code], prepared.fatal.params ?? {})
          : undefined}
      </FormStatus>

      {canMap && assist ? (
        <div className="mt-4 grid gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={mapColumns}
              disabled={mapping}
              aria-busy={mapping || undefined}
              className={buttonClass({ variant: "ghost", size: "sm", busy: mapping })}
            >
              {mapping ? assist.words.mapping : assist.words.map}
            </button>
            {mapNothing ? (
              <span className="text-sm text-muted">{assist.words.mapNothing}</span>
            ) : null}
          </div>
          <p className="text-xs text-muted">{assist.words.mapHint}</p>
        </div>
      ) : null}

      {prepared && !prepared.fatal ? (
        <ImportPreview
          prepared={prepared}
          previewRows={previewRows}
          hiddenRows={hiddenRows}
          copy={copy}
          showResult={showResult}
          formAction={formAction}
          csvText={csvText}
          state={state}
          assist={
            assist && mapped
              ? {
                  json: JSON.stringify(mapped),
                  suggested: assist.words.suggested,
                  pendingCards: assist.words.pendingCards,
                }
              : undefined
          }
          locale={locale}
        />
      ) : null}

      {showResult && state.status === "done" ? (
        <ImportResult state={state} copy={copy} locale={locale} diversHref={diversHref} />
      ) : null}
    </SectionCard>
  );
}
