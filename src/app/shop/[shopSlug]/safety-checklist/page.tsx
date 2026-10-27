import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow, DisclosureRowList } from "@/components/ui/disclosure";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { LedgerRow } from "@/components/ui/ledger";
import { ListItemActions } from "@/components/ui/list-item-actions";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonManageSafetyChecklist } from "@/db/authz";
import { listChecklistItems } from "@/db/pre-departure-check";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import type { NoticeMessages } from "@/lib/staff-notices";
import { registerPaneClass } from "../_components/register-pane";
import {
  addChecklistItemAction,
  deleteChecklistItemAction,
  moveChecklistItemAction,
} from "./actions";

export const instant = true;

export const metadata: Metadata = { title: "Pre-departure checklist — DiveDay" };

function noticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "checklist-item-added": { tone: "success", text: t("settings.safetyChecklist.notice.added") },
    "checklist-item-deleted": {
      tone: "success",
      text: t("settings.safetyChecklist.notice.deleted"),
    },
    "checklist-item-invalid": {
      tone: "danger",
      text: t("settings.safetyChecklist.notice.invalid"),
    },
    "checklist-item-duplicate-label": {
      tone: "danger",
      text: t("settings.safetyChecklist.notice.duplicateLabel"),
    },
    "checklist-item-not-authorized": {
      tone: "danger",
      text: t("settings.safetyChecklist.notice.notAuthorized"),
    },
    "checklist-item-move-refused": {
      tone: "danger",
      text: t("settings.safetyChecklist.notice.moveRefused"),
    },
  };
}

export default async function SafetyChecklistPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  // The checklist's own gate (issue #2659): owner and manager, as Settings was.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageSafetyChecklist,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const items = await listChecklistItems(db, shop.id);
  const message = notice ? noticeMessages(t)[notice] : undefined;

  return (
    <main className={registerPaneClass()}>
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.safetyChecklist.title")}
        description={t("settings.safetyChecklist.description")}
        descriptionIsCaption
      />

      {message ? <StaffNoticeBanner tone={message.tone}>{message.text}</StaffNoticeBanner> : null}

      <div className="space-y-10">
        <section aria-labelledby="checklist-heading">
          <h2 id="checklist-heading" className={`${SECTION_TITLE_CLASS} mb-4`}>
            {t("settings.safetyChecklist.listHeading")}
          </h2>
          {items.length === 0 ? (
            <EmptyState
              title={t("settings.safetyChecklist.empty.title")}
              body={t("settings.safetyChecklist.empty.body")}
            />
          ) : (
            <ol>
              {items.map((item, index) => (
                <LedgerRow
                  key={item.id}
                  id={`checklist-${item.id}`}
                  stacked
                  trailing={
                    <ListItemActions>
                      <form action={moveChecklistItemAction.bind(null, shopSlug)}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={index === 0}
                          aria-label={t("settings.safetyChecklist.moveUp")}
                          // Below `sm` the actions are the row's last line, and
                          // their unseen lower half sinks into its padding.
                          className={buttonClass({
                            variant: "ghost",
                            size: "icon-sm",
                          })}
                        >
                          <DiveDayIcon name="arrow-up" className="size-4" />
                        </button>
                      </form>
                      <form action={moveChecklistItemAction.bind(null, shopSlug)}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={index === items.length - 1}
                          aria-label={t("settings.safetyChecklist.moveDown")}
                          className={buttonClass({
                            variant: "ghost",
                            size: "icon-sm",
                          })}
                        >
                          <DiveDayIcon name="arrow-down" className="size-4" />
                        </button>
                      </form>
                      <form action={deleteChecklistItemAction.bind(null, shopSlug)}>
                        <input type="hidden" name="itemId" value={item.id} />
                        {/* Ghost weight, not the bordered `danger`: five bordered
                        red buttons down a five-row list shout at a shop
                        editing its own words, and the two arrows beside each
                        are already ghosts. The word stays "Delete"
                        (ADR 20260820-every-delete-is-soft). */}
                        <SubmitButton
                          pendingLabel={t("settings.safetyChecklist.delete")}
                          className={buttonClass({
                            variant: "danger-ghost",
                            size: "sm",
                          })}
                        >
                          {t("settings.safetyChecklist.delete")}
                        </SubmitButton>
                      </form>
                    </ListItemActions>
                  }
                >
                  <span className="break-words">{item.label}</span>
                </LedgerRow>
              ))}
            </ol>
          )}
        </section>
        <DisclosureRowList>
          <DisclosureRow
            className="print:[&:not([open])]:hidden"
            id="checklist-new"
            heading={t("settings.safetyChecklist.addTitle")}
            open={
              notice === "checklist-item-invalid" || notice === "checklist-item-duplicate-label"
            }
          >
            <FieldGrid as="form" action={addChecklistItemAction.bind(null, shopSlug)} columns={1}>
              <Field label={t("settings.safetyChecklist.addLabel")}>
                <input
                  type="text"
                  name="label"
                  required
                  maxLength={200}
                  placeholder={t("settings.safetyChecklist.addPlaceholder")}
                  className={controlClass}
                />
              </Field>
              <FieldActions>
                <button type="submit" className={buttonClass({ variant: "secondary" })}>
                  {t("settings.safetyChecklist.addSubmit")}
                </button>
              </FieldActions>
            </FieldGrid>
          </DisclosureRow>
        </DisclosureRowList>
      </div>
    </main>
  );
}
