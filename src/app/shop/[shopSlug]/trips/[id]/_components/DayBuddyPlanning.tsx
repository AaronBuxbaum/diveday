import { staffDiveIntentLine } from "@/features/dive-intent";
import type { requireShopSurface } from "@/features/session";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BuddyTeamsPanel } from "../manifest/_components/BuddyTeamsPanel";
import { readManifestView } from "../manifest/_components/manifest-view";
import {
  addBuddyTeamMemberAction,
  dissolveBuddyTeamAction,
  formBuddyTeamAction,
  removeBuddyTeamMemberAction,
  teamUpPartiesAction,
} from "../manifest/actions";

/** The optional planning entry is absent while the shop has it switched off. */
export async function DayBuddyPlanning({
  context,
  tripId,
  locale,
  t,
  open,
  buddyError,
}: {
  context: Pick<Awaited<ReturnType<typeof requireShopSurface>>, "db" | "shop" | "session">;
  tripId: string;
  locale: string;
  t: StaffTranslator;
  open: boolean;
  buddyError?: string;
}) {
  if (!context.shop.buddyTeamsEnabled) return null;
  const shopSlug = context.shop.slug;
  const view = await readManifestView({ ...context, shopSlug, tripId, locale, t, buddyError });
  if (view.status !== "ready") return null;
  const actionContext = { ...view.actionContext, buddySurface: "day" as const };
  return (
    <BuddyTeamsPanel
      defaultOpen={open}
      intentLine={staffDiveIntentLine(t, view.diveIntents, locale)}
      buddyTeamsList={view.buddyTeamsList}
      {...view.buddy.panel}
      formBuddyTeamAction={formBuddyTeamAction.bind(null, actionContext)}
      teamUpPartiesAction={teamUpPartiesAction.bind(null, actionContext)}
      addBuddyTeamMemberAction={addBuddyTeamMemberAction.bind(null, actionContext)}
      removeBuddyTeamMemberAction={removeBuddyTeamMemberAction.bind(null, actionContext)}
      dissolveBuddyTeamAction={dissolveBuddyTeamAction.bind(null, actionContext)}
      t={t}
    />
  );
}
