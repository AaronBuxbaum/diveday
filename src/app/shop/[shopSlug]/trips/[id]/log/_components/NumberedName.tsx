/**
 * A roster row's number and the diver's name, as the departure log prints
 * them: "01 Theo Lindqvist". The number is a box of its own that never
 * shrinks and the name wraps inside the box beside it, so a surname that
 * wraps in a narrow Diver column hangs under the first name rather than
 * returning under "01" (K-553). The space stays in the text between the two
 * boxes, so the cell still reads, copies and is matched as one string.
 */
export function NumberedName({ number, name }: { number: number; name: string }) {
  return (
    <span className="flex gap-1 font-semibold">
      <span className="shrink-0 tabular-nums">{String(number).padStart(2, "0")}</span>{" "}
      <span className="min-w-0">{name}</span>
    </span>
  );
}
