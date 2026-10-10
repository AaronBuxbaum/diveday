import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { InsetGroup } from "@/components/ui/ledger";
import { canPersonErasePersonalData } from "@/db/authz";
import type { AppDb } from "@/db/client";
import { listPendingMediaDeletions } from "@/db/media-deletions";
import { listOwedProcessorErasures } from "@/db/processor-erasure";
import type { MediaDeletionKind, ProcessorErasureTarget } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { type ErasureFailure, erasureFailureOf } from "@/lib/payments/erasure-failure";
import {
  dischargeProcessorErasureAction,
  retryMediaDeletionAction,
  retryProcessorErasureAction,
} from "../../data-actions";
import { SettingsDoorRow } from "../SettingsRows";
import { DATA_GROUP, SettingsGroup, type SettingsView } from "./kit";

/**
 * Which stored file a deletion never finished on. Without an entry here the
 * lookup falls through to the raw enum value, so a stuck deletion would read
 * "certification_card" on the panel. `certification_card` and
 * `waiver_document` are queued by diver erasure (ADR 20260802-diver-data-erasure).
 *
 * **Keyed by the enum**, so a tenth member cannot arrive without a word. Open
 * keys are not hypothetical here: `src/i18n/today-labels.ts`'s
 * `MEDIA_DELETION_KIND_KEYS` shipped seven rows against nine reachable kinds
 * and put a raw `shop_logo` on the Today queue until it was closed the same way
 * (issue #1798).
 *
 * **The nine words exist twice on purpose**, here and as
 * `today.opsAlert.mediaKind.*`. Two areas, two bundles, one file per area — the
 * duplication is what that rule buys (`.claude/rules/i18n.md`, ADR
 * 20260807-per-area-staff-bundles), and the alternative is Settings reading
 * Today's namespace for a word on its own panel. The two surfaces are also free
 * to diverge: Today's word is the subject of a sentence, this one is a list
 * label. Edit both when the wording changes.
 */
const MEDIA_KIND_KEYS: Record<MediaDeletionKind, StaffMessageKey> = {
  course_photo: "settings.main.dataJobs.mediaKind.course_photo",
  recap_photo: "settings.main.dataJobs.mediaKind.recap_photo",
  arrival_photo: "settings.main.dataJobs.mediaKind.arrival_photo",
  certification_card: "settings.main.dataJobs.mediaKind.certification_card",
  waiver_document: "settings.main.dataJobs.mediaKind.waiver_document",
  dive_site_photo: "settings.main.dataJobs.mediaKind.dive_site_photo",
  shop_logo: "settings.main.dataJobs.mediaKind.shop_logo",
  shop_hero: "settings.main.dataJobs.mediaKind.shop_hero",
  payment_receipt: "settings.main.dataJobs.mediaKind.payment_receipt",
};

/**
 * Which record at the processor is still owed an erasure, present for the same
 * reason `MEDIA_KIND_KEYS` is: without it the lookup falls through to the raw
 * enum value and the panel reads "stripe_invoice_snapshot". Keyed by the enum
 * for the same reason, so a fourth target fails typecheck rather than the panel.
 */
const PROCESSOR_ERASURE_TARGET_KEYS: Record<ProcessorErasureTarget, StaffMessageKey> = {
  stripe_customer: "settings.main.dataJobs.erasureTarget.stripe_customer",
  stripe_invoice_snapshot: "settings.main.dataJobs.erasureTarget.stripe_invoice_snapshot",
  stripe_checkout_session_snapshot:
    "settings.main.dataJobs.erasureTarget.stripe_checkout_session_snapshot",
};

/**
 * Why an erasure is still owed, in shop words (issue #1865). The row's
 * `last_error` is Stripe's own English and stays in the ledger; the panel
 * reads its class (`erasureFailureOf`), keyed so a new class fails typecheck.
 */
const PROCESSOR_ERASURE_FAILURE_KEYS: Record<ErasureFailure, StaffMessageKey> = {
  account_not_owned: "settings.main.dataJobs.processorErasures.failure.account_not_owned",
  refused: "settings.main.dataJobs.processorErasures.failure.refused",
  unreachable: "settings.main.dataJobs.processorErasures.failure.unreachable",
  not_confirmed: "settings.main.dataJobs.processorErasures.failure.not_confirmed",
};

function processorErasureFailureFact(t: StaffTranslator, lastError: string | null) {
  const failure = erasureFailureOf(lastError);
  return failure
    ? { value: t(PROCESSOR_ERASURE_FAILURE_KEYS[failure]), className: "text-muted" }
    : null;
}

/**
 * The Data group. Async: the two data-compliance queues it leads with (stuck
 * media deletions, owed processor erasures) and whether this reader may close
 * an erasure are read here, so the group streams under its own `<Suspense>`.
 * Both queues render nothing when empty.
 */
export async function DataGroup({
  view,
  db,
  personId,
  canExport,
  canImport,
}: {
  view: SettingsView;
  db: AppDb;
  personId: string;
  canExport: boolean;
  canImport: boolean;
}) {
  const { shop, shopSlug, t, locale } = view;
  const [pendingMediaDeletions, owedProcessorErasures, canErase] = await Promise.all([
    listPendingMediaDeletions(db, shop.id),
    listOwedProcessorErasures(db, shop.id),
    // Owner-only, and tighter than the gate those panels are *read* behind: a
    // retry fires a destructive call at the shop's Stripe account and a discharge
    // signs an attestation that a diver's data is gone from the processor. The
    // actions enforce it themselves and return silently on refusal — this only
    // keeps a manager from being shown a button they would be bounced from
    // (ADR 20260724-role-gated-surfaces-hide-not-explain).
    canPersonErasePersonalData(db, shop.id, personId),
  ]);
  return (
    <SettingsGroup group={DATA_GROUP} label={t(DATA_GROUP.labelKey)}>
      {/*
      Data this shop said it would delete and hasn't finished deleting —
      the group's own question, asked first because it is the only thing in
      it that is *owed* rather than merely configurable, and danger-toned
      rather than folded away: an unfinished erasure is a legal obligation,
      not a notification to dismiss. Both blocks vanish entirely when the
      queue is empty, which is nearly always, so the calm state of this
      group is the row list below.
    */}
      {pendingMediaDeletions.length > 0 ? (
        <section
          aria-label={t("settings.main.dataJobs.mediaDeletions.sectionLabel")}
          className="mb-6"
        >
          <ShopNotice tone="danger" role="status">
            <p className="font-medium">
              {t("settings.main.dataJobs.mediaDeletions.heading", {
                count: pendingMediaDeletions.length,
              })}
            </p>
            <p className="mt-1 text-sm">{t("settings.main.dataJobs.mediaDeletions.detail")}</p>
            {/* Each item is its words as one line of facts, then its
                actions on a line of their own, so no line opens with "·"
                and every item's buttons start at one x (K-341). An item's
                two lines sit 8px apart, and items 16px. */}
            <ul className="mt-3 space-y-4 text-sm">
              {pendingMediaDeletions.map((attempt) => (
                // The provider's own words are deliberately not here. A
                // shop read "Blob storage returned 503" beside a photo and
                // learned nothing it could act on; the two sentences above
                // already say what happened and what to do, and tonight's
                // retry is what actually fixes it. The reason stays on the
                // row in the database for whoever is on call.
                <li key={attempt.id} className="flex flex-col items-start gap-2">
                  <p className="min-w-0">
                    <FactLine
                      separatorClassName="text-muted"
                      facts={[
                        { value: t(MEDIA_KIND_KEYS[attempt.kind]), className: "font-medium" },
                        {
                          value: t("settings.main.dataJobs.mediaDeletions.queued", {
                            date: formatShortDate(attempt.createdAt, locale, shop.timezone),
                          }),
                          className: "text-muted",
                        },
                      ]}
                    />
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <form action={retryMediaDeletionAction}>
                      <input type="hidden" name="attemptId" value={attempt.id} />
                      <SubmitButton
                        pendingLabel={t("settings.main.dataJobs.mediaDeletions.retrying")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("settings.main.dataJobs.mediaDeletions.retry")}
                      </SubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

      {/*
      Erasures that are done here but not yet done at Stripe
      (ADR 20260803-processor-erasure-obligations). Two kinds, and the row
      offers what can actually act on each: a customer delete DiveDay makes
      itself gets "Retry" (the nightly tick also retries it), while an
      invoice snapshot has no API behind it at all and can only be closed by
      an owner attesting they filed Stripe's data-deletion request. The panel
      shows the `cus_…`/`in_…` handle and nothing else — the diver's identity
      is exactly what erasure already removed here.
    */}
      {owedProcessorErasures.length > 0 ? (
        <section
          aria-label={t("settings.main.dataJobs.processorErasures.sectionLabel")}
          className="mb-6"
        >
          <ShopNotice tone="danger" role="status">
            <p className="font-medium">
              {t("settings.main.dataJobs.processorErasures.heading", {
                count: owedProcessorErasures.length,
              })}
            </p>
            <p className="mt-1 text-sm">{t("settings.main.dataJobs.processorErasures.detail")}</p>
            <ul className="mt-3 space-y-4 text-sm">
              {owedProcessorErasures.map((obligation) => (
                <li key={obligation.id} className="flex flex-col items-start gap-2">
                  <p className="min-w-0">
                    <FactLine
                      separatorClassName="text-muted"
                      facts={[
                        {
                          value: t(PROCESSOR_ERASURE_TARGET_KEYS[obligation.target]),
                          className: "font-medium",
                        },
                        { value: obligation.externalId, className: "font-mono" },
                        {
                          value: t("settings.main.dataJobs.processorErasures.raised", {
                            date: formatShortDate(obligation.createdAt, locale, shop.timezone),
                          }),
                          className: "text-muted",
                        },
                        processorErasureFailureFact(t, obligation.lastError),
                      ]}
                    />
                  </p>
                  {/* Only an owner may close an erasure, so a manager's
                      item is its words alone, with no empty row under it. */}
                  {canErase ? (
                    <div className="flex flex-wrap gap-2">
                      {obligation.target === "stripe_customer" ? (
                        <form action={retryProcessorErasureAction}>
                          <input type="hidden" name="obligationId" value={obligation.id} />
                          <SubmitButton
                            pendingLabel={t("settings.main.dataJobs.processorErasures.retrying")}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {t("settings.main.dataJobs.processorErasures.retry")}
                          </SubmitButton>
                        </form>
                      ) : null}
                      <form action={dischargeProcessorErasureAction}>
                        <input type="hidden" name="obligationId" value={obligation.id} />
                        <SubmitButton
                          pendingLabel={t("settings.main.dataJobs.processorErasures.discharging")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {t("settings.main.dataJobs.processorErasures.discharge")}
                        </SubmitButton>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </ShopNotice>
        </section>
      ) : null}

      <InsetGroup>
        {/* Who did what, across the team (D5). The hub is already owner and
          manager reading, the log's own gate; the page re-checks it. */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/activity`}
          heading={t("activity.log.title")}
        />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/integrations`}
          heading={t("settings.main.integrations.heading")}
        />

        {/* Owner/manager only, like the export row it feeds: the
          destination it configures receives the whole shop every week.

          Two rows, one surface. Backups and the download are the same
          bundle behind the same gate and share a route now (ADR
          20260806-one-data-out-surface), but a shop arrives at Settings
          asking one of two different questions — "let me take a copy" and
          "make sure a copy keeps happening" — so both doors stay, and this
          one deep-links to the half it names. */}
        {canExport ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/export#backups`}
            heading={t("settings.main.backup.heading")}
          />
        ) : null}

        {canImport ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/import`}
            heading={t("settings.import.title")}
          />
        ) : null}

        {canExport ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/export`}
            heading={t("settings.export.title")}
          />
        ) : null}
      </InsetGroup>
    </SettingsGroup>
  );
}
