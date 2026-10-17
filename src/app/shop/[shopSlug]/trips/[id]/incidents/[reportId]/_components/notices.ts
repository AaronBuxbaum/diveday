import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";

/** Which form on the report page a notice belongs to (`noticeForForm`). */
export type IncidentForm = "page" | "draft" | "people" | "file" | "addenda" | "discard" | "hold";

/**
 * The report page's `?notice=` codes, each with the form it answers and its
 * words. The codes are written by `../../actions.ts`.
 */
export const INCIDENT_NOTICES: Record<
  string,
  { form: IncidentForm; tone: NoticeTone; key: StaffMessageKey }
> = {
  saved: { form: "draft", tone: "success", key: "incidents.notices.saved" },
  filed: { form: "page", tone: "success", key: "incidents.notices.filed" },
  "addendum-added": { form: "addenda", tone: "success", key: "incidents.notices.addendumAdded" },
  "person-added": { form: "people", tone: "success", key: "incidents.notices.personAdded" },
  "person-removed": { form: "people", tone: "success", key: "incidents.notices.personRemoved" },
  "occurred-at-invalid": {
    form: "draft",
    tone: "danger",
    key: "incidents.notices.occurredAtInvalid",
  },
  "handed-over-at-invalid": {
    form: "draft",
    tone: "danger",
    key: "incidents.notices.handedOverAtInvalid",
  },
  "handed-over-before-incident": {
    form: "draft",
    tone: "danger",
    key: "incidents.notices.handedOverBeforeIncident",
  },
  "oxygen-minutes-invalid": {
    form: "draft",
    tone: "danger",
    key: "incidents.notices.oxygenMinutesInvalid",
  },
  "text-too-long": { form: "draft", tone: "danger", key: "incidents.notices.textTooLong" },
  "site-not-found": { form: "draft", tone: "danger", key: "incidents.notices.siteNotFound" },
  incomplete: { form: "file", tone: "danger", key: "incidents.notices.incomplete" },
  "already-filed": { form: "addenda", tone: "warning", key: "incidents.notices.alreadyFiled" },
  "not-yet-filed": { form: "file", tone: "warning", key: "incidents.notices.notYetFiled" },
  "subject-not-found": {
    form: "people",
    tone: "danger",
    key: "incidents.notices.subjectNotFound",
  },
  "already-listed": { form: "people", tone: "warning", key: "incidents.notices.alreadyListed" },
  "nobody-chosen": { form: "people", tone: "danger", key: "incidents.notices.nobodyChosen" },
  "name-too-long": { form: "people", tone: "danger", key: "incidents.notices.textTooLong" },
  "note-too-long": { form: "addenda", tone: "danger", key: "incidents.notices.textTooLong" },
  held: { form: "discard", tone: "warning", key: "incidents.notices.held" },
  alerted: { form: "discard", tone: "warning", key: "incidents.notices.alerted" },
  found: { form: "page", tone: "success", key: "incidents.notices.found" },
  "hold-set": { form: "hold", tone: "success", key: "incidents.notices.holdSet" },
  "hold-released": { form: "hold", tone: "success", key: "incidents.notices.holdReleased" },
  "blank-note": { form: "addenda", tone: "danger", key: "incidents.notices.blankNote" },
};
