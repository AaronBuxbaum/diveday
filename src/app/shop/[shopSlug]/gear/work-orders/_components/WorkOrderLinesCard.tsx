import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import type { WorkOrderLine } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderLineKindLabel } from "@/i18n/work-order-labels";
import { formatMoneyCents } from "@/lib/format";
import { minorToMajor, type ShopCurrency } from "@/lib/money";
import {
  WORK_ORDER_TEXT_LIMITS,
  workOrderLineTotalCents,
  workOrderQuantityInput,
} from "@/lib/work-orders";
import { addWorkOrderLineAction } from "../actions";
import { WorkOrderLineMenu, type WorkOrderLineMenuCopy } from "./WorkOrderLineMenu";

/**
 * **Parts and labor, and what the job comes to** — the shop's working figures
 * while the gear is on the bench.
 *
 * A table to read, with each line's Edit and Delete behind its "⋯", and one
 * add row at the foot. The total sits in the card's header, in the shop's own
 * currency, and no money from here reaches the claim tag: a figure on a
 * printed tag on the way in is a price promise nobody made.
 *
 * Not the `Table` shell: its scroll region clips, and a row's menu has to float
 * over the rows below it. Below `sm` the quantity and price each fold under
 * the description, the way the orders index folds its columns.
 *
 * Nothing here charges anybody. Billing is orders and Stripe; a ticket's lines
 * are what the counter reads out when the owner comes to collect.
 */
export function WorkOrderLinesCard({
  workOrderId,
  lines,
  totalCents,
  readOnly,
  currency,
  locale,
  t,
}: {
  workOrderId: string;
  lines: WorkOrderLine[];
  totalCents: number;
  /** A deleted ticket: the figures stay readable, the forms go away. */
  readOnly: boolean;
  currency: ShopCurrency;
  locale: string;
  t: StaffTranslator;
}) {
  const money = (cents: number) => formatMoneyCents(cents, currency, locale);
  const copy: WorkOrderLineMenuCopy = {
    edit: t("workOrders.detail.editLine"),
    delete: t("workOrders.detail.deleteLine"),
    deleting: t("workOrders.detail.deletingLine"),
    save: t("workOrders.form.save"),
    saving: t("workOrders.form.saving"),
    kind: t("workOrders.form.kind"),
    part: workOrderLineKindLabel(t, "part"),
    labor: workOrderLineKindLabel(t, "labor"),
    description: t("workOrders.form.description"),
    quantity: t("workOrders.form.quantity"),
    unitAmount: t("workOrders.form.unitAmount"),
  };

  return (
    <SectionCard
      title={t("workOrders.detail.linesHeading")}
      padding="lg"
      actions={
        <span className="font-medium tabular-nums">
          {t("workOrders.detail.total")}: {money(totalCents)}
        </span>
      }
    >
      {lines.length === 0 ? (
        <p className="text-muted text-sm">{t("workOrders.detail.linesEmpty")}</p>
      ) : (
        // Pulled out by the cells' own inset, so a row's first word sits on
        // the card title's edge at every width (`CELL_EDGE` steps out at sm).
        <table
          className="-mx-4 w-[calc(100%+2rem)] text-sm sm:-mx-5 sm:w-[calc(100%+2.5rem)]"
          style={{ tableLayout: "fixed" }}
        >
          <THead>
            <Th hideBelow="sm" width="6rem">
              {t("workOrders.form.kind")}
            </Th>
            <Th>{t("workOrders.form.description")}</Th>
            <Th numeric hideBelow="sm" width="6rem">
              {t("workOrders.form.quantity")}
            </Th>
            <Th numeric hideBelow="sm" width="8rem">
              {t("workOrders.form.unitAmount")}
            </Th>
            <Th numeric width="8rem">
              {t("workOrders.detail.lineTotal")}
            </Th>
            {readOnly ? null : (
              <Th className="w-16">
                <span className="sr-only">{t("workOrders.detail.lineActions")}</span>
              </Th>
            )}
          </THead>
          <TBody>
            {lines.map((line) => (
              <Tr key={line.id}>
                <Td hideBelow="sm">{workOrderLineKindLabel(t, line.kind)}</Td>
                <Td className="break-words">
                  {line.description}
                  <span className="mt-1 block text-muted text-xs tabular-nums sm:hidden">
                    {t("workOrders.detail.lineFold", {
                      kind: workOrderLineKindLabel(t, line.kind),
                      quantity: workOrderQuantityInput(line.quantityHundredths),
                      price: money(line.unitAmountCents),
                    })}
                  </span>
                </Td>
                <Td numeric hideBelow="sm">
                  {workOrderQuantityInput(line.quantityHundredths)}
                </Td>
                <Td numeric hideBelow="sm">
                  {money(line.unitAmountCents)}
                </Td>
                <Td numeric>{money(workOrderLineTotalCents(line))}</Td>
                {readOnly ? null : (
                  <Td clip={false} align="middle" className="py-1">
                    <div className="flex justify-end">
                      <WorkOrderLineMenu
                        workOrderId={workOrderId}
                        line={{
                          id: line.id,
                          kind: line.kind,
                          description: line.description,
                          quantity: workOrderQuantityInput(line.quantityHundredths),
                          unitAmount: String(minorToMajor(line.unitAmountCents, currency)),
                        }}
                        label={t("workOrders.detail.lineMenu", { description: line.description })}
                        maxDescription={WORK_ORDER_TEXT_LIMITS.lineDescription}
                        copy={copy}
                      />
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </table>
      )}

      {readOnly ? null : (
        <FieldGrid
          as="form"
          action={addWorkOrderLineAction}
          columns={4}
          className="mt-6 border-border border-t pt-6"
        >
          <input type="hidden" name="workOrderId" value={workOrderId} />
          <Field label={t("workOrders.form.kind")} htmlFor="new-line-kind">
            <select id="new-line-kind" name="kind" className={controlClass}>
              <option value="part">{workOrderLineKindLabel(t, "part")}</option>
              <option value="labor">{workOrderLineKindLabel(t, "labor")}</option>
            </select>
          </Field>
          <Field label={t("workOrders.form.description")} htmlFor="new-line-description" required>
            <input
              id="new-line-description"
              name="description"
              required
              maxLength={WORK_ORDER_TEXT_LIMITS.lineDescription}
              placeholder={t("workOrders.form.descriptionPlaceholder")}
              className={controlClass}
            />
          </Field>
          <Field label={t("workOrders.form.quantity")} htmlFor="new-line-quantity" required>
            <input
              id="new-line-quantity"
              name="quantity"
              required
              inputMode="decimal"
              defaultValue="1"
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field label={t("workOrders.form.unitAmount")} htmlFor="new-line-amount" required>
            <input
              id="new-line-amount"
              name="unitAmount"
              required
              inputMode="decimal"
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("workOrders.detail.adding")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("workOrders.detail.addLine")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      )}
    </SectionCard>
  );
}
