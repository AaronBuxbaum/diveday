// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillFormFields } from "@/components/assists/fill-form";
import { SMS_CONSENT_ONCE_FILLED } from "@/components/SmsConsentNote";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import en from "@/i18n/locales/en-US/diver.json";
import { SELF_REGISTRATION_DONE } from "@/lib/self-registration";
import { RegisterForm } from "./RegisterForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RegisterForm card photo", () => {
  it("says so beside the button when the card read comes back empty", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 10, height: 10, close: () => {} })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,AAAA",
    );
    const read = vi.fn(async () => null);
    const { container } = render(
      <DiverIntlProvider
        locale="en-US"
        timeZone="America/New_York"
        namespaces={["register", "common", "course"]}
      >
        <RegisterForm action={vi.fn()} shopName="Blue Mantis" readCardPhoto={read} />
      </DiverIntlProvider>,
    );
    expect(screen.queryByText(en.register.cardPhotoNothing)).toBeNull();
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!file) throw new Error("card photo input missing");
    fireEvent.change(file, {
      target: { files: [new File(["x"], "card.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(screen.getByText(en.register.cardPhotoNothing)).toBeVisible());
    expect(read).toHaveBeenCalledWith({ data: "AAAA", mediaType: "image/jpeg" });
  });
});

/**
 * Visual review 2026-10-24, B22: the SMS consent shows once a number is in the
 * box. Its words are always in the server HTML, hidden by CSS while the box is
 * empty, so a no-JS submit still carried them (H-20260724-channel-sends-booking-waiver).
 */
describe("RegisterForm SMS consent", () => {
  const consent = /you agree to texts from DiveDay/i;
  const form = (
    <DiverIntlProvider
      locale="en-US"
      timeZone="America/New_York"
      namespaces={["register", "common", "course"]}
    >
      <RegisterForm action={vi.fn()} shopName="Blue Mantis" />
    </DiverIntlProvider>
  );

  it("puts the consent's words in the server HTML before any number is typed", () => {
    expect(renderToStaticMarkup(form)).toMatch(consent);
  });

  it("hides them by CSS while the phone box is empty", () => {
    render(form);
    const phone = document.querySelector<HTMLInputElement>("input#phone");
    if (!phone) throw new Error("phone input missing");
    expect(phone).toHaveAttribute("placeholder", " ");
    const note = screen.getByText(consent).closest("[id$='-description']");
    // A sibling of the input inside the Field that carries the CSS reveal.
    expect(note?.previousElementSibling).toBe(phone);
    expect(note?.parentElement?.parentElement).toHaveClass(SMS_CONSENT_ONCE_FILLED);
    expect(phone.getAttribute("aria-describedby")).toContain(note?.id);
  });
});

describe("RegisterForm mounted certification fields", () => {
  const form = (
    action: Parameters<typeof RegisterForm>[0]["action"] = vi.fn(async () => ({
      error: "Refused",
    })),
  ) => (
    <DiverIntlProvider
      locale="en-US"
      timeZone="America/New_York"
      namespaces={["register", "common", "course"]}
    >
      <RegisterForm action={action} shopName="Reef" />
    </DiverIntlProvider>
  );
  it("keeps photo-fill targets and the uncertified state in the server HTML", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain('name="agency"');
    expect(html).toContain('name="level"');
    expect(html).toContain('name="identifier"');
    expect(html).toContain(en.register.uncertified);
    expect(html).not.toContain('required="" name="level"');
  });
  it("retains certification edits through agency backtracking and a server refusal", async () => {
    const { container } = render(form());
    const agency = screen.getByLabelText(en.register.agencyLabel);
    const level = screen.getByLabelText(en.register.levelLabel);
    const number = screen.getByLabelText(en.register.identifierLabel);
    fireEvent.change(agency, { target: { value: "padi" } });
    fireEvent.change(level, { target: { value: "rescue" } });
    fireEvent.change(number, { target: { value: "P-123" } });
    fireEvent.change(agency, { target: { value: "" } });
    fireEvent.change(agency, { target: { value: "padi" } });
    expect(level).toHaveValue("rescue");
    expect(number).toHaveValue("P-123");
    const target = container.querySelector("form");
    if (!target) throw new Error("Registration form was not rendered");
    fireEvent.submit(target);
    await screen.findByText("Refused");
    expect(agency).toHaveValue("padi");
    expect(level).toHaveValue("rescue");
    expect(number).toHaveValue("P-123");
  });
  it("replaces the form with the generic receipt after a successful registration", async () => {
    const action = vi.fn(async () => ({ status: SELF_REGISTRATION_DONE }));
    const { container } = render(form(action));
    const target = container.querySelector("form");
    if (!target) throw new Error("Registration form was not rendered");
    fireEvent.change(screen.getByLabelText(en.register.agencyLabel), { target: { value: "padi" } });
    fireEvent.change(screen.getByLabelText(en.register.levelLabel), {
      target: { value: "rescue" },
    });
    fireEvent.submit(target);
    await screen.findByRole("heading", { name: en.register.doneTitle });
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector("form")).toBeNull();
  });
  it("lets the real photo-fill path populate targets that began hidden", () => {
    const { container } = render(form());
    const target = container.querySelector("form");
    if (!target) throw new Error("Registration form was not rendered");
    const values = { agency: "ssi", level: "advanced_open_water", identifier: "SSI-77" };
    // The same native setters/events the photo assist invokes.
    fireEvent.change(screen.getByLabelText(en.register.agencyLabel), { target: { value: "" } });
    act(() => {
      expect(fillFormFields(target, values)).toBe(3);
    });
    for (const [key, value] of Object.entries(values))
      expect(new FormData(target).get(key)).toBe(value);
  });
});
