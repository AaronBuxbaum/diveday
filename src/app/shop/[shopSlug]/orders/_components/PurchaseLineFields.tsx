import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { PurchaseRow, PurchaseWords } from "./purchase-form-types";

export function PurchaseLineFields({
  row,
  index,
  step,
  words,
  change,
  remove,
  removable,
  descriptionRef,
}: {
  row: PurchaseRow;
  index: number;
  step: string;
  words: PurchaseWords;
  change: (
    id: number,
    key: "kind" | "description" | "quantity" | "unitAmount",
    value: string,
  ) => void;
  remove: () => void;
  removable: boolean;
  descriptionRef: (node: HTMLInputElement | null) => void;
}) {
  return (
    <ChoiceFieldset
      legend={`${words.item} ${index + 1}`}
      className="rounded-lg border border-border p-4"
      bodyClassName="space-y-3"
    >
      <FieldGrid columns={2}>
        <Field label={words.item}>
          <input
            ref={descriptionRef}
            type="text"
            name={`description-${index}`}
            required
            maxLength={200}
            className={controlClass}
            value={row.description}
            onChange={(event) => change(row.id, "description", event.target.value)}
          />
        </Field>
        <Field label={words.kind}>
          <select
            name={`kind-${index}`}
            className={controlClass}
            value={row.kind}
            onChange={(event) => change(row.id, "kind", event.target.value)}
          >
            {words.kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={words.quantity}>
          <input
            type="number"
            name={`quantity-${index}`}
            min={1}
            max={100}
            step={1}
            required
            className={controlClass}
            value={row.quantity}
            onChange={(event) => change(row.id, "quantity", event.target.value)}
          />
        </Field>
        <Field label={words.price}>
          <input
            type="number"
            inputMode="decimal"
            name={`unitAmount-${index}`}
            min={0}
            max={100000}
            step={step}
            required
            className={controlClass}
            value={row.unitAmount}
            onChange={(event) => change(row.id, "unitAmount", event.target.value)}
          />
        </Field>
      </FieldGrid>
      {removable ? (
        <button type="button" className={buttonClass({ variant: "ghost" })} onClick={remove}>
          {words.remove}
        </button>
      ) : null}
    </ChoiceFieldset>
  );
}
