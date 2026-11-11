"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
  textareaClassFor,
} from "@/components/ui/form";
import type { ConservationResult } from "@/features/conservation";
import { CONSERVATION_KINDS, type ConservationKind } from "@/lib/conservation";
import { useConservationActions } from "./ConservationActions";

export type ConservationCopy = {
  kind: string;
  lionfishHint: string;
  quantity: string;
  location: string;
  note: string;
  save: string;
  add: string;
  pending: string;
  delete: string;
  deleted: string;
  undo: string;
  dismiss: string;
  saved: string;
  kinds: Record<ConservationKind, string>;
  errors: Record<Exclude<ConservationResult, { ok: true }>["reason"], string>;
};

export function ConservationForm({
  row,
  copy,
}: {
  tripId: string;
  row?: {
    id: string;
    revision: number;
    kind: ConservationKind;
    quantity: number;
    location: string;
    note: string;
  };
  copy: ConservationCopy;
}) {
  const { result, action } = useConservationActions();
  const state = result?.targetId === row?.id ? result : null;
  const [kind, setKind] = useState(row?.kind ?? "litter_kg");
  const [quantity, setQuantity] = useState(row ? String(row.quantity) : "");
  const [location, setLocation] = useState(row?.location ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  useEffect(() => {
    if (state?.ok && !row) {
      setQuantity("");
      setLocation("");
      setNote("");
    }
  }, [state, row]);
  return (
    <form action={action} className="space-y-4">
      {row ? (
        <>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="revision" value={row.revision} />
        </>
      ) : null}
      <FieldGrid columns={2}>
        <Field label={copy.kind} hint={kind === "lionfish_count" ? copy.lionfishHint : undefined}>
          <select
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ConservationKind)}
            className={controlClass}
          >
            {CONSERVATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {copy.kinds[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.quantity}>
          <input
            className={controlClass}
            name="quantity"
            type="number"
            step={kind === "litter_items" || kind === "lionfish_count" ? "1" : "0.01"}
            min={kind === "litter_items" || kind === "lionfish_count" ? "1" : "0.01"}
            max="100000"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <Field label={copy.location}>
          <input
            className={controlClass}
            name="location"
            maxLength={120}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>
      </FieldGrid>
      <Field label={copy.note}>
        <textarea
          className={textareaClassFor(2)}
          rows={2}
          name="note"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <FieldActions>
        <SubmitButton
          name="operation"
          value="record"
          pendingLabel={copy.pending}
          className={buttonClass({ variant: row ? "secondary" : "primary" })}
        >
          {row ? copy.save : copy.add}
        </SubmitButton>
        {row ? (
          <SubmitButton
            name="operation"
            value="delete"
            formNoValidate
            pendingLabel={copy.pending}
            className={buttonClass({ variant: "danger" })}
          >
            {copy.delete}
          </SubmitButton>
        ) : null}
      </FieldActions>
      <FormStatus tone={state?.ok ? "success" : "danger"}>
        {state?.ok && !state.undo ? copy.saved : null}
      </FormStatus>
    </form>
  );
}
