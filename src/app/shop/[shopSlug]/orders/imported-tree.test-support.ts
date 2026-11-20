import type { ReactElement } from "react";
import { findElements, hrefsIn } from "@/test/jsx-inspect";
import { ImportedHistoryTable } from "./_components/ImportedHistoryTable";

/** Every link on the page, its imported-history table included: that table is its own component, so it renders only from the props the page gave it. */
export function importedHrefs(element: ReactElement): string[] {
  const table = findElements<Parameters<typeof ImportedHistoryTable>[0]>(
    element,
    ImportedHistoryTable,
  )[0];
  return hrefsIn([element, table ? ImportedHistoryTable(table.props) : null]);
}
