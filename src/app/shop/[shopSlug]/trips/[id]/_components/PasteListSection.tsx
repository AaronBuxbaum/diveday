import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { PASTE_CHOICE_FIELD, PASTE_LIST_MAX_ROWS } from "@/features/bookings/paste-list";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import type { PasteListState } from "../paste-list-actions";
import { type PasteListCopy, PasteListPanel } from "./PasteListPanel";

/** The `#` a link can open "Paste a list" with. */
export const PASTE_A_LIST_ID = "paste-a-list";

function counted(
  t: StaffTranslator,
  one: Parameters<StaffTranslator["raw"]>[0],
  other: typeof one,
) {
  return { one: t.raw(one) as string, other: t.raw(other) as string };
}

/** The panel's words, translated here because a staff Client Component takes words as props. */
export function pasteListCopy(t: StaffTranslator): PasteListCopy {
  return {
    listLabel: t("trips.pasteList.listLabel"),
    listDescription: t("trips.pasteList.listDescription"),
    chooseFile: t("trips.pasteList.chooseFile"),
    fileUnreadable: t("trips.pasteList.fileUnreadable"),
    read: t("trips.pasteList.read"),
    reading: t("trips.pasteList.reading"),
    refused: {
      empty: t("trips.pasteList.refused.empty"),
      too_large: t("trips.pasteList.refused.too_large"),
      too_many_columns: t("trips.pasteList.refused.too_many_columns"),
      too_many_rows: t("trips.pasteList.refused.too_many_rows", { limit: PASTE_LIST_MAX_ROWS }),
      cell_too_long: t("trips.pasteList.refused.cell_too_long"),
      no_names: t("trips.pasteList.refused.no_names"),
      invalid: t("trips.pasteList.refused.invalid"),
    },
    toAdd: counted(t, "trips.pasteList.toAddOne", "trips.pasteList.toAddOther"),
    skipped: counted(t, "trips.pasteList.skippedOne", "trips.pasteList.skippedOther"),
    duplicates: counted(t, "trips.pasteList.duplicatesOne", "trips.pasteList.duplicatesOther"),
    whoLabel: t.raw("trips.pasteList.whoLabel") as string,
    newPerson: t("trips.pasteList.newPerson"),
    onFile: t.raw("trips.pasteList.onFile") as string,
    onFileWith: t.raw("trips.pasteList.onFileWith") as string,
    droppedEmail: t("trips.pasteList.droppedEmail"),
    droppedPhone: t("trips.pasteList.droppedPhone"),
    seat: counted(t, "trips.pasteList.seatOne", "trips.pasteList.seatOther"),
    seating: t("words.busy.adding"),
    startOver: t("trips.pasteList.startOver"),
    added: counted(t, "trips.pasteList.addedOne", "trips.pasteList.addedOther"),
    notAdded: counted(t, "trips.pasteList.notAddedOne", "trips.pasteList.notAddedOther"),
    reached: {
      email: t("trips.pasteList.reached.email"),
      sms: t("trips.pasteList.reached.sms"),
      whatsapp: t("trips.pasteList.reached.whatsapp"),
    },
    nothingSent: t("trips.pasteList.nothingSent"),
    held: t("trips.pasteList.held"),
    refusal: {
      full: t("trips.pasteList.refusal.full"),
      already: t("trips.pasteList.refusal.already"),
      cards: t("trips.pasteList.refusal.cards"),
      course: t("trips.pasteList.refusal.course"),
      busy: t("trips.pasteList.refusal.busy"),
      unavailable: t("trips.pasteList.refusal.unavailable"),
    },
    done: t("trips.pasteList.done"),
  };
}

/**
 * **"Paste a list"** under the add band's search ("Try it Saturday", item 1):
 * closed until asked for, since most adds are one person at the counter.
 */
export function PasteListSection({
  action,
  locale,
}: {
  action: (state: PasteListState | undefined, formData: FormData) => Promise<PasteListState>;
  locale: string;
}) {
  const t = staffTranslator(locale);
  return (
    <AutoOpenDetails
      id={PASTE_A_LIST_ID}
      openOnHash={PASTE_A_LIST_ID}
      className="group/paste scroll-mt-24 rounded-lg border border-border bg-surface"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 font-medium focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
        {t("trips.pasteList.heading")}
        <DisclosureCaret
          direction="down"
          className="size-4 text-muted group-open/paste:rotate-180"
        />
      </summary>
      <div className="px-3 pt-1 pb-4">
        <PasteListPanel
          action={action}
          copy={pasteListCopy(t)}
          locale={locale}
          choiceField={PASTE_CHOICE_FIELD}
        />
      </div>
    </AutoOpenDetails>
  );
}
