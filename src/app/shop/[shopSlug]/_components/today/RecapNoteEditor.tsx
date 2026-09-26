import Image from "next/image";
import { ImageFileInput } from "@/components/ImageFileInput";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FormStatus, textareaClassFor } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { GroupLabel, ledgerKindColumnClass } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { RecapSendControl } from "./RecapSendControl";

/**
 * The crew's post-trip note, written where the crew is standing when they still
 * remember the day: the shop home's evening reading, on the settled station of
 * the departure it belongs to (ADR 20260827-clearwater-surface-language,
 * decision 4 — the close-out page it used to live on folded into the home).
 *
 * The note rides out on every diver's recap, which the dedicated hourly scan
 * sends no earlier than four hours after the trip ends (`sendDueRecaps`,
 * src/db/recap.ts) — so the evening the boat came back is both the last moment
 * to add one and the only moment anyone can still name the highlight. It used
 * to live only on the trip's setup page and only *before* the trip, which is to
 * say it asked for the highlight of a day that had not happened.
 *
 * Deliberately a `<details>` rather than an always-open box: the spine is a
 * reconciliation ("did everyone come home?") and a column of open textareas
 * would bury the head counts. The note as written is the summary, so a station
 * that already has one says so without opening.
 *
 * Its own `<form>` is why it rides its station rather than sitting inside the
 * closing block: a form cannot nest in a form, and the closing act below must
 * survive a note being saved.
 */
export function RecapNoteEditor({
  action,
  shoutout,
  saved,
  t,
  photos = [],
  deletePhotoAction,
  crewPhotos = [],
  crewPhotoInputId = "crew-recap-photo",
  uploadCrewPhotoAction,
  deleteCrewPhotoAction,
  tripId,
  recapSendAction,
  toggleRecapAutoSendPauseAction,
  recapAutoSendAt,
  recapAutoSendAtLabel,
  recapAutoSendPaused = false,
  recapFailed = false,
  recapNowMs,
  recapSentAt,
  recapSentAtLabel,
  recapStatusSummary,
}: {
  action: (formData: FormData) => void;
  shoutout: string | null;
  /** True right after this row's own save, which is also what holds it open. */
  saved: boolean;
  t: StaffTranslator;
  photos?: {
    id: string;
    imageUrl: string;
    caption: string | null;
    diverName: string;
    bookingId: string;
  }[];
  deletePhotoAction?: (formData: FormData) => void;
  crewPhotos?: {
    id: string;
    imageUrl: string;
  }[];
  /** Unique when several returned departures render their own upload form. */
  crewPhotoInputId?: string;
  uploadCrewPhotoAction?: (formData: FormData) => void;
  deleteCrewPhotoAction?: (formData: FormData) => void;
  tripId?: string;
  recapSendAction?: (formData: FormData) => void;
  toggleRecapAutoSendPauseAction?: (formData: FormData) => void;
  recapAutoSendAt?: Date | null;
  recapAutoSendAtLabel?: string;
  recapAutoSendPaused?: boolean;
  recapFailed?: boolean;
  recapNowMs?: number;
  recapSentAt?: Date | null;
  recapSentAtLabel?: string;
  recapStatusSummary?: string;
}) {
  const recapLocked = Boolean(recapSentAt);
  const statusSummary =
    recapStatusSummary ??
    (recapLocked && recapSentAt && recapSentAtLabel
      ? t("closeout.recap.sent", { time: recapSentAtLabel })
      : t("trips.recapNote.description"));
  const recapSummary =
    recapStatusSummary ??
    (recapLocked && recapSentAt && recapSentAtLabel
      ? t("closeout.recap.sent", { time: recapSentAtLabel })
      : t("trips.recapNote.emptySummary"));
  return (
    // No rule of its own: the station that mounts this owns the hairline above
    // it (`ClosingStation`), because on a departure that also carries the
    // unsold-seats row a `border-t` here landed a second hairline twelve
    // pixels under that row's own closing one, with nothing at all between
    // them.
    <details open={saved} className="group/recap">
      {/* **The unsold-seats row's anatomy** (K-260), the `LedgerRow` with a
          kind that sits above this under the same rule: the word in the
          kind's column (`ledgerKindColumnClass`), the note a `gap-3` after it,
          on the edge that row's sentence starts on, and the caret at the row's
          end, where a door's glyph is. It led with the caret and set the note
          `gap-2` after the word, so "Recap" started 20px right of "Unsold
          seats" and its note 35px left of that row's sentence.

          Stacked below `sm` as a stacked `LedgerRow` is: the word and the
          caret on one line, the note full width beneath them (`order-last
          basis-full`). Inline at phone width the label and the note fought
          over ~340px and the heading broke across lines beside one line of
          note. `content-center` centres the lines in the 44px target.

          **From `sm`, closed, the target overhangs the card's foot** (K-453).
          There the summary is one 20px line in a 44px target and the last
          thing in the card, so 12px of target with nothing in it sat between
          the Recap line and the card's padding: 38px of card under the last
          ink against 28px over the first. `sm:-mb-3` takes that excess out of
          the flow and the target reaches into the padding (24px, room for it
          and the 5px ring); open, the form follows the summary and the margin
          goes. Below `sm` the stacked word and note fill the target. The
          excess is padding (`sm:py-3`), not the room round a centred line:
          until `md` the note may take two lines, and 40px of note centred in
          44 would have hung 10px of text into the card's padding. */}
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap content-center items-center gap-x-3 gap-y-0.5 text-sm [&::-webkit-details-marker]:hidden sm:-mb-3 sm:flex-nowrap sm:py-3 sm:group-open/recap:mb-0">
        <span className={`${ledgerKindColumnClass} shrink-0 font-medium`}>
          {t("closeout.recap.summaryHeading")}
        </span>
        {/* The note itself at rest — what a passing glance needs is "is there
            one, and does it still read right", not the form. Clamped so a
            long note ellipses instead of pushing the row wider than the card:
            one line from `md`, **two below it** (K-150), because the same
            span carries the status sentence, and its last words are when the
            recap goes ("…in about 3 hours."), which one 316px line cut off at
            390. From `sm` the note sits beside the kind's column, about
            W − 242px wide, and the es-ES sentence runs about 450px: one line
            holds it only from about 700px, so two lines run to `md`.
            Hidden once open: the body below says the same thing at least once
            already (the paragraph when the recap already went out, "Recap
            sending"'s own line otherwise), and a passing-glance summary has
            nothing left to add beside its own open form. */}
        <span className="min-w-0 text-muted group-open/recap:hidden max-sm:order-last max-sm:basis-full max-md:line-clamp-2 sm:flex-1 md:truncate">
          {recapSummary}
        </span>
        <DisclosureCaret className="ms-auto text-muted group-open/recap:rotate-90" />
      </summary>
      {/* Only for a recap that already went out: nothing below restates it in
          that case. A recap still waiting to send drops this paragraph
          entirely — "Recap sending" right underneath says the identical
          thing, with the live countdown and the controls to act on it. */}
      {recapLocked ? <p className="mt-2 max-w-2xl text-sm text-muted">{statusSummary}</p> : null}

      {!recapLocked &&
      recapSendAction &&
      toggleRecapAutoSendPauseAction &&
      tripId &&
      recapNowMs !== undefined ? (
        <div className="mt-4 border-t border-border pt-4">
          <GroupLabel as="h4">{t("closeout.recap.heading")}</GroupLabel>
          <RecapSendControl
            sendAction={recapSendAction}
            togglePauseAction={toggleRecapAutoSendPauseAction}
            tripId={tripId}
            autoSendAt={recapAutoSendAt ? recapAutoSendAt.toISOString() : null}
            autoSendAtLabel={recapAutoSendAtLabel}
            paused={recapAutoSendPaused}
            failed={recapFailed}
            nowMs={recapNowMs}
            copy={{
              waiting: t.raw("closeout.recap.waiting"),
              due: t("closeout.recap.due"),
              paused: t("closeout.recap.paused"),
              failed: t("closeout.recap.failed"),
              noScheduledReturn: t("closeout.recap.noScheduledReturn"),
              send: t("closeout.recap.send"),
              sending: t("closeout.recap.sending"),
              pause: t("closeout.recap.pause"),
              pausing: t("closeout.recap.pausing"),
              unpause: t("closeout.recap.unpause"),
              unpausing: t("closeout.recap.unpausing"),
              lessThanMinute: t("closeout.recap.lessThanMinute"),
            }}
          />
        </div>
      ) : null}

      <form action={action} className="mt-2 flex flex-col gap-3">
        <textarea
          name="recapShoutout"
          rows={3}
          maxLength={400}
          defaultValue={shoutout ?? ""}
          disabled={recapLocked}
          placeholder={t("trips.recapNote.placeholder")}
          aria-label={t("trips.recapNote.heading")}
          className={textareaClassFor(3)}
        />
        <div className="flex flex-wrap items-center gap-3">
          {!recapLocked ? (
            <SubmitButton
              pendingLabel={t("trips.recapNote.saving")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.recapNote.save")}
            </SubmitButton>
          ) : null}
          <FormStatus tone={saved ? "success" : undefined}>
            {saved ? t("trips.notices.recapNote") : null}
          </FormStatus>
        </div>
      </form>

      {photos.length > 0 ? (
        <div className="mt-4 border-t border-border pt-4">
          <GroupLabel as="h4">
            {t("trips.recapPhotos.heading")}{" "}
            <span className="font-normal tabular-nums">{photos.length}</span>
          </GroupLabel>
          <p className="mt-1 text-sm text-muted">{t("trips.recapPhotos.description")}</p>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo) => (
              <li
                key={photo.id}
                className={sectionCardClass({ padding: "none", className: "overflow-hidden" })}
              >
                <div className="relative aspect-square w-full">
                  <Image
                    src={photo.imageUrl}
                    alt={
                      photo.caption ??
                      t("trips.recapPhotos.photoFromAlt", { diverName: photo.diverName })
                    }
                    fill
                    sizes="288px"
                    className="object-cover"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{photo.diverName}</p>
                    {photo.caption ? (
                      <p className="truncate text-xs text-muted">{photo.caption}</p>
                    ) : null}
                  </div>
                  {!recapLocked && deletePhotoAction ? (
                    <form action={deletePhotoAction}>
                      <input type="hidden" name="photoId" value={photo.id} />
                      <InlineConfirm
                        triggerLabel={t("trips.recapPhotos.remove")}
                        triggerClassName={buttonClass({
                          variant: "danger-ghost",
                          size: "sm",
                          className: "shrink-0",
                        })}
                        confirmClassName={buttonClass({
                          variant: "danger-ghost",
                          size: "sm",
                          busy: true,
                        })}
                        message={t("trips.recapPhotos.confirmRemove")}
                        confirmLabel={t("trips.recapPhotos.removeConfirmButton")}
                        cancelLabel={t("trips.recapPhotos.removeCancel")}
                        pendingLabel={t("trips.recapPhotos.removing")}
                      />
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {uploadCrewPhotoAction && deleteCrewPhotoAction ? (
        <div className="mt-4 border-t border-border pt-4">
          <GroupLabel as="h4">
            {t("closeout.crewPhotos.heading")}{" "}
            <span className="font-normal tabular-nums">{crewPhotos.length}</span>
          </GroupLabel>
          <p className="mt-1 text-sm text-muted">{t("closeout.crewPhotos.description")}</p>

          {crewPhotos.length > 0 ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {crewPhotos.map((photo) => (
                <li
                  key={photo.id}
                  className={sectionCardClass({ padding: "none", className: "overflow-hidden" })}
                >
                  <div className="relative aspect-square w-full">
                    <Image
                      src={photo.imageUrl}
                      alt={t("closeout.crewPhotos.photoAlt")}
                      fill
                      sizes="288px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex justify-end px-2 py-1.5">
                    {!recapLocked ? (
                      <form action={deleteCrewPhotoAction}>
                        <input type="hidden" name="photoId" value={photo.id} />
                        <InlineConfirm
                          triggerLabel={t("closeout.crewPhotos.remove")}
                          triggerClassName={buttonClass({
                            variant: "danger-ghost",
                            size: "sm",
                          })}
                          confirmClassName={buttonClass({
                            variant: "danger-ghost",
                            size: "sm",
                            busy: true,
                          })}
                          message={t("closeout.crewPhotos.confirmRemove")}
                          confirmLabel={t("closeout.crewPhotos.removeConfirmButton")}
                          cancelLabel={t("closeout.crewPhotos.removeCancel")}
                          pendingLabel={t("closeout.crewPhotos.removing")}
                        />
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!recapLocked ? (
            <form action={uploadCrewPhotoAction} className="mt-3 flex flex-col gap-3">
              <label htmlFor={crewPhotoInputId} className="text-sm font-medium">
                {t("closeout.crewPhotos.add")}
              </label>
              <ImageFileInput
                id={crewPhotoInputId}
                name="crewPhoto"
                required
                copy={{
                  choose: t("shared.imageInput.choose"),
                  chooseAnother: t("shared.imageInput.chooseAnother"),
                  wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                  tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                }}
              />
              <div>
                <SubmitButton
                  pendingLabel={t("closeout.crewPhotos.adding")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("closeout.crewPhotos.upload")}
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
