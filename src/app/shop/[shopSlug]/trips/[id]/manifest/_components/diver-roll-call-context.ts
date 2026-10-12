import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import type { PrivateNoteAction } from "@/components/PrivateNoteForm";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ManifestBuddyTeam, RollCallCheckpoint, TripManifest } from "@/lib/manifests";
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
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  /** All staff context for this booking, regardless of where it was written. */
  notesByBooking: ReadonlyMap<string, ReadonlyArray<ManifestNote>>;
  /** The non-implied roll-call events for this diver across today's checkpoints. */
  todayTrailByBooking?: ReadonlyMap<string, readonly PersonTrailEntry[]>;
  rollCallAction: RollCallAction;
  addPrivateNoteAction: PrivateNoteAction;
  /**
   * One `RollCallButtonCopy` per diver: the "not ready" refusal embeds a rich
   * link to that diver's own Guests anchor, so it is built by the page
   * (server-side, with `t.rich`) rather than reassembled from string fragments
   * in the Client Component — see the note on `RollCallButtonCopy`.
   */
  rollCallButtonCopy: (bookingId: string) => RollCallButtonCopy;
  buddyTeamLabel: (teams: ReadonlyArray<ManifestBuddyTeam>) => string | null;
  t: StaffTranslator;
};
