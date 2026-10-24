import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  saveZapierIntegrationAction,
  testZapierIntegrationAction,
  updateZapierEventsAction,
} from "./actions";
import { EVENT_OPTIONS } from "./event-options";
import {
  ConnectedMeta,
  DisconnectForm,
  describedWithStatus,
  EventCheckboxes,
} from "./integration-parts";

/** The Zapier card: connected controls, or the way in, or the line saying it is not on yet. */
export function ZapierCard({
  t,
  zapier,
  locale,
  timezone,
}: {
  t: StaffTranslator;
  zapier:
    | {
        externalAccountId: string | null;
        externalLabel: string | null;
        connectedAt: Date;
        lastSyncedAt: Date | null;
        status: string;
        settings: { eventTypes?: string[] };
      }
    | undefined;
  locale: string;
  timezone: string;
}) {
  return (
    <SectionCard
      padding="lg"
      title={t("integrations.zapier.name")}
      description={describedWithStatus(t, t("integrations.zapier.description"), zapier)}
    >
      {zapier ? (
        <div className="space-y-5">
          <ConnectedMeta t={t} row={zapier} locale={locale} timezone={timezone} />
          <p className="text-sm text-muted">{t("integrations.zapier.eventsDescription")}</p>
          <FieldGrid as="form" action={updateZapierEventsAction}>
            <EventCheckboxes t={t} selected={zapier.settings.eventTypes ?? []} />
            <FieldActions>
              <SubmitButton
                pendingLabel={t("integrations.common.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("integrations.common.save")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
          <div className="flex flex-wrap items-center gap-3">
            <form action={testZapierIntegrationAction}>
              <SubmitButton
                pendingLabel={t("integrations.zapier.testing")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("integrations.zapier.test")}
              </SubmitButton>
            </form>
            <DisconnectForm provider="zapier" t={t} />
          </div>
        </div>
      ) : (
        <FieldGrid as="form" action={saveZapierIntegrationAction}>
          <Field
            label={t("integrations.zapier.webhookLabel")}
            description={t("integrations.zapier.webhookDescription")}
          >
            <input
              name="webhookUrl"
              className={controlClass}
              placeholder={t("integrations.zapier.webhookPlaceholder")}
              required
            />
          </Field>
          <EventCheckboxes t={t} selected={EVENT_OPTIONS.map((event) => event.value)} />
          <FieldActions>
            <SubmitButton pendingLabel={t("integrations.common.connect")} className={buttonClass()}>
              {t("integrations.zapier.connect")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      )}
    </SectionCard>
  );
}
