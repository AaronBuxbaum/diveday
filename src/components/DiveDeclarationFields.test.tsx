// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { NO_CERTIFICATION_ANSWER } from "@/lib/certification-options";
import { DiveCertificationField } from "./DiveDeclarationFields";

afterEach(cleanup);

function renderField(locale: "en-US" | "es-ES" = "en-US") {
  return render(
    <DiverIntlProvider
      locale={locale}
      timeZone="America/New_York"
      namespaces={["common", "course"]}
    >
      <DiveCertificationField />
    </DiverIntlProvider>,
  );
}

describe("DiveCertificationField", () => {
  it("renders an optional level select with its default and established option order", () => {
    renderField();

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("");
    expect(select).not.toBeRequired();
    expect(select).toHaveAttribute("name", "certificationLevel");
    expect(
      [...screen.getAllByRole("option")].map((option) => option.getAttribute("value")),
    ).toEqual([
      "",
      NO_CERTIFICATION_ANSWER,
      "open_water",
      "advanced_open_water",
      "rescue",
      "divemaster",
      "instructor",
    ]);
  });

  it("keeps the accessible certification explanation", () => {
    renderField();

    expect(
      screen.getByRole("button", { name: "Why we ask about certification" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/matches this against what each trip asks for/)).toBeInTheDocument();
    expect(screen.getByText(/Answer it even if your card isn’t to hand/)).toBeInTheDocument();
  });

  it("uses the established Spanish wording", () => {
    renderField("es-ES");

    expect(
      screen.getByText(/El centro compara esto con lo que pide cada salida/),
    ).toBeInTheDocument();
    expect(screen.getByText(/aunque no tengas la certificación a mano/)).toBeInTheDocument();
    expect(screen.queryByText(/tienda/)).not.toBeInTheDocument();
  });
});
