"use client";

import { createContext, useActionState, useContext, useState } from "react";
import { undoAction } from "@/app/actions/undo";
import { UndoToast } from "@/components/UndoToast";
import { FormStatus } from "@/components/ui/form";
import { type ConservationActionResult, recordConservationAction } from "../conservation-actions";
import type { ConservationCopy } from "./ConservationForm";

const Context = createContext<{
  result: ConservationActionResult | null;
  action: (form: FormData) => void;
} | null>(null);

/** The delete's inverse outlives the row removed by the server refresh. */
export function ConservationActions({
  tripId,
  shopSlug,
  copy,
  children,
}: {
  tripId: string;
  shopSlug: string;
  copy: ConservationCopy;
  children: React.ReactNode;
}) {
  const [undoing, setUndoing] = useState(false);
  const [result, action] = useActionState(
    async (previous: ConservationActionResult | null, form: FormData) => {
      const next = await recordConservationAction(tripId, previous, form);
      setUndoing(false);
      return next;
    },
    null,
  );
  return (
    <Context.Provider value={{ result, action }}>
      {result?.ok && result.undo && !undoing ? (
        <UndoToast
          placement="inline"
          message={copy.deleted}
          action={async (form) => {
            setUndoing(true);
            await undoAction(shopSlug, form);
          }}
          fields={{
            undo: "trip-conservation",
            undoTrip: tripId,
            undoRecord: result.undo.id,
            undoRevision: String(result.undo.revision),
          }}
          pendingLabel={copy.pending}
          undoLabel={copy.undo}
          dismissLabel={copy.dismiss}
        />
      ) : null}
      {result && !result.ok ? (
        <FormStatus tone="danger">{copy.errors[result.reason]}</FormStatus>
      ) : null}
      {children}
    </Context.Provider>
  );
}

export function useConservationActions() {
  const context = useContext(Context);
  if (!context) throw new Error("Conservation actions require their departure provider");
  return context;
}
