import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldActions, FormStatus, SearchField } from "@/components/ui/form";
import type { listDiverSummaries } from "@/db/divers";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { diverSearchPrefill } from "@/lib/person-fields";
import { addCounterRentalPersonAction } from "../../actions";
import { counterRentalFormPath } from "../../rental-form";

/**
 * **Who the gear goes to** — the rent-out form's first step. The person chosen,
 * with a way to change them; or a search over the shop's people (asked first,
 * so one person is not split in two), then, once something was searched for,
 * the roster's own add-a-person fields prefilled from the search.
 */
export function RentalPersonStep({
  t,
  shopSlug,
  person,
  query,
  matches,
  from,
  until,
  whoNotice,
}: {
  t: StaffTranslator;
  shopSlug: string;
  person: { id: string; fullName: string; email: string | null } | null;
  query: string;
  matches: Awaited<ReturnType<typeof listDiverSummaries>> | null;
  from: string;
  until: string;
  whoNotice?: string;
}) {
  const prefill = diverSearchPrefill(query);
  return (
    <SectionCard title={t("counterRentals.new.whoHeading")}>
      {person ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p>
            <span className="font-medium">{person.fullName}</span>
            {person.email ? <span className="text-muted"> · {person.email}</span> : null}
          </p>
          <Link
            href={counterRentalFormPath(shopSlug, { from, until })}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("counterRentals.new.change")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <form method="get" className="flex flex-col gap-3 sm:flex-row">
            <SearchField
              id="rental-person-search"
              name="q"
              label={t("seatDiver.findLabel")}
              placeholder={t("seatDiver.findPlaceholder")}
              defaultValue={query}
              className="flex-1"
            />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="until" value={until} />
            <button type="submit" className={buttonClass({ variant: "secondary" })}>
              {t("seatDiver.findHeading")}
            </button>
          </form>
          {matches ? (
            matches.divers.length > 0 ? (
              <ul className="divide-y divide-border">
                {matches.divers.map((match) => (
                  <li
                    key={match.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
                  >
                    <p className="min-w-0">
                      <span className="font-medium">{match.fullName}</span>
                      <span className="text-sm text-muted">
                        {" · "}
                        {match.email ?? t("seatDiver.noEmailOnFile")}
                      </span>
                    </p>
                    <Link
                      href={counterRentalFormPath(shopSlug, {
                        personId: match.id,
                        from,
                        until,
                      })}
                      aria-label={t("counterRentals.new.pickAria", { name: match.fullName })}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("counterRentals.new.pick")}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("seatDiver.noMatches", { query })}</p>
            )
          ) : null}
          {query ? (
            <div>
              <h3 className="text-sm font-medium">{t("seatDiver.handEntryHeading")}</h3>
              <PersonFieldTrio
                as="form"
                action={addCounterRentalPersonAction}
                email="optional"
                nameLabel={t("seatDiver.nameLabel")}
                emailLabel={t("seatDiver.emailLabel")}
                phoneLabel={t("seatDiver.phoneLabel")}
                optionalHint={t("seatDiver.optionalHint")}
                defaultValues={{ fullName: prefill.name, email: prefill.email }}
                className="mt-3"
              >
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("seatDiver.adding")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("counterRentals.new.addPerson")}
                  </SubmitButton>
                </FieldActions>
              </PersonFieldTrio>
            </div>
          ) : null}
          <FormStatus tone="danger">{whoNotice}</FormStatus>
        </div>
      )}
    </SectionCard>
  );
}
