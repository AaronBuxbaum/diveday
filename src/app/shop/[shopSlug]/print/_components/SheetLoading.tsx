import { PRINT_SHEET_BOX_MM, type PrintSheetPaper } from "@/lib/print-sheets";

/**
 * A sheet-shaped skeleton: the band, a few lines of body, the fold rule — at
 * the exact millimetres of the paper it stands in for, so arriving at a sheet
 * does not jump and a slow read never makes an A3 look like an A6.
 */
export function SheetLoading({ paper }: { paper: PrintSheetPaper }) {
  const box = PRINT_SHEET_BOX_MM[paper];
  return (
    <div className="paper-sheet-frame animate-pulse">
      <div
        className="flex flex-col border border-border bg-surface"
        style={{ width: `${box.width}mm`, minHeight: `${box.height}mm` }}
      >
        <div className="h-12 w-full bg-surface-sunken" />
        <div className="flex-1 space-y-3 p-5">
          <div className="h-8 w-2/3 rounded bg-surface-sunken" />
          <div className="h-4 w-1/2 rounded bg-surface-sunken" />
          <div className="h-4 w-1/3 rounded bg-surface-sunken" />
          <div className="h-24 w-24 rounded bg-surface-sunken" />
        </div>
        <div className="h-6 w-full border-t border-border" />
      </div>
    </div>
  );
}
