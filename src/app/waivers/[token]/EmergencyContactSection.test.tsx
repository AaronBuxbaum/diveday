// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { EmergencyContactSection } from "./EmergencyContactSection";
import { WAIVER_FIELD_ERROR } from "./waiver-fields";

afterEach(cleanup);

const t = diverTranslator("en-US");

describe("EmergencyContactSection", () => {
  it("asks for a contact when nothing is on file", () => {
    render(<EmergencyContactSection emergencyContact={null} namedFieldError={undefined} t={t} />);
    expect(screen.getByText(t("waiver.emergencyContactDescription"))).toBeTruthy();
    expect((document.getElementById("emergencyContactName") as HTMLInputElement).value).toBe("");
  });

  it("names the contact on file, number whole, and keeps the boxes editable", () => {
    const { container } = render(
      <EmergencyContactSection
        emergencyContact={{ name: "Asha Sharma", phone: "+1-305-555-0231" }}
        namedFieldError={undefined}
        t={t}
      />,
    );
    expect(container.querySelector(".whitespace-nowrap")?.textContent).toBe("+1-305-555-0231");
    expect((document.getElementById("emergencyContactPhone") as HTMLInputElement).value).toBe(
      "+1-305-555-0231",
    );
  });

  it("puts a refusal under the box it names", () => {
    render(
      <EmergencyContactSection
        emergencyContact={null}
        namedFieldError={WAIVER_FIELD_ERROR.emergencyContactPhone}
        t={t}
      />,
    );
    expect(screen.getByText(t("waiver.errorContactPair"))).toBeTruthy();
    expect(document.getElementById("emergencyContactPhone")?.getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});
