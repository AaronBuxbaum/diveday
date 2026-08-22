// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { NO_CERTIFICATION_ANSWER } from "@/lib/dive-declaration";
import { DiveDeclarationFields } from "./DiveDeclarationFields";

afterEach(cleanup);

/**
 * **The one level question a stranger is asked about their own diving**, on
 * both public opt-in forms (ADR 20260814-self-declared-cards). The nitrox
 * declaration belongs only to the trip-specific wait list.
 *
 * The interesting behaviour is the contradiction it refuses to collect: a
 * joiner who says they hold no card and also ticks "I'm certified for nitrox"
 * has said two incompatible things, and the writer resolves that by recording
 * the absence. The form has to show that it did, or the diver leaves believing
 * they told the shop about an enriched-air card — the same broken promise as
 * asking a question and discarding the answer.
 */
function renderFields(props: { showNitrox?: boolean; locale?: "en-US" | "es-ES" } = {}) {
  const { locale = "en-US", ...fieldProps } = props;
  return render(
    // The same two namespaces the public forms mount it under: `common` for the
    // question, `course` for the level words it shares with the course pages.
    <DiverIntlProvider
      locale={locale}
      timeZone="America/New_York"
      namespaces={["common", "course"]}
    >
      <DiveDeclarationFields {...fieldProps} />
    </DiverIntlProvider>,
  );
}

describe("DiveDeclarationFields", () => {
  it("offers 'not certified yet' above the ladder, and skipping above both", () => {
    renderFields();

    const options = [...screen.getAllByRole("option")].map((option) =>
      option.getAttribute("value"),
    );
    // Skipping stays the default; then no card; then the five rungs in order,
    // so the whole select reads in one direction.
    expect(options.slice(0, 3)).toEqual(["", NO_CERTIFICATION_ANSWER, "open_water"]);
    expect(options).toHaveLength(7);
  });

  it("keeps the level explanation in an accessible info hoverover", () => {
    renderFields();

    expect(
      screen.getByRole("button", { name: "Why we ask about certification" }),
    ).toBeInTheDocument();
    // **What the answer does**, which the sentence used to understate. It read
    // "Helps the shop tell you about trips you can dive" — true while the level
    // was informational, and not since 2026-08-20, when the admission gate
    // started reading it at the sale (ADR
    // 20260820-attested-at-booking-verified-at-boarding). A diver who skipped
    // it because it sounded like marketing skipped the thing that would have
    // told them the boat wants Advanced.
    expect(screen.getByText(/matches this against what each trip asks for/)).toBeInTheDocument();
    // **Permission to answer without the card**, which is the state a diver
    // cannot get from the form: a diver whose card is in another country is the
    // one who abandons the checkout. It says "answer it", not "leave the number
    // blank", because `DiveCardFields` renders only once a level is picked — a
    // sentence naming a box that is not on screen is worse than no sentence.
    expect(screen.getByText(/Answer it even if your card isn't to hand/)).toBeInTheDocument();
    // Two promises this sentence used to carry and no longer does. "Nothing
    // here is checked" stopped being true at the sale; "they'll confirm it
    // against your card" is still true and is still said — by
    // `booking.noAccountNeeded`, on this same page, under the button ("The shop
    // will confirm your certification and rental fit when you arrive"). Saying
    // it twice spent the room the line above needed.
    expect(screen.queryByText(/Nothing here is checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/confirm it against your card/)).not.toBeInTheDocument();
  });

  it("says the same two things in Spanish, and calls the shop el centro", () => {
    // The other half of the string's history: it said "la tienda", which tells
    // a diver their *retail store* will check their certification. The es-ES
    // README settled that a dive shop is "el centro" and `check:shop-word` now
    // refuses the other word — this asserts the rendered sentence, not the
    // bundle, so the two cannot drift apart.
    renderFields({ locale: "es-ES" });

    expect(
      screen.getByText(/El centro compara esto con lo que pide cada salida/),
    ).toBeInTheDocument();
    expect(screen.getByText(/aunque no tengas la certificación a mano/)).toBeInTheDocument();
    expect(screen.queryByText(/tienda/)).not.toBeInTheDocument();
  });

  it("can omit nitrox from the broad deal-list form", () => {
    renderFields({ showNitrox: false });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("clears and disables the nitrox tick when the diver says they hold no card", async () => {
    const user = userEvent.setup();
    renderFields();
    const nitrox = screen.getByRole("checkbox");
    await user.click(nitrox);
    expect(nitrox).toBeChecked();

    await user.selectOptions(screen.getByRole("combobox"), NO_CERTIFICATION_ANSWER);

    // Disabled rather than hidden — the question stays where it was, and a
    // disabled control posts nothing, which is exactly what the writer would
    // have done with the tick anyway.
    expect(nitrox).toBeDisabled();
    expect(nitrox).not.toBeChecked();
  });

  it("gives the tick back when the diver names a level instead", async () => {
    const user = userEvent.setup();
    renderFields();
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, NO_CERTIFICATION_ANSWER);
    await user.selectOptions(select, "rescue");

    const nitrox = screen.getByRole("checkbox");
    expect(nitrox).toBeEnabled();
    // Not silently re-ticked: an unticked box is silence, and a box that ticks
    // itself back on would be the app claiming something nobody said.
    expect(nitrox).not.toBeChecked();
  });
});
