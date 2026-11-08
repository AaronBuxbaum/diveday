import Link from "next/link";
import { KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { keptTypedScope } from "@/components/kept-typed-scope";
import { SubmitButton } from "@/components/SubmitButton";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
  textareaClassFor,
} from "@/components/ui/form";
import { LedgerRow } from "@/components/ui/ledger";
import type { ShopSurface } from "@/features/session";
import { getWorkOrderNewPage } from "@/features/work-order-new-page";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { ADD_ONE, ADD_PARAM, addPanelHref } from "@/lib/add-panel";
import { GEAR_KIND_ORDER } from "@/lib/gear";
import { noticeFromParam } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { WORK_ORDER_TEXT_LIMITS } from "@/lib/work-orders";
import { NEW_ORDER_NOTICES, type NewOrderNoticeField } from "../_lib/new-order-notices";
import { addCustomerGearItemAction, createWorkOrderAction } from "../actions";
import { pieceDueLine } from "./piece-dates";

/** What the bench's URL carries into its add panel. */
export type NewWorkOrderSearch = {
  notice?: string;
  diverq?: string;
  personId?: string;
  unitId?: string;
};

/** The panel's own URL keys, which closing it drops. */
export const NEW_WORK_ORDER_KEYS = ["diverq", "personId", "unitId"] as const;

/**
 * **Opening a ticket, in the order a counter does it** (ADR
 * 20261008-gear-work-orders): whose gear, which pieces, then the job. The
 * bench's add panel (`/gear/work-orders?add=1`).
 *
 * Server-fed and URL-driven, like the returning-diver picker it borrows
 * (`PersonSearchForm`): the chosen customer is `?personId=`, a bench ticket on
 * the shop's own unit is `?unitId=`, and a piece added mid-form comes back to
 * the same URL with the piece on file. No client state, so the form survives a
 * reload and photographs the same way twice.
 *
 * A subject the URL names but this shop does not have (or two at once, which
 * `work_orders_one_subject` forbids) is no subject: the panel asks whose gear
 * it is again rather than refusing the bench around it.
 */
export async function NewWorkOrderPanel({
  surface: { db, shop, session },
  shopSlug,
  board,
  search,
  t,
  locale,
}: {
  surface: ShopSurface;
  shopSlug: string;
  board: string;
  search: NewWorkOrderSearch;
  t: StaffTranslator;
  locale: string;
}) {
  const askedPerson = search.personId ? uuidParam(search.personId) : undefined;
  const askedUnit = search.unitId ? uuidParam(search.unitId) : undefined;
  const query = search.diverq?.trim() ?? "";
  const { customer, personId, pieces, candidates, units, staff, chosenUnit } =
    await getWorkOrderNewPage(db, shop.id, { personId: askedPerson, unitId: askedUnit, query });

  const notice = noticeFromParam(search.notice, NEW_ORDER_NOTICES);
  const noticeKey = notice?.messageKey;
  // A refusal says itself beside the box it is about (fifth loop, item 14);
  // the foot keeps the ones no single box owns.
  const fieldError = (field: NewOrderNoticeField) =>
    notice?.field === field && noticeKey ? t(noticeKey) : undefined;
  const refused = noticeKey != null && search.notice !== "piece-added";
  const subjectName = customer?.person.fullName ?? chosenUnit?.label;

  return (
    <div className="space-y-10">
      {subjectName ? (
        <SectionCard title={t("workOrders.new.customerHeading")} padding="lg">
          <p className="text-lg">{subjectName}</p>
          <p className="mt-3">
            <Link
              href={addPanelHref(board)}
              className={`${tapTargetLinkClass} font-medium text-primary text-sm hover:underline`}
            >
              {t("workOrders.new.chooseAgain")}
            </Link>
          </p>
        </SectionCard>
      ) : (
        <SectionCard title={t("workOrders.new.customerHeading")} padding="lg">
          <PersonSearchForm
            query={query}
            hiddenFields={{ [ADD_PARAM]: ADD_ONE }}
            label={t("workOrders.new.findLabel")}
            placeholder={t("workOrders.new.findPlaceholder")}
          />
          {query ? (
            candidates.length > 0 ? (
              <ul className="mt-4">
                {candidates.map((candidate) => (
                  <LedgerRow
                    key={candidate.id}
                    href={addPanelHref(board, ADD_ONE, { personId: candidate.id })}
                    linkLabel={candidate.fullName}
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium">{candidate.fullName}</span>
                      <span className="text-muted text-xs">
                        {[
                          candidate.email,
                          candidate.pieceCount > 0
                            ? t("workOrders.board.pieces", { count: candidate.pieceCount })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </LedgerRow>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-muted text-sm">{t("workOrders.new.noMatches")}</p>
            )
          ) : null}

          {units.length > 0 ? (
            <form className="mt-8" method="get">
              <input type="hidden" name={ADD_PARAM} value={ADD_ONE} />
              <FieldGrid columns={2}>
                <Field label={t("workOrders.new.unitHeading")} htmlFor="work-order-unit">
                  <select id="work-order-unit" name="unitId" className={controlClass}>
                    {units.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label} · {gearItemKindLabel(t, row.kind)}
                      </option>
                    ))}
                  </select>
                </Field>
                <FieldActions>
                  <button type="submit" className={buttonClass({ variant: "secondary" })}>
                    {t("workOrders.new.unitSubmit")}
                  </button>
                </FieldActions>
              </FieldGrid>
            </form>
          ) : null}
        </SectionCard>
      )}

      {personId ? (
        <SectionCard title={t("workOrders.new.piecesHeading")} padding="lg">
          {pieces.length === 0 ? (
            <p className="text-muted text-sm">{t("workOrders.new.piecesEmpty")}</p>
          ) : null}
          <AddPieceForm
            personId={personId}
            t={t}
            status={search.notice === "piece-added" ? t("workOrders.notice.pieceAdded") : null}
          />
        </SectionCard>
      ) : null}

      {personId || chosenUnit ? (
        <SectionCard title={t("workOrders.new.jobHeading")} padding="lg">
          <FieldGrid as="form" action={createWorkOrderAction} columns={2}>
            {/* The customer's paragraph survives a refused date. */}
            <KeepTypedOnRefusal
              form="work-order-new"
              scope={keptTypedScope(shopSlug, session.user.personId)}
              restore={refused}
            />
            {personId ? <input type="hidden" name="personId" value={personId} /> : null}
            {chosenUnit ? <input type="hidden" name="gearItemId" value={chosenUnit.id} /> : null}

            {personId && pieces.length > 0 ? (
              <ChoiceFieldset
                legend={t("workOrders.new.piecesHeading")}
                className="col-span-full"
                bodyClassName="grid gap-1"
              >
                {pieces.map((piece) => {
                  const dates = pieceDueLine(piece, locale, t);
                  return (
                    <ChoiceRow
                      key={piece.id}
                      type="checkbox"
                      name="customerGearItemIds"
                      value={piece.id}
                    >
                      <span className="font-medium">{gearItemKindLabel(t, piece.kind)}</span>
                      {piece.brandModel ? (
                        <span className="text-muted"> · {piece.brandModel}</span>
                      ) : null}
                      {piece.serialNumber ? (
                        <span className="text-muted"> · {piece.serialNumber}</span>
                      ) : null}
                      {dates.length > 0 ? (
                        <span className="block text-muted text-xs">{dates.join(" · ")}</span>
                      ) : null}
                    </ChoiceRow>
                  );
                })}
              </ChoiceFieldset>
            ) : null}

            <Field
              label={t(
                chosenUnit
                  ? "workOrders.form.reportedProblemUnit"
                  : "workOrders.form.reportedProblem",
              )}
              htmlFor="reported-problem"
              required
              className="col-span-full"
              error={fieldError("reported-problem")}
            >
              <textarea
                id="reported-problem"
                name="reportedProblem"
                rows={3}
                required
                maxLength={WORK_ORDER_TEXT_LIMITS.reportedProblem}
                placeholder={t("workOrders.form.reportedProblemPlaceholder")}
                className={textareaClassFor(3)}
              />
            </Field>

            <Field
              label={t("workOrders.form.promisedOn")}
              hint={t("workOrders.form.optionalHint")}
              htmlFor="promised-on"
              error={fieldError("promised-on")}
            >
              <DateField id="promised-on" name="promisedOn" />
            </Field>

            <Field
              label={t("workOrders.form.technician")}
              hint={t("workOrders.form.optionalHint")}
              htmlFor="technician"
              error={fieldError("technician")}
            >
              <select id="technician" name="technicianPersonId" className={controlClass}>
                <option value="">{t("workOrders.form.technicianNone")}</option>
                {staff.map((member) => (
                  <option key={member.person.id} value={member.person.id}>
                    {member.person.fullName}
                  </option>
                ))}
              </select>
            </Field>

            <FieldActions>
              <SubmitButton pendingLabel={t("words.busy.opening")} className={buttonClass()}>
                {t("workOrders.new.submit")}
              </SubmitButton>
              {refused && !notice?.field ? (
                <FormStatus tone="danger">{t(noticeKey)}</FormStatus>
              ) : null}
            </FieldActions>
          </FieldGrid>
          {refused && notice?.field ? (
            <FieldErrorFocus key={search.notice} field={notice.field} />
          ) : null}
        </SectionCard>
      ) : null}
    </div>
  );
}

/** Record a piece the diver brought in and nobody had written down yet. */
function AddPieceForm({
  personId,
  t,
  status,
}: {
  personId: string;
  t: StaffTranslator;
  status: string | null;
}) {
  return (
    <CompactDisclosureRow
      id="add-piece"
      label={t("workOrders.new.addPieceHeading")}
      className="mt-4"
      // Open when this form has an outcome to show: the save redirects and the
      // page re-renders with the disclosure shut, so the "On the record." it
      // earned would otherwise sit inside a closed box (the call
      // `GearAndSizes` documents at length). `undefined` on every other
      // render, never `false`, or the reader's own tap cannot open it.
      open={status ? true : undefined}
    >
      <FieldGrid as="form" action={addCustomerGearItemAction} columns={2} className="mt-4">
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="returnTo" value="add" />
        <Field label={t("workOrders.form.kind")} htmlFor="piece-kind" required>
          <select id="piece-kind" name="kind" className={controlClass} required>
            {GEAR_KIND_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {gearItemKindLabel(t, kind)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("workOrders.form.brandModel")}
          hint={t("workOrders.form.optionalHint")}
          htmlFor="piece-brand"
        >
          <input
            id="piece-brand"
            name="brandModel"
            maxLength={WORK_ORDER_TEXT_LIMITS.brandModel}
            placeholder={t("workOrders.form.brandModelPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field
          label={t("workOrders.form.serialNumber")}
          hint={t("workOrders.form.optionalHint")}
          htmlFor="piece-serial"
        >
          <input
            id="piece-serial"
            name="serialNumber"
            maxLength={WORK_ORDER_TEXT_LIMITS.serialNumber}
            className={controlClass}
          />
        </Field>
        <Field
          label={t("workOrders.form.note")}
          hint={t("workOrders.form.optionalHint")}
          htmlFor="piece-note"
          className="col-span-full"
        >
          <input
            id="piece-note"
            name="note"
            maxLength={WORK_ORDER_TEXT_LIMITS.itemNote}
            className={controlClass}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("words.busy.adding")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("workOrders.new.addPiece")}
          </SubmitButton>
          {status ? <FormStatus tone="success">{status}</FormStatus> : null}
        </FieldActions>
      </FieldGrid>
    </CompactDisclosureRow>
  );
}
