import { SummaryCaret } from "@/components/ui/disclosure";
import type { EmbedKind } from "@/lib/embed-snippets";
import type { EmbedGeneratorCopy } from "./EmbedGenerator";

/** Common formats lead; every supplied format remains in the same native radio group. */
export function EmbedKindChoices({
  kind,
  kinds,
  name,
  copy,
  onChange,
}: {
  kind: EmbedKind;
  kinds: readonly EmbedKind[];
  name: string;
  copy: Pick<EmbedGeneratorCopy, "what" | "kinds" | "kindHints" | "moreFormats" | "sharingFormats">;
  onChange: (kind: EmbedKind) => void;
}) {
  // Different hint lengths stretch the tiles; titles still share the top line.
  const tile = (active: boolean) =>
    `flex min-h-11 flex-col items-start justify-start rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
      active
        ? "border-primary bg-primary-tint text-foreground"
        : "border-border bg-surface text-foreground hover:bg-surface-sunken"
    }`;

  // One selection seam retains course/trip reset behavior for every format group.
  const kindChoice = (k: EmbedKind) => (
    <label key={k} className={`${tile(kind === k)} cursor-pointer has-[:focus-visible]:focus-ring`}>
      <input
        type="radio"
        name={`${name}-kind`}
        value={k}
        checked={kind === k}
        onChange={() => onChange(k)}
        className="sr-only"
      />
      <span className="font-semibold">{copy.kinds[k]}</span>
      <span className="text-xs text-muted">{copy.kindHints[k]}</span>
    </label>
  );

  return (
    <>
      <p className="hidden text-sm font-medium print:block">{copy.kinds[kind]}</p>
      <fieldset className="print:hidden">
        <legend id={name} className="sr-only">
          {copy.what}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {kinds.filter((k) => k === "calendar" || k === "button").map(kindChoice)}
        </div>
        <details open={kind !== "calendar" && kind !== "button"} className="group/formats mt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
            {copy.moreFormats}
            {kind !== "calendar" && kind !== "button" ? (
              <span className="ms-2 text-muted">{copy.kinds[kind]}</span>
            ) : null}
            <SummaryCaret className="ms-2 size-3 group-open/formats:rotate-90" />
          </summary>
          <div className="grid grid-cols-2 gap-2">
            {kinds
              .filter((k) => k !== "calendar" && k !== "button" && k !== "qr" && k !== "partner")
              .map(kindChoice)}
          </div>
          {kinds.some((k) => k === "qr" || k === "partner") ? (
            <p className="mb-2 mt-4 text-sm text-muted">{copy.sharingFormats}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {kinds.filter((k) => k === "qr" || k === "partner").map(kindChoice)}
          </div>
        </details>
      </fieldset>
    </>
  );
}
