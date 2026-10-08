import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
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
import {
  addWorkOrderLineAction,
  deleteWorkOrderLineAction,
  updateWorkOrderLineAction,
} from "../actions";

/**
 * **Parts and labor, and what the job comes to** — the shop's working figures
 * while the gear is on the bench.
 *
 * Each line is its own small form, because that is how a technician works: a
 * price corrected after the kit is opened, a quantity that turns out to be one
 * and a half hours. The running total sits in the card's action row, in the
 * shop's own currency, and no money from here reaches the claim tag: a figure
 * on a printed tag on the way in is a price promise nobody made.
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
  return (
    <SectionCard
      title={t("workOrders.detail.linesHeading")}
      padding="lg"
      actions={
        <span className="font-medium tabular-nums">
          {t("workOrders.detail.total")}: {formatMoneyCents(totalCents, currency, locale)}
        </span>
      }
    >
      {lines.length === 0 ? (
        <p className="text-muted text-sm">{t("workOrders.detail.linesEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {lines.map((line) => (
            <li key={line.id}>
              {readOnly ? (
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span>
                    {workOrderLineKindLabel(t, line.kind)} · {line.description}
                  </span>
                  <span className="text-muted tabular-nums">
                    {formatMoneyCents(workOrderLineTotalCents(line), currency, locale)}
                  </span>
                </div>
              ) : (
                <>
                  <FieldGrid as="form" action={updateWorkOrderLineAction} columns={4}>
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="workOrderLineId" value={line.id} />
                    <Field label={t("workOrders.form.kind")} htmlFor={`line-kind-${line.id}`}>
                      <select
                        id={`line-kind-${line.id}`}
                        name="kind"
                        defaultValue={line.kind}
                        className={controlClass}
                      >
                        <option value="part">{workOrderLineKindLabel(t, "part")}</option>
                        <option value="labor">{workOrderLineKindLabel(t, "labor")}</option>
                      </select>
                    </Field>
                    <Field
                      label={t("workOrders.form.description")}
                      htmlFor={`line-description-${line.id}`}
                      required
                    >
                      <input
                        id={`line-description-${line.id}`}
                        name="description"
                        required
                        defaultValue={line.description}
                        maxLength={WORK_ORDER_TEXT_LIMITS.lineDescription}
                        className={controlClass}
                      />
                    </Field>
                    <Field
                      label={t("workOrders.form.quantity")}
                      htmlFor={`line-quantity-${line.id}`}
                      required
                    >
                      <input
                        id={`line-quantity-${line.id}`}
                        name="quantity"
                        required
                        inputMode="decimal"
                        defaultValue={workOrderQuantityInput(line.quantityHundredths)}
                        className={`${controlClass} tabular-nums`}
                      />
                    </Field>
                    <Field
                      label={t("workOrders.form.unitAmount")}
                      htmlFor={`line-amount-${line.id}`}
                      required
                    >
                      <input
                        id={`line-amount-${line.id}`}
                        name="unitAmount"
                        required
                        inputMode="decimal"
                        defaultValue={minorToMajor(line.unitAmountCents, currency)}
                        className={`${controlClass} tabular-nums`}
                      />
                    </Field>
                    <FieldActions>
                      <SubmitButton
                        pendingLabel={t("workOrders.form.saving")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                        aria-label={t("workOrders.detail.saveLineFor", {
                          description: line.description,
                        })}
                      >
                        {t("workOrders.form.save")}
                      </SubmitButton>
                      <span className="text-muted text-sm tabular-nums">
                        {formatMoneyCents(workOrderLineTotalCents(line), currency, locale)}
                      </span>
                    </FieldActions>
                  </FieldGrid>
                  <form action={deleteWorkOrderLineAction} className="mt-2">
                    <input type="hidden" name="workOrderId" value={workOrderId} />
                    <input type="hidden" name="workOrderLineId" value={line.id} />
                    <SubmitButton
                      pendingLabel={t("workOrders.detail.deletingLine")}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                      aria-label={t("workOrders.detail.deleteLineFor", {
                        description: line.description,
                      })}
                    >
                      {t("workOrders.detail.deleteLine")}
                    </SubmitButton>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <FieldGrid
          as="form"
          action={addWorkOrderLineAction}
          columns={4}
          className="mt-8 border-border border-t pt-6"
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
