import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import type { MedicalAlertResult } from "@/components/MedicalAlertReveal";
import type { PrivateNoteAction } from "@/components/PrivateNoteForm";
import type { PrintedMedicalAlerts } from "@/db/medical-alerts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ManifestBuddyTeam, RollCallCheckpoint, TripManifest } from "@/lib/manifests";
import type { MissingDiverRowActions } from "./missing-diver-controls";
import type { PersonTrailEntry } from "./PersonSheet";
import type { ManifestNote } from "./StaffNotes";

/**
 * Everything the diver half of the head count is drawn from, as one object:
 * the page builds it once and `DiverRollCall` hands the same object to every
 * row, so a row's parts read the departure's facts by name rather than
 * through sixteen positional props threaded three components deep.
 */
export type DiverRollCallContext = {
  /** Scopes this section's element ids to one departure — see `scopedId`. */
  idPrefix?: string;
  divers: TripManifest["divers"];
  /** Full crew rows for resolving buddy states inside a diver's sheet. */
  crew: TripManifest["crew"];
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  /** The departure is marked as past no-decompression limits. */
  exceedsNoDecoLimits?: boolean;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  /** All staff context for this booking, regardless of where it was written. */
  notesByBooking: ReadonlyMap<string, ReadonlyArray<ManifestNote>>;
  /** The non-implied roll-call events for this diver across today's checkpoints. */
  todayTrailByBooking?: ReadonlyMap<string, readonly PersonTrailEntry[]>;
  rollCallAction: RollCallAction;
  /**
   * The departure is cancelled and nobody was counted before it was (#2285):
   * every roll-call write is refused, so no row or sheet draws a roll-call
   * control. What is recorded still reads.
   */
  rollCallClosed?: boolean;
  addPrivateNoteAction: PrivateNoteAction;
  /**
   * The row's missing-diver controls (`MissingDiverControls`), bound to the
   * departure; absent, or each null, for a reader who may not start an
   * incident report here (anyone but its crew, owners and managers). Each
   * write re-checks.
   */
  missingDiver?: MissingDiverRowActions;
  /**
   * One `RollCallButtonCopy` per diver: the "not ready" refusal embeds a rich
   * link to that diver's own Guests anchor, so it is built by the page
   * (server-side, with `t.rich`) rather than reassembled from string fragments
   * in the Client Component — see the note on `RollCallButtonCopy`.
   */
  rollCallButtonCopy: (bookingId: string) => RollCallButtonCopy;
  buddyTeamLabel: (teams: ReadonlyArray<ManifestBuddyTeam>) => string | null;
  /**
   * One seat's "Show the alert" (issue #2960), bound only for a reader allowed
   * the medical alerts' words on this departure. Absent, a flagged row still
   * wears its chip and says who can read it.
   */
  showMedicalAlert?: (bookingId: string) => () => Promise<MedicalAlertResult>;
  /**
   * One seat's "Emergency: show the alert" (issue #2990), bound only for a
   * staffer the crew rule refuses, until the days of the trip end. The
   * action re-checks and records every confirm.
   */
  emergencyShowMedicalAlert?: (bookingId: string) => () => Promise<MedicalAlertResult>;
  /**
   * The words a packet printed **with** the medical alerts carries (issue
   * #2990), by booking id, and who printed them when. Only the "Print with
   * medical alerts" route sets it, through a key no URL can carry
   * (`PRINTED_MEDICAL_ALERTS`); absent on the screen and on every other print.
   */
  printedMedicalAlerts?: PrintedMedicalAlerts;
  /**
   * Composed as the trip packet's paper (`PAPER_PACKET`, B03): each row is
   * its name line and its printed facts, with no sheet behind the name and no
   * mark to tap. Absent on the live manifest.
   */
  paper?: boolean;
  t: StaffTranslator;
};
