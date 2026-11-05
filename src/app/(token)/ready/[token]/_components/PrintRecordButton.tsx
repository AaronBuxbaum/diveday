"use client";

import { buttonClass } from "@/components/ui/button";
import { useOpenRecordPaper } from "./RecordPaper";

/**
 * Opens the record's paper (`RecordPaper`), which opens the browser's print
 * dialog — also how it becomes a PDF, and how it reaches a paper logbook. What
 * prints is the logbook sheet (`DiveRecordSheet`), never the screen. Nothing
 * to open, nothing to press: outside a `RecordPaper` it renders nothing. The
 * label is the caller's; this file holds no copy.
 */
export function PrintRecordButton({ label }: { label: string }) {
  const open = useOpenRecordPaper();
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={open}
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      {label}
    </button>
  );
}
