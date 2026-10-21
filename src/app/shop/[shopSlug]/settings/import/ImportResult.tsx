import Link from "next/link";
import { ShopNotice } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { fill, pluralForm } from "@/i18n/fill";
import { cachedListFormat } from "@/lib/intl-cache";
import type { ImportActionState } from "./actions";
import type { ImportWizardCopy } from "./import-wizard-copy";

/** What an import did, in the staffer's words, once the action has answered. */
export function ImportResult({
  state,
  copy,
  locale,
  diversHref,
}: {
  state: Extract<ImportActionState, { status: "done" }>;
  copy: ImportWizardCopy;
  locale: string;
  diversHref: string;
}) {
  return (
    <div className="mt-6">
      <ShopNotice tone="success" persistent>
        <p className="font-medium">
          {/* Two counts, so two pairs and a template holding only their
                  order — see the same shape on the departure board's boarding
                  line (issue #778). */}
          {fill(copy.result.summary, {
            addedPart: fill(
              pluralForm(state.summary.peopleCreated, {
                one: copy.result.summaryAddedOne,
                other: copy.result.summaryAddedOther,
              }),
              { added: state.summary.peopleCreated },
            ),
            updatedPart: fill(
              pluralForm(state.summary.peopleUpdated, {
                one: copy.result.summaryUpdatedOne,
                other: copy.result.summaryUpdatedOther,
              }),
              { updated: state.summary.peopleUpdated },
            ),
          })}
        </p>
        <p className="mt-1 text-sm">
          {/* `{cards}` is a *formatted list* ("3 certifications and 1
                  nitrox"), not a count — so the sentence around it agrees with
                  the total across the three, which is the number a Spanish
                  reader hears. At a total of one the list is a single singular
                  phrase and the sentence has to be singular with it. */}
          {fill(
            pluralForm(
              state.summary.cardsAdded + state.summary.specialtyAdded + state.summary.nitroxAdded,
              { one: copy.result.cardsLineOne, other: copy.result.cardsLineOther },
            ),
            {
              cards: cachedListFormat(locale, { style: "long", type: "conjunction" }).format([
                fill(
                  pluralForm(state.summary.cardsAdded, {
                    one: copy.result.cardsCertificationsOne,
                    other: copy.result.cardsCertificationsOther,
                  }),
                  { count: state.summary.cardsAdded },
                ),
                fill(
                  pluralForm(state.summary.specialtyAdded, {
                    one: copy.result.cardsSpecialtyOne,
                    other: copy.result.cardsSpecialtyOther,
                  }),
                  { count: state.summary.specialtyAdded },
                ),
                fill(
                  pluralForm(state.summary.nitroxAdded, {
                    one: copy.result.cardsNitroxOne,
                    other: copy.result.cardsNitroxOther,
                  }),
                  { count: state.summary.nitroxAdded },
                ),
              ]),
            },
          )}
          {state.summary.rowsMerged > 0
            ? fill(copy.result.rowsMergedNote, { count: state.summary.rowsMerged })
            : ""}
          {state.summary.cardsSkippedExisting +
            state.summary.specialtySkippedExisting +
            state.summary.nitroxSkippedExisting >
          0
            ? fill(copy.result.cardsSkippedNote, {
                count:
                  state.summary.cardsSkippedExisting +
                  state.summary.specialtySkippedExisting +
                  state.summary.nitroxSkippedExisting,
              })
            : ""}
          {state.summary.rowsSkipped > 0
            ? fill(copy.result.rowsSkippedNote, { count: state.summary.rowsSkipped })
            : ""}
        </p>
        {/* Never folded into "already on file": that number belongs to a
                different diver, so nothing was written for this one. */}
        {state.summary.cardsHeldByAnotherDiver > 0 ? (
          <p className="mt-1 text-sm">
            {fill(copy.result.cardsHeldByAnother, {
              count: state.summary.cardsHeldByAnotherDiver,
            })}
          </p>
        ) : null}
        {state.summary.specialtyAdded > 0 ? (
          <p className="mt-1 text-sm">{copy.result.specialtyGateNote}</p>
        ) : null}
        {state.summary.waiversAdded +
          state.summary.waiversSkippedExisting +
          state.summary.waiversSkippedNoTemplate >
        0 ? (
          <p className="mt-1 text-sm">
            {fill(
              pluralForm(state.summary.waiversAdded, {
                one: copy.result.waiversLineOne,
                other: copy.result.waiversLineOther,
              }),
              { count: state.summary.waiversAdded },
            )}
            {state.summary.waiversSkippedExisting > 0
              ? fill(copy.result.waiversSkippedExistingNote, {
                  count: state.summary.waiversSkippedExisting,
                })
              : ""}
            {state.summary.waiversSkippedNoTemplate > 0
              ? fill(
                  pluralForm(state.summary.waiversSkippedNoTemplate, {
                    one: copy.result.waiversSkippedNoTemplateNoteOne,
                    other: copy.result.waiversSkippedNoTemplateNoteOther,
                  }),
                  { count: state.summary.waiversSkippedNoTemplate },
                )
              : ""}
            {state.summary.waiverDocumentsFailed > 0
              ? fill(copy.result.waiverDocumentsFailedNote, {
                  count: state.summary.waiverDocumentsFailed,
                })
              : ""}
          </p>
        ) : null}
        {state.summary.visitsAdded + state.summary.visitsSkippedExisting > 0 ? (
          <p className="mt-1 text-sm">
            {fill(
              pluralForm(state.summary.visitsAdded, {
                one: copy.result.visitsLineOne,
                other: copy.result.visitsLineOther,
              }),
              { count: state.summary.visitsAdded },
            )}
            {state.summary.visitsSkippedExisting > 0
              ? fill(copy.result.visitsSkippedNote, {
                  count: state.summary.visitsSkippedExisting,
                })
              : ""}
          </p>
        ) : null}
        {state.summary.paymentHistoryAdded + state.summary.paymentHistorySkippedExisting > 0 ? (
          <p className="mt-1 text-sm">
            {fill(
              pluralForm(state.summary.paymentHistoryAdded, {
                one: copy.result.paymentHistoryLineOne,
                other: copy.result.paymentHistoryLineOther,
              }),
              { count: state.summary.paymentHistoryAdded },
            )}
            {state.summary.paymentHistorySkippedExisting > 0
              ? fill(copy.result.paymentHistorySkippedNote, {
                  count: state.summary.paymentHistorySkippedExisting,
                })
              : ""}
            {state.summary.receiptDocumentsFailed > 0
              ? fill(copy.result.receiptDocumentsFailedNote, {
                  count: state.summary.receiptDocumentsFailed,
                })
              : ""}
          </p>
        ) : null}
        {state.summary.notesAdded > 0 ? (
          <p className="mt-1 text-sm">
            {fill(
              pluralForm(state.summary.notesAdded, {
                one: copy.result.notesLineOne,
                other: copy.result.notesLineOther,
              }),
              { count: state.summary.notesAdded },
            )}
          </p>
        ) : null}
        {/* Counted here because the per-row warning lives in the preview,
                and a shop importing four hundred rows will not catch twelve of
                them there — then taps through, and until issue #1801 nothing
                held the value at all. */}
        {state.summary.sizesDeclined > 0 ? (
          <p className="mt-1 text-sm">
            {fill(
              pluralForm(state.summary.sizesDeclined, {
                one: copy.result.sizesDeclinedLineOne,
                other: copy.result.sizesDeclinedLineOther,
              }),
              { count: state.summary.sizesDeclined },
            )}
          </p>
        ) : null}
        <Link
          href={diversHref}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          {copy.result.seeRoster}
        </Link>
      </ShopNotice>
    </div>
  );
}
