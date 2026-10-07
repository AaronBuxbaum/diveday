import type { Dispatch, SetStateAction } from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import type { DiverLocale } from "@/i18n/settings";
import type { ArrivalStatus } from "@/lib/arrival";
import type { RollCallCheckpoint } from "@/lib/manifests";
import type { OfflineRollCallResult } from "@/lib/offline-manifests";
import type { PreDepartureCheckStatus } from "@/lib/pre-departure-check";
import type { OfflineStatement } from "./shared";

/**
 * **What the offline manifest's sections can do**, and the device state they
 * read while doing it: the words, the status line, which row is saving, the
 * armed "aboard" confirmation, the per-row note drafts, and the three taps
 * that queue an event on this device. Held by `OfflineManifestView`; every
 * section reads the same object, so a tap means the same thing wherever it is.
 */
export type OfflineTripControls = {
  t: OfflineManifestTranslator;
  locale: DiverLocale;
  /** The one status line under the header. */
  message: string;
  setCheckpoint: Dispatch<SetStateAction<RollCallCheckpoint>>;
  /** The diver or crew row saving now, by booking or person id. */
  busyBooking: string | null;
  busyChecklistItem: string | null;
  busyArrival: string | null;
  /** The row whose "aboard" tap is waiting on its confirmation. */
  confirmAboardFor: string | null;
  setConfirmAboardFor: Dispatch<SetStateAction<string | null>>;
  noteDrafts: Record<string, string>;
  setNoteDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  record: (
    subject: { bookingId: string } | { crewPersonId: string },
    statement: OfflineStatement,
    standing?: Pick<OfflineRollCallResult, "state" | "implied">,
  ) => Promise<void>;
  recordChecklistCheck: (checklistItemId: string, status: PreDepartureCheckStatus) => Promise<void>;
  recordArrival: (bookingId: string, status: ArrivalStatus) => Promise<void>;
};
