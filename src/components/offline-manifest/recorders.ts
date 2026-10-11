import type { Dispatch, SetStateAction } from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import type { ArrivalStatus } from "@/lib/arrival";
import { type RollCallCheckpoint, rollCallNoteAllowed } from "@/lib/manifests";
import {
  appendOfflineArrival,
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  OfflineManifestError,
} from "@/lib/offline-manifest-store";
import {
  latestOfflineArrival,
  latestOfflineChecklistCheck,
  type OfflineManifestEnvelope,
  type OfflineRollCallResult,
  offlineArrivalEvents,
} from "@/lib/offline-manifests";
import type { PreDepartureCheckStatus } from "@/lib/pre-departure-check";
import type { SavedCopyAction } from "./saved-copy";
import type { OfflineStatement } from "./shared";

/** The words for a tap the store refused, the same for all three taps. */
function refusalMessage(t: OfflineManifestTranslator, error: unknown): string {
  if (error instanceof OfflineManifestError) {
    return error.code === "expired"
      ? t("shared.offlineManifest.single.record.expiredCannotRecord")
      : error.code === "not_allowed"
        ? t("shared.offlineManifest.single.record.notAllowed")
        : t("shared.offlineManifest.single.record.unavailable");
  }
  return t("shared.offlineManifest.single.record.genericError");
}

/**
 * **The three taps that queue an event on this device** — a roll-call mark, a
 * checklist check and a counter arrival — over the one saved copy on screen.
 */
export function offlineRecorders({
  t,
  tripId,
  envelope,
  checkpoint,
  expired,
  noteDrafts,
  setNoteDrafts,
  setBusyBooking,
  setBusyChecklistItem,
  setBusyArrival,
  dispatchSaved,
  setMessage,
  reconcile,
}: {
  t: OfflineManifestTranslator;
  tripId: string;
  envelope: OfflineManifestEnvelope;
  checkpoint: RollCallCheckpoint;
  expired: boolean;
  noteDrafts: Record<string, string>;
  setNoteDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setBusyBooking: Dispatch<SetStateAction<string | null>>;
  setBusyChecklistItem: Dispatch<SetStateAction<string | null>>;
  setBusyArrival: Dispatch<SetStateAction<string | null>>;
  dispatchSaved: Dispatch<SavedCopyAction>;
  setMessage: Dispatch<SetStateAction<string>>;
  reconcile: () => Promise<void>;
}) {
  /**
   * Queue one result on this device, for a diver or a crew member. One
   * function, because everything a captain relies on here — the expiry stop
   * rule, the refusal wording, the immediate reconcile attempt — is the same
   * act on the same screen; only the subject differs, and it is passed
   * straight through to `appendOfflineRollCall`, which reads it exactly once
   * (`offlineRollCallSubject`).
   *
   * The busy key is whichever id was named: booking ids and person ids are
   * both uuids from disjoint tables, so one map of "which row is saving" is
   * unambiguous.
   */
  async function record(
    subject: { bookingId: string } | { crewPersonId: string },
    statement: OfflineStatement,
    /**
     * What stands at this row right now, so the device applies the *same*
     * rule the server does (`rollCallNoteAllowed`). Without it the shared
     * per-row draft would ride whichever control was tapped, including an
     * ordinary "aboard" — one surface writing observations onto the safety
     * trail that the other refuses is the divergence issue #1058 was
     * reacting to.
     */
    standing?: Pick<OfflineRollCallResult, "state" | "implied">,
  ) {
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    const subjectId = "bookingId" in subject ? subject.bookingId : subject.crewPersonId;
    const sentNote = rollCallNoteAllowed(checkpoint, statement.status, standing)
      ? noteDrafts[subjectId]?.trim() || undefined
      : undefined;
    setBusyBooking(subjectId);
    try {
      const next = await appendOfflineRollCall(tripId, {
        ...subject,
        ...statement,
        checkpoint,
        // The sentence rides the same queued event as the mark, so there is no
        // second write to lose offshore.
        note: sentNote,
      });
      // Cleared **only if it went**. A draft the rule refused stays in the box
      // rather than vanishing on a tap that did not carry it.
      if (sentNote) {
        setNoteDrafts((drafts) => {
          if (!(subjectId in drafts)) return drafts;
          const { [subjectId]: _sent, ...rest } = drafts;
          return rest;
        });
      }
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      if (navigator.onLine) await reconcile();
    } catch (error) {
      setMessage(refusalMessage(t, error));
    } finally {
      setBusyBooking(null);
    }
  }

  /**
   * The checklist's own tap, sibling to `record` above and deliberately
   * simpler: no checkpoint, no confirm-before-unsaying dialog (nothing here
   * is the missing-diver alarm that dialog exists to protect — see
   * `pre-departure-check.ts`), and its own busy key so a checklist tap can
   * never appear to disable a diver's row or vice versa.
   */
  async function recordChecklistCheck(checklistItemId: string, status: PreDepartureCheckStatus) {
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    setBusyChecklistItem(checklistItemId);
    try {
      const next = await appendOfflineChecklistCheck(tripId, {
        checklistItemId,
        status,
        note: null,
        retractsClientEventId:
          status === "cleared"
            ? latestOfflineChecklistCheck(
                envelope.snapshot,
                checklistItemId,
                envelope.checklistEvents,
              )?.clientEventId
            : undefined,
      });
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      if (navigator.onLine) await reconcile();
    } catch (error) {
      setMessage(refusalMessage(t, error));
    } finally {
      setBusyChecklistItem(null);
    }
  }

  /**
   * The counter's own tap (ADR 20260907-the-counter-survives-offline).
   *
   * Sibling to `record` and `recordChecklistCheck`, and it will never grow
   * into either: an arrival says a diver reached the desk, and there is no
   * status here that can say one is on the boat. `appendOfflineArrival` writes
   * to its own queue, which the sync route hands to the same two functions the
   * live counter calls.
   */
  async function recordArrival(bookingId: string, status: ArrivalStatus) {
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    setBusyArrival(bookingId);
    try {
      const next = await appendOfflineArrival(tripId, {
        bookingId,
        status,
        retractsClientEventId:
          status === "cleared"
            ? latestOfflineArrival(envelope.snapshot, bookingId, offlineArrivalEvents(envelope))
                ?.clientEventId
            : undefined,
      });
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      if (navigator.onLine) await reconcile();
    } catch (error) {
      setMessage(refusalMessage(t, error));
    } finally {
      setBusyArrival(null);
    }
  }

  return { record, recordChecklistCheck, recordArrival };
}
