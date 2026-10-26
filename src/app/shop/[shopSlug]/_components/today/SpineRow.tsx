import type { ReactNode } from "react";
import { LedgerRow, type LedgerRowKindTone } from "@/components/ui/ledger";
import { RowGlyph, type RowIconName } from "./row-glyph";

export function SpineRow({
  tone,
  icon,
  kind,
  trailing,
  closed = true,
  door,
  children,
}: {
  tone: LedgerRowKindTone;
  /** A quiet row's category drawing; ignored on a row that is wrong. */
  icon?: RowIconName;
  /** One word of kind, in the row's own type. */
  kind: string;
  /** The row's fix when it performs one — a real control beside the words. */
  trailing?: ReactNode;
  /** `false` inside a station's panel, whose own edge closes the list. */
  closed?: boolean;
  /**
   * Where the row's own tap goes, and its name for a screen reader. One object,
   * not two props: `LedgerRow`'s door is a union, so a link never reaches a
   * reader without an accessible name. Absent on a row that performs its fix.
   */
  door?: { href: string; linkLabel: string };
  /** The sentence's words. */
  children: ReactNode;
}) {
  // Both halves or neither, as one value: the union `LedgerRow` takes.
  const doorProps: { href: string; linkLabel: string } | { href?: never; linkLabel?: never } =
    door ?? {};
  return (
    <LedgerRow
      // Stacked below `sm`: the kind and the fix share the first line and the
      // sentence takes the width beneath them, which is the phone artboard's
      // reading and the only one where a full sentence has room to be read.
      stacked
      // The row's glyph — the first of the anatomy's four parts (glyph, one
      // word of kind, one sentence, one fix), drawn from the shipped status
      // family and never from the illustration hand: a status glyph is a
      // status, and the ADR keeps drawings out of that job. The kind word
      // beside it carries the meaning; the glyph is what a scan reads first.
      leading={<RowGlyph tone={tone} icon={icon} />}
      kind={{ word: kind, tone }}
      trailing={trailing}
      closed={closed}
      {...doorProps}
    >
      {/* One line per row (ADR 20260904-reef-all-the-way-down, slice 16a):
          the sentence at reading size — a subject over a detail at 14px was
          the rail's grammar, and a panel reads as one sentence. */}
      <p className="min-w-0 text-base leading-snug">{children}</p>
    </LedgerRow>
  );
}
