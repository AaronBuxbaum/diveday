"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { AutoPrint } from "@/components/paper/AutoPrint";
import { buttonClass } from "@/components/ui/button";

type PaperState = { autoPrint: boolean } | null;

const OpenPaper = createContext<(() => void) | null>(null);

/**
 * **The after-state's paper is a state of the page** (issue #2745), the way
 * the offline manifest's saved copy is: the screen is gone while the sheet
 * shows, so nothing that taps prints and nothing printed taps.
 *
 * Two doors reach it. "Print log entry" (`PrintRecordButton`) opens it and the
 * print dialog with it. The browser's own Print reaches it too: `beforeprint`
 * swaps the screen for the sheet before the browser takes its picture
 * (`flushSync`), so Ctrl+P on a diver's day prints the logbook page and never
 * the screen. Back returns to the screen.
 *
 * The sheet arrives drawn by the server (`DiveRecordSheet`); this holds only
 * which face shows. Words arrive as props: it reads no translator.
 */
export function RecordPaper({
  sheet,
  backLabel,
  printLabel,
  children,
}: {
  sheet: ReactNode;
  backLabel: string;
  printLabel: string;
  /** The screen. */
  children: ReactNode;
}) {
  const [paper, setPaper] = useState<PaperState>(null);

  useEffect(() => {
    const beforePrint = () => flushSync(() => setPaper((now) => now ?? { autoPrint: false }));
    window.addEventListener("beforeprint", beforePrint);
    return () => window.removeEventListener("beforeprint", beforePrint);
  }, []);

  if (!paper) {
    return (
      <OpenPaper.Provider value={() => setPaper({ autoPrint: true })}>
        {children}
      </OpenPaper.Provider>
    );
  }
  return (
    <main className="w-full flex-1 bg-background" data-testid="dive-record-paper">
      {paper.autoPrint ? <AutoPrint /> : null}
      {/* The way back and a second Print, for a diver who dismissed the
          dialog. The browser prints this row too unless it is told not to,
          and it is the one row on this page that is not the sheet. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => setPaper(null)}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {backLabel}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {printLabel}
        </button>
      </div>
      <div className="paper-sheet-frame">
        <div>{sheet}</div>
      </div>
    </main>
  );
}

/** Opens the record's paper; `null` outside a {@link RecordPaper}. */
export function useOpenRecordPaper(): (() => void) | null {
  return useContext(OpenPaper);
}
