import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { getIntegrationSettingsPage, squareLocationsForShop } from "@/features/integrations";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { chooseSquareLocationAction, startSquareConnectionAction } from "./actions";
import { DisconnectForm } from "./integration-parts";

type Summary = Awaited<ReturnType<typeof getIntegrationSettingsPage>>["summaries"][number];
export function SquareCard({
  row,
  locations,
  t,
  configured,
}: {
  row?: Summary;
  locations: Awaited<ReturnType<typeof squareLocationsForShop>>;
  t: StaffTranslator;
  configured: boolean;
}) {
  if (!row && !configured) return null;
  return (
    <SectionCard
      padding="lg"
      title={t("integrations.square.name")}
      description={t("integrations.square.description")}
    >
      {row ? (
        <div className="space-y-5">
          {row.settings.squareLocationName ? (
            <p className="text-sm">
              {t("integrations.square.selected", { name: row.settings.squareLocationName })}
            </p>
          ) : null}
          {row.settings.environment === "sandbox" ? (
            <p className="text-sm text-muted">{t("integrations.square.sandbox")}</p>
          ) : null}
          {locations?.length ? (
            <FieldGrid as="form" action={chooseSquareLocationAction}>
              <Field
                label={t("integrations.square.location")}
                description={t("integrations.square.locationHelp")}
              >
                <select
                  name="locationId"
                  className={controlClass}
                  defaultValue={row.settings.squareLocationId ?? ""}
                  required
                >
                  <option value="" disabled>
                    {t("integrations.square.chooseLocation")}
                  </option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </Field>
              <FieldActions>
                <SubmitButton
                  className={buttonClass({ variant: "secondary" })}
                  pendingLabel={t("words.busy.saving")}
                >
                  {t("integrations.common.save")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          ) : (
            <p className="text-sm text-muted">
              {t(
                !configured
                  ? "integrations.notice.not-configured"
                  : locations
                    ? "integrations.square.noLocations"
                    : "integrations.square.unavailable",
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <form action={startSquareConnectionAction}>
              <SubmitButton
                className={buttonClass({ variant: "secondary" })}
                disabled={!configured}
                pendingLabel={t("integrations.common.connect")}
              >
                {t("integrations.square.reconnect")}
              </SubmitButton>
            </form>
            <DisconnectForm provider="square" t={t} />
          </div>
        </div>
      ) : (
        <form action={startSquareConnectionAction}>
          <SubmitButton className={buttonClass()} pendingLabel={t("integrations.common.connect")}>
            {t("integrations.square.connect")}
          </SubmitButton>
        </form>
      )}
    </SectionCard>
  );
}
