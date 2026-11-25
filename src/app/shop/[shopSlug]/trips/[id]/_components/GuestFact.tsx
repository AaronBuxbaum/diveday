import type { ReactNode } from "react";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { FACT_BODY, FACT_ROW as ROW } from "./trip-ink";

const DOOR = "font-medium text-primary";

/**
 * **One fact about an opened guest: its name, what is on file, and the one way
 * to change it** (owner, 2026-11-25). Every row of the list is this row, so a
 * fact is changed the same way wherever it is: the word at the row's end
 * ("Edit", or "Add" when nothing is on file) opens its form under it. A fact
 * nobody changes here has no word; one changed elsewhere has a link in its
 * place (`door`).
 */
export function GuestFact({
  id,
  label,
  value,
  empty = false,
  edit,
  door,
}: {
  id?: string;
  label: string;
  value: ReactNode;
  /** Nothing on file: the value is said in muted ink. */
  empty?: boolean;
  /** The form that changes the fact, and the word that opens it. */
  /** `open` only ever opens it: a refused save comes back to its form (`AutoOpenDetails`). */
  edit?: { label: string; form: ReactNode; open?: boolean };
  /** A link in place of the word, for a fact kept on another page. */
  door?: ReactNode;
}) {
  const cells = (
    <>
      <span className="text-muted">{label}</span>
      <span className={`min-w-0 [overflow-wrap:anywhere] ${empty ? "text-muted" : ""}`}>
        {value}
      </span>
    </>
  );
  if (!edit) {
    return (
      <div id={id} data-guest-fact="" className={`scroll-mt-24 ${ROW}`}>
        {cells}
        <span className={DOOR}>{door}</span>
      </div>
    );
  }
  return (
    <AutoOpenDetails
      id={id}
      openOnHash={id ?? []}
      open={edit.open}
      className="group/fact scroll-mt-24"
    >
      <summary
        data-guest-fact=""
        className={`${ROW} cursor-pointer list-none rounded-lg select-none [&::-webkit-details-marker]:hidden hover:[&>span:last-child]:underline focus-visible:focus-ring-inset`}
      >
        {cells}
        <span className={DOOR}>{edit.label}</span>
      </summary>
      <div className={FACT_BODY}>{edit.form}</div>
    </AutoOpenDetails>
  );
}
