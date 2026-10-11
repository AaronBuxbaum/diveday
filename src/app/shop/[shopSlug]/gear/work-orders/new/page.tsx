import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PersonSearchForm } from "@/components/seat-diver/PersonSearchForm";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
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
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getDiverProfile } from "@/db/divers";
import { listStaff } from "@/db/trips";
import { listBenchUnits, listCustomerGearItems, searchWorkOrderCustomers } from "@/db/work-orders";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { GEAR_KIND_ORDER } from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { WORK_ORDER_TEXT_LIMITS } from "@/lib/work-orders";
import { pieceDueLine } from "../_components/piece-dates";
import { addCustomerGearItemAction, createWorkOrderAction } from "../actions";

/** The refusals this form renders beside itself. */
const NOTICES: Record<string, StaffMessageKey> = {
  "empty-problem": "workOrders.notice.emptyProblem",
  "no-items": "workOrders.notice.noItems",
  "no-subject": "workOrders.notice.noSubject",
  "two-subjects": "workOrders.notice.twoSubjects",
  "invalid-date": "workOrders.notice.invalidDate",
  "not-found": "workOrders.notice.notFound",
  "unknown-technician": "workOrders.notice.unknownTechnician",
  invalid: "workOrders.notice.invalid",
  "piece-added": "workOrders.notice.pieceAdded",
};

export const instant = true;

export const metadata: Metadata = { title: "New work order — DiveDay" };

/**
 * **Opening a ticket, in the order a counter does it** (ADR
 * 20261008-gear-work-orders): whose gear, which pieces, then the job.
 *
 * Server-fed and URL-driven, like the returning-diver picker it borrows
 * (`PersonSearchForm`): the chosen customer is `?personId=`, a bench ticket on
 * the shop's own unit is `?unitId=`, and a piece added mid-form comes back to
 * the same URL with the piece on file. No client state, so the form survives a
 * reload and photographs the same way twice.
 */
export default async function NewWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; diverq?: string; personId?: string; unitId?: string }>;
}) {
  const { shopSlug } = await params;
  const search = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const board = shopPath(shopSlug, "gear", "work-orders");

  const personId = search.personId ? uuidParam(search.personId) : undefined;
  const unitId = search.unitId ? uuidParam(search.unitId) : undefined;
  // A URL naming both is a URL nobody can act on: the ticket's subject is one
  // or the other (`work_orders_one_subject`).
  if (personId && unitId) notFound();

  const query = search.diverq?.trim() ?? "";
  const [customer, pieces, candidates, units, staff] = await Promise.all([
    personId ? getDiverProfile(db, shop.id, personId) : null,
    personId ? listCustomerGearItems(db, shop.id, personId) : [],
    personId || unitId ? [] : searchWorkOrderCustomers(db, shop.id, query),
    personId ? [] : listBenchUnits(db, shop.id),
    listStaff(db, shop.id),
  ]);
  // A `?personId=` for somebody who is not this shop's diver resolves to
  // nothing rather than rendering a form that cannot save.
  if (personId && !customer) notFound();
  const unit = unitId ? units.find((row) => row.id === unitId) : undefined;
  const chosenUnit =
    unitId && !unit ? (await listBenchUnits(db, shop.id)).find((row) => row.id === unitId) : unit;
  if (unitId && !chosenUnit) notFound();

  const noticeKey = noticeFromParam(search.notice, NOTICES);
  const subjectName = customer?.person.fullName ?? chosenUnit?.label;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <EyebrowBackLink href={board}>{t("workOrders.title")}</EyebrowBackLink>
        <h1 className={`mt-1 ${SHELL_TITLE_CLASS}`}>{t("workOrders.new.title")}</h1>
      </header>

      <div className="mt-8 space-y-10">
        {subjectName ? (
          <SectionCard title={t("workOrders.new.customerHeading")} padding="lg">
            <p className="text-lg">{subjectName}</p>
            <p className="mt-3">
              <Link
                href={`${board}/new`}
                className="font-medium text-primary text-sm hover:underline"
              >
                {t("workOrders.new.chooseAgain")}
              </Link>
            </p>
          </SectionCard>
        ) : (
          <SectionCard title={t("workOrders.new.customerHeading")} padding="lg">
            <PersonSearchForm
              query={query}
              hiddenFields={{}}
              label={t("workOrders.new.findLabel")}
              placeholder={t("workOrders.new.findPlaceholder")}
            />
            {query ? (
              candidates.length > 0 ? (
                <ul className="mt-4">
                  {candidates.map((candidate) => (
                    <LedgerRow
                      key={candidate.id}
                      href={`${board}/new?personId=${candidate.id}`}
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
              >
                <DateField id="promised-on" name="promisedOn" />
              </Field>

              <Field
                label={t("workOrders.form.technician")}
                hint={t("workOrders.form.optionalHint")}
                htmlFor="technician"
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
                <SubmitButton pendingLabel={t("workOrders.new.pending")} className={buttonClass()}>
                  {t("workOrders.new.submit")}
                </SubmitButton>
                {noticeKey && search.notice !== "piece-added" ? (
                  <FormStatus tone="danger">{t(noticeKey)}</FormStatus>
                ) : null}
              </FieldActions>
            </FieldGrid>
          </SectionCard>
        ) : null}
      </div>
    </main>
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
    <details
      className="mt-4"
      // Open when this form has an outcome to show: the save redirects and the
      // page re-renders with the disclosure shut, so the "On the record." it
      // earned would otherwise sit inside a closed box (the call
      // `GearAndSizes` documents at length). `undefined` on every other
      // render, never `false`, or the reader's own tap cannot open it.
      open={status ? true : undefined}
    >
      <summary id="add-piece" className="cursor-pointer font-medium text-primary text-sm">
        {t("workOrders.new.addPieceHeading")}
      </summary>
      <FieldGrid as="form" action={addCustomerGearItemAction} columns={2} className="mt-4">
        <input type="hidden" name="personId" value={personId} />
        <input type="hidden" name="returnTo" value="new" />
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
            pendingLabel={t("workOrders.new.addingPiece")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("workOrders.new.addPiece")}
          </SubmitButton>
          {status ? <FormStatus tone="success">{status}</FormStatus> : null}
        </FieldActions>
      </FieldGrid>
    </details>
  );
}
