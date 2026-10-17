import { LedgerRow } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import { liveReleaseIsSample } from "@/db/first-run";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { canManageWaiverTemplates, type Role } from "@/lib/authz";
import { shopPath } from "@/lib/staff-notices";

/**
 * **"Read your release", standing on Today until the shop does** (fourth UX
 * review, item 21). The checklist above goes the moment a first departure is
 * saved, and an owner who adds a boat first never saw its release step again
 * while divers kept signing DiveDay's sample. So that one step stays, as a
 * door like the checklist's own rows, for as long as the live release is the
 * sample: a fact of the data, never a dismissal.
 *
 * Only for the owner or manager, who are the ones who may edit the release
 * (`canManageWaiverTemplates`); a door the reader cannot walk through is not
 * drawn. Not on a demo shop, whose release is the sample on purpose, and not
 * while the checklist itself is showing, which already carries the step.
 */
export async function ReleaseStillSample({
  db,
  shop,
  roles,
  firstRun,
  t,
}: {
  db: AppDb;
  shop: { id: string; slug: string; isDemo: boolean };
  roles: readonly Role[] | undefined;
  /** The first-run checklist is on screen, and holds this step itself. */
  firstRun: boolean;
  t: StaffTranslator;
}) {
  if (shop.isDemo || firstRun || !canManageWaiverTemplates(roles)) return null;
  if (!(await liveReleaseIsSample(db, shop.id))) return null;
  return (
    <ul className="mt-6">
      <LedgerRow
        href={`${shopPath(shop.slug, "waivers")}#release`}
        linkLabel={t("shopHome.firstRun.releaseAction")}
      >
        <div className="min-w-0">
          <p className="font-medium">{t("shopHome.firstRun.releaseTitle")}</p>
          <p className="mt-0.5 text-sm text-muted">{t("shopHome.firstRun.releaseBody")}</p>
        </div>
      </LedgerRow>
    </ul>
  );
}
