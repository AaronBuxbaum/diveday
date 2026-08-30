import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { ListItemActions } from "@/components/ui/list-item-actions";
import { canPersonManageShopSettings } from "@/db/authz";
import { listChecklistItems } from "@/db/pre-departure-check";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import {
  addChecklistItemAction,
  deleteChecklistItemAction,
  moveChecklistItemAction,
} from "./actions";

export const instant = true;

export const metadata: Metadata = { title: "Pre-departure checklist — DiveDay" };

/** One resolved `?notice=`: the tone it carries and the words for it. */
function noticeMessages(
  t: StaffTranslator,
): Record<string, { tone: "success" | "danger"; text: string }> {
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
  // Same owner/manager gate as the settings hub this page hangs off of.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const items = await listChecklistItems(db, shop.id);
  const message = notice ? noticeMessages(t)[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      <ShopPageHeader
        eyebrow={t("settings.safetyChecklist.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.safetyChecklist.title")}
        description={t("settings.safetyChecklist.description")}
      />

      {message ? <StaffNoticeBanner tone={message.tone}>{message.text}</StaffNoticeBanner> : null}

      <SectionCard title={t("settings.safetyChecklist.listHeading")} className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            title={t("settings.safetyChecklist.empty.title")}
            body={t("settings.safetyChecklist.empty.body")}
          />
        ) : (
          <ol className="flex flex-col gap-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3"
              >
                <span className="min-w-0 flex-1 break-words text-sm">{item.label}</span>
                <ListItemActions>
                  <form action={moveChecklistItemAction.bind(null, shopSlug)}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      disabled={index === 0}
                      aria-label={t("settings.safetyChecklist.moveUp")}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
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
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      <DiveDayIcon name="arrow-down" className="size-4" />
                    </button>
                  </form>
                  <form action={deleteChecklistItemAction.bind(null, shopSlug)}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <button
                      type="submit"
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      {t("settings.safetyChecklist.delete")}
                    </button>
                  </form>
                </ListItemActions>
              </li>
            ))}
          </ol>
        )}

        <FieldGrid
          as="form"
          action={addChecklistItemAction.bind(null, shopSlug)}
          columns={1}
          className="mt-6"
        >
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
      </SectionCard>
    </main>
  );
}
