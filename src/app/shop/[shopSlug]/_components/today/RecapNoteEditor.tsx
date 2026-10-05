import Image from "next/image";
import { ImageUploadTile } from "@/components/ImageUploadTile";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { Field, FormStatus, textareaClassFor } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { GroupLabel, ledgerKindColumnClass } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { RecapSendControl } from "./RecapSendControl";

/** Thumbnails, not panels: a recap's photos are checked at a glance, not studied. */
const RECAP_GALLERY_CLASS = "mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6";

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
      {/* Only for a recap that already went out: the summary hides when open,
          and nothing below says it went. A recap still waiting to send has
          its own line in the footer instead, with the live countdown. */}
      {recapLocked ? <p className="mt-2 max-w-2xl text-sm text-muted">{statusSummary}</p> : null}

      {/* **Compose, then send** (2026-10-05). The open recap reads top to
          bottom in the order a crew makes it: the note, the photos, and last
          the line that says when it goes out with the two controls that
          change that. It used to open on "Recap sending" and its buttons,
          above an unlabelled textarea, so the first thing under the word
          "Recap" was a choice about a message nobody had written yet. */}
      <form action={action} className="mt-3">
        <Field label={t("trips.recapNote.heading")}>
          <textarea
            name="recapShoutout"
            rows={3}
            maxLength={400}
            defaultValue={shoutout ?? ""}
            disabled={recapLocked}
            placeholder={t("trips.recapNote.placeholder")}
            className={textareaClassFor(3)}
          />
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-3">
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

      {/* The crew's photos, then the divers' own. Tiles are a gallery's
          thumbnails, six to a row on a desk, so an empty gallery is one small
          dashed tile rather than a 220px box. A count only once there is
          something to count. */}
      {uploadCrewPhotoAction && deleteCrewPhotoAction && (crewPhotos.length > 0 || !recapLocked) ? (
        <section className="mt-6">
          <GroupLabel as="h4" meta={crewPhotos.length > 0 ? crewPhotos.length : undefined}>
            {t("closeout.crewPhotos.heading")}
          </GroupLabel>
          <p className="mt-1 text-sm text-muted">{t("closeout.crewPhotos.description")}</p>
          {/* The add control is the grid's next cell, so an empty gallery is one
              dashed tile and a full one ends where the next photo will land. */}
          <ul className={RECAP_GALLERY_CLASS}>
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
                    sizes="200px"
                    className="object-cover"
                  />
                </div>
                {!recapLocked ? (
                  <form action={deleteCrewPhotoAction} className="flex justify-end px-1 py-1">
                    <input type="hidden" name="photoId" value={photo.id} />
                    <InlineConfirm
                      triggerLabel={t("closeout.crewPhotos.remove")}
                      triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm" })}
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
              </li>
            ))}
            {!recapLocked ? (
              <li>
                <form action={uploadCrewPhotoAction}>
                  <ImageUploadTile
                    id={crewPhotoInputId}
                    name="crewPhoto"
                    copy={{
                      add: t("closeout.crewPhotos.add"),
                      adding: t("closeout.crewPhotos.adding"),
                      wrongTypeSuffix: t("shared.imageInput.wrongTypeSuffix"),
                      tooBigSuffix: t("shared.imageInput.tooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                    }}
                  />
                </form>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {photos.length > 0 ? (
        <section className="mt-6">
          <GroupLabel as="h4" meta={photos.length}>
            {t("trips.recapPhotos.heading")}
          </GroupLabel>
          <p className="mt-1 text-sm text-muted">{t("trips.recapPhotos.description")}</p>
          <ul className={RECAP_GALLERY_CLASS}>
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
                    sizes="200px"
                    className="object-cover"
                  />
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1">
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
        </section>
      ) : null}

      {/* Last, the send line: when it goes and the two controls that change
          that, under one hairline like a form's own actions. */}
      {!recapLocked &&
      recapSendAction &&
      toggleRecapAutoSendPauseAction &&
      tripId &&
      recapNowMs !== undefined ? (
        <div className="mt-6 border-t border-border pt-2">
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
    </details>
  );
}
