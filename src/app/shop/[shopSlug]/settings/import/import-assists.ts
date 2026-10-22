import { assistsAvailable } from "@/db/assists";
import { canPersonManageShopSettings } from "@/db/authz";
import type { AppDb } from "@/db/client";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { mapImportColumnsAction } from "./assist-actions";
import type { ImportWizardAssist } from "./ImportWizard";

/**
 * **Claude's two doors on the Import page** (ADR 20261018-claude-assists): the
 * column mapping in the Divers wizard (`import`), and the Website tab
 * (`setup`), which writes settings and so also asks the settings gate. Both
 * are absent while the shop's assists are dark, and a `?what=website` that is
 * not on offer reads as the Divers tab.
 */
export async function importAssists(
  db: AppDb,
  shopId: string,
  personId: string,
  t: StaffTranslator,
) {
  const [assists, canSetUp] = await Promise.all([
    assistsAvailable(db, shopId),
    canPersonManageShopSettings(db, shopId, personId),
  ]);
  const website = assists && canSetUp;
  const wizard: ImportWizardAssist | undefined = assists
    ? {
        map: mapImportColumnsAction,
        words: {
          map: t("assistsFront.import.map"),
          mapping: t("assistsFront.import.mapping"),
          mapHint: t("assistsFront.import.mapHint"),
          mapNothing: t("assistsFront.import.mapNothing"),
          suggested: t.raw("assistsFront.import.suggested"),
          pendingCards: t("assistsFront.import.pendingCards"),
        },
      }
    : undefined;
  return {
    website,
    wizard,
    /** The tab asked for, or Divers when it is the Website tab and that is not on offer. */
    tab: <T extends string>(asked: T): T | "divers" =>
      asked === "website" && !website ? "divers" : asked,
  };
}
