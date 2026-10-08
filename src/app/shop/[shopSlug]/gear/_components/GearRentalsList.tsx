import Link from "next/link";
import { Pager, staffPagerWords } from "@/components/Pager";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { GearRentalMoney, GearRentalsPage, GearRentalUnit } from "@/db/gear-rentals";
import { gearItemKindLabel, gearPhaseLabel } from "@/i18n/gear-labels";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDateRange } from "@/lib/format";
import type { GearRental, OpenRentalPhase } from "@/lib/gear-rentals";
import { rentalPhaseLapsed } from "@/lib/gear-rentals";
import { shopPath } from "@/lib/staff-notices";
import {
  PAYMENT_STATUS_KEYS,
  PAYMENT_STATUS_TONES,
} from "../../divers/[personId]/_components/shared";

/**
 * **The register's Rentals view** — every open rental, trip and counter alike,
 * under the person who holds it (plan `rental-tracking`, layer 2).
 *
 * The register's groups answer "where is this unit?"; this answers the
 * counter's question from the other side: who has our gear, until when, and
 * have they paid. One row per rental — the set a holder took under one booking
 * or over the counter — because that is the unit a desk hands over, chases and
 * prints a ticket for. Its units ride the row as their own doors, and a unit
 * whose state differs from its set's says so beside its tag.
 *
 * The state words are the register's own (`gearPhaseLabel`), and the lapsed
 * two carry the register's warning ink and drawn mark, so a unit reads the
 * same here as on its register row. The money word is the diver record's
 * (`ORDER_STATUS_KEYS`, `PAYMENT_STATUS_KEYS`), read in the same order: the
 * booking's order, else its payment row, else nothing at all — nothing is owed
 * until something is raised.
 *
 * A Server Component that takes its words as props, so it renders in a jsdom
 * test without the database behind it.
 */
export function GearRentalsList({
  page,
  shopSlug,
  t,
  locale,
  pageHref,
}: {
  page: GearRentalsPage;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  pageHref: (target: number) => string;
}) {
  return (
    <div className="mt-6 space-y-8">
      {page.rows.map((holder) => {
        const headingId = `rental-holder-${holder.personId}`;
        return (
          <LedgerGroup
            key={holder.personId}
            as="h2"
            id={headingId}
            label={
              <Link
                href={shopPath(shopSlug, "divers", holder.personId)}
                className="text-sm normal-case tracking-normal text-foreground hover:underline"
              >
                {holder.name}
              </Link>
            }
          >
            <ul aria-labelledby={headingId}>
              {holder.rentals.map((rental) => (
                <RentalRow
                  key={rental.key}
                  rental={rental}
                  holderName={holder.name}
                  shopSlug={shopSlug}
                  t={t}
                  locale={locale}
                />
              ))}
            </ul>
          </LedgerGroup>
        );
      })}
      <Pager
        page={page.page}
        pageCount={page.pageCount}
        href={pageHref}
        total={t("gearRentals.pagination.total", { count: page.total })}
        words={staffPagerWords(t)}
      />
    </div>
  );
}

function RentalRow({
  rental,
  holderName,
  shopSlug,
  t,
  locale,
}: {
  rental: GearRental<GearRentalUnit>;
  holderName: string;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
}) {
  const [first] = rental.units;
  const trip =
    first?.tripId && first.tripTitle ? { id: first.tripId, title: first.tripTitle } : null;
  const money = first?.money ?? null;
  const ticketHref =
    trip && rental.bookingId
      ? shopPath(shopSlug, "trips", trip.id, "prep", "ticket", rental.bookingId)
      : null;

  return (
    <LedgerRow
      align="first-line"
      pad="lg"
      trailing={
        ticketHref ? (
          <Link
            href={ticketHref}
            aria-label={t("gearRentals.ticketFor", { name: holderName })}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            {t("gear.prep.ticketDoor")}
          </Link>
        ) : null
      }
    >
      <div className="min-w-0 space-y-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="min-w-0">
            <FactLine
              facts={[
                {
                  value: trip ? (
                    <Link
                      href={shopPath(shopSlug, "trips", trip.id)}
                      className="font-medium hover:underline"
                    >
                      {trip.title}
                    </Link>
                  ) : (
                    t("gearRentals.counter")
                  ),
                  className: trip ? undefined : "font-medium",
                  wraps: true,
                },
                formatCalendarDateRange(rental.from, rental.until, locale),
              ]}
            />
          </span>
          <PhaseWord phase={rental.phase} t={t} />
          {money ? <MoneyWord money={money} t={t} /> : null}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {rental.units.map((unit) => (
            <li key={unit.reservationId} className="flex min-w-0 items-baseline gap-1.5">
              <Link
                href={shopPath(shopSlug, "gear", unit.gearItemId)}
                className="font-mono font-medium hover:underline"
              >
                {unit.label}
              </Link>
              <span className="text-muted">
                {[gearItemKindLabel(t, unit.kind), unit.size].filter(Boolean).join(" · ")}
              </span>
              {unit.phase !== rental.phase ? <PhaseWord phase={unit.phase} t={t} /> : null}
            </li>
          ))}
        </ul>
      </div>
    </LedgerRow>
  );
}

/** The register's state word, in the register's ink: the lapsed two warn, with a drawn mark. */
function PhaseWord({ phase, t }: { phase: OpenRentalPhase; t: StaffTranslator }) {
  if (rentalPhaseLapsed(phase)) {
    return (
      <span className="inline-flex items-baseline gap-1.5 font-medium text-warning-strong">
        <span className="flex h-lh shrink-0 items-center self-start">
          <DiveDayIcon name="warning" className="size-4 shrink-0" />
        </span>
        <span>{gearPhaseLabel(t, phase)}</span>
      </span>
    );
  }
  return (
    <span className={phase === "due_back_today" ? "font-medium" : "text-muted"}>
      {gearPhaseLabel(t, phase)}
    </span>
  );
}

function MoneyWord({ money, t }: { money: GearRentalMoney; t: StaffTranslator }) {
  const { key, tone } =
    money.source === "order"
      ? { key: ORDER_STATUS_KEYS[money.status], tone: ORDER_STATUS_TONES[money.status] }
      : { key: PAYMENT_STATUS_KEYS[money.status], tone: PAYMENT_STATUS_TONES[money.status] };
  return (
    <Badge tone={tone} size="sm">
      {t(key)}
    </Badge>
  );
}
