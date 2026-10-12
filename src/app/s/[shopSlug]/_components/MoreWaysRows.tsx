import { submitInquiryAction } from "@/app/actions/inquiry";
import { DateRequestForm } from "@/components/DateRequestForm";
import { DisclosureRowList } from "@/components/ui/disclosure";
import { dateRequestCopy } from "@/i18n/date-request-copy";
import type { DiverTranslator } from "@/i18n/messages";
import { FindMyBookingForm } from "./FindMyBookingForm";
import { LastMinuteListForm } from "./LastMinuteListForm";

/**
 * **The three asks under the board**, as one group of rows: ask for a date
 * that is not on the board, be told when a seat goes cheap, recover the link
 * to a booking already made. The page owns the section and its heading, and
 * renders it only when at least one row is left in it, inside the provider
 * that carries these rows' namespaces (`src/i18n/provider-coverage.test.ts`
 * looks for it in the page).
 */
export function MoreWaysRows({
  shopSlug,
  quiet,
  dateRequestsEnabled,
  lastMinuteListEnabled,
  everHadDeparture,
  t,
}: {
  shopSlug: string;
  /** The off-season card is up, so its own open composer already carries the date request. */
  quiet: boolean;
  dateRequestsEnabled: boolean;
  lastMinuteListEnabled: boolean;
  /** The shop has run a departure at some point (`everHadDepartureRead`). */
  everHadDeparture: boolean;
  t: DiverTranslator;
}) {
  return (
    <DisclosureRowList className="mt-4">
      {/* The date request is the answer to the question this page
            raises and could not previously answer: the schedule shows the
            dates that exist and stops, so a diver who wants a two-tank on
            the Saturday nobody scheduled had nowhere to go. It is
            deliberately *not* the deal list below it — that one says "tell
            me when a seat frees on a departure that exists", and this one
            says "please create a departure".

            Not gated on `contactEmail`. The request lands in
            `course_inquiries` and staff read it at /shop/<slug>/requests,
            so the shop's email is only needed for the notification — which
            `submitInquiryAction` already skips when there is none.
            Guarding the form on it switched off the one conversion a shop
            with nothing on the books can still make (issue #710).

            The footer four rows below already carries the shop's email and
            phone, so omitting them here prevents duplicate contact lines
            on the same screen (issue #777). */}
      {/* Not while the off-season card is up: the same composer is
            already open above, and two of them would render the same
            `#request-a-date` id twice (N-45). */}
      {/* And not for a shop that switched date requests off (ADR
            20261005-optional-shop-features). */}
      {quiet || !dateRequestsEnabled ? null : (
        <DateRequestForm
          submitRequest={submitInquiryAction.bind(null, shopSlug, null)}
          askInterest
          sectionId="request-a-date"
          contactEmail={null}
          contactPhone={null}
          collapsible
          copy={dateRequestCopy(t, "dive")}
        />
      )}
      {/* The deal list stands down for a shop that has never had a
            departure. It asks a diver to be told when a boat needs to fill
            seats at a discount, and points them at "that trip's own page"
            — on a shop with no boats it collects addresses it will never
            mail, about trips that do not exist (issue #710).
            `everHadDeparture`, not `hasUpcoming`: see above. */}
      {/* Nor for a shop that switched the list off. */}
      {everHadDeparture && lastMinuteListEnabled ? (
        <LastMinuteListForm shopSlug={shopSlug} />
      ) : null}
      {/* Same gate, same reason: a shop that has never had a departure
            cannot have a real booking to recover (issue #723). */}
      {everHadDeparture ? <FindMyBookingForm shopSlug={shopSlug} /> : null}
    </DisclosureRowList>
  );
}
