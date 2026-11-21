import type { requireShopSurface } from "@/features/accounts/session";
import { staffDiveIntentLine } from "@/features/trips/dive-intent";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BuddyTeamsPanel } from "../../manifest/_components/BuddyTeamsPanel";
import { readManifestView } from "../../manifest/_components/manifest-view";
import {
  addBuddyTeamMemberAction,
  dissolveBuddyTeamAction,
  formBuddyTeamAction,
  removeBuddyTeamMemberAction,
  teamUpPartiesAction,
} from "../../manifest/actions";
import type { BuddySurface } from "../../manifest/buddy-landing";

/** The id the Gear to pack card's "Buddy teams" link scrolls to. */
export const BUDDY_TEAMS_ID = "buddy-teams";

/**
 * **Buddy teams** (ADR 20261117-trip-page-clock: Getting ready, then Roll
 * call): the team builder, under Getting ready's cards and Check-in's list,
 * for a shop with the feature on. Closed at rest; each act lands back here
 * with it open (`buddyActLandsAt`).
 */
export async function BuddyTeamsCard({
  context,
  tripId,
  surface,
  locale,
  t,
  open,
  buddyError,
}: {
  context: Pick<Awaited<ReturnType<typeof requireShopSurface>>, "db" | "shop" | "session">;
  tripId: string;
  surface: BuddySurface;
  locale: string;
  t: StaffTranslator;
  open: boolean;
  buddyError?: string;
}) {
  if (!context.shop.buddyTeamsEnabled) return null;
  const shopSlug = context.shop.slug;
  const view = await readManifestView({ ...context, shopSlug, tripId, locale, t, buddyError });
  if (view.status !== "ready") return null;
  const actionContext = { ...view.actionContext, buddySurface: surface };
  return (
    <div id={BUDDY_TEAMS_ID} className="scroll-mt-24">
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
        // The Trip page's section heads are row-sized (finding 9).
        headingClass="font-semibold"
        t={t}
      />
    </div>
  );
}
