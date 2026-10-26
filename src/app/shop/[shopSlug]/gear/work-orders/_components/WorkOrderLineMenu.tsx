// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { forgetKeptTyped, KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { RowMenu } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import { menuRowClass } from "@/components/ui/menu";
import { deleteWorkOrderLineAction, updateWorkOrderLineAction } from "../actions";
import { WorkOrderLineFields } from "./WorkOrderLineFields";

/** Every word the menu renders, translated on the server ahead of it. */
export type WorkOrderLineMenuCopy = {
  edit: string;
  delete: string;
  deleting: string;
  save: string;
  saving: string;
  kind: string;
  part: string;
  labor: string;
  description: string;
  quantity: string;
  unitAmount: string;
};

const MENU_ROW_CLASS = `${menuRowClass("quiet", { gutter: false })} whitespace-nowrap`;
const MENU_DANGER_CLASS = `${menuRowClass("danger", { gutter: false })} whitespace-nowrap`;

/**
 * A line's "⋯": Edit, which swaps the list for the line's own form in the same
 * panel, and Delete. The table stays a table to read; changing a figure is a
 * deliberate act rather than a row of open boxes.
 */
export function WorkOrderLineMenu({
  workOrderId,
  line,
  label,
  maxDescription,
  copy,
  scope,
  notice,
  refusal,
}: {
  workOrderId: string;
  line: {
    id: string;
    kind: "part" | "labor";
    description: string;
    quantity: string;
    unitAmount: string;
  };
  /** The "⋯" button's accessible name, naming the line. */
  label: string;
  maxDescription: number;
  copy: WorkOrderLineMenuCopy;
  scope: string;
  notice?: string;
  refusal?: { field: "description" | "quantity" | "unitAmount"; message: string };
}) {
  const [editing, setEditing] = useState(Boolean(refusal));
  const [open, setOpen] = useState(Boolean(refusal));
  useEffect(() => {
    if (refusal) {
      setEditing(true);
      setOpen(true);
    }
  }, [refusal]);
  useEffect(() => {
    if (notice === "line-saved") forgetKeptTyped("work-order-edit-line", scope);
  }, [notice, scope]);
  const id = (field: string) => `line-${field}-${line.id}`;
  return (
    <RowMenu
      label={label}
      open={open}
      onOpenChange={setOpen}
      panelClassName={editing ? "w-80" : "w-48"}
      onClosed={() => setEditing(false)}
    >
      {(close) =>
        editing ? (
          <form action={updateWorkOrderLineAction} className="p-3">
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input type="hidden" name="workOrderLineId" value={line.id} />
            <WorkOrderLineFields label={label} className="flex flex-col gap-3">
              <Field label={copy.kind} htmlFor={id("kind")}>
                <select
                  id={id("kind")}
                  name="kind"
                  defaultValue={line.kind}
                  className={controlClass}
                >
                  <option value="part">{copy.part}</option>
                  <option value="labor">{copy.labor}</option>
                </select>
              </Field>
              <Field
                label={copy.description}
                htmlFor={id("description")}
                required
                error={refusal?.field === "description" ? refusal.message : undefined}
              >
                <input
                  id={id("description")}
                  name="description"
                  required
                  defaultValue={line.description}
                  maxLength={maxDescription}
                  className={controlClass}
                />
              </Field>
              <div className="grid grid-cols-2 gap-x-4">
                <Field
                  label={copy.quantity}
                  htmlFor={id("quantity")}
                  required
                  error={refusal?.field === "quantity" ? refusal.message : undefined}
                >
                  <input
                    id={id("quantity")}
                    name="quantity"
                    required
                    inputMode="decimal"
                    defaultValue={line.quantity}
                    className={`${controlClass} tabular-nums`}
                  />
                </Field>
                <Field
                  label={copy.unitAmount}
                  htmlFor={id("amount")}
                  required
                  error={refusal?.field === "unitAmount" ? refusal.message : undefined}
                >
                  <input
                    id={id("amount")}
                    name="unitAmount"
                    required
                    inputMode="decimal"
                    defaultValue={line.unitAmount}
                    className={`${controlClass} tabular-nums`}
                  />
                </Field>
              </div>
              <SubmitButton
                pendingLabel={copy.saving}
                className={buttonClass({ variant: "secondary" })}
              >
                {copy.save}
              </SubmitButton>
            </WorkOrderLineFields>
            <KeepTypedOnRefusal
              form="work-order-edit-line"
              scope={scope}
              restore={Boolean(refusal)}
            />
            <EditLineOutcome notice={notice} scope={scope} close={close} />
          </form>
        ) : (
          <>
            <button type="button" className={MENU_ROW_CLASS} onClick={() => setEditing(true)}>
              {copy.edit}
            </button>
            <form action={deleteWorkOrderLineAction}>
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <input type="hidden" name="workOrderLineId" value={line.id} />
              <SubmitButton pendingLabel={copy.deleting} className={MENU_DANGER_CLASS}>
                {copy.delete}
              </SubmitButton>
            </form>
          </>
        )
      }
    </RowMenu>
  );
}

/** A preserved editor clears on completion; the parent effect covers redirect remounts. */
function EditLineOutcome({
  notice,
  scope,
  close,
}: {
  notice?: string;
  scope: string;
  close: () => void;
}) {
  const { pending } = useFormStatus();
  const submitted = useRef(false);
  useEffect(() => {
    if (pending) submitted.current = true;
    else if (submitted.current && notice === "line-saved") {
      forgetKeptTyped("work-order-edit-line", scope);
      close();
    }
  }, [notice, pending, scope, close]);
  return null;
}
