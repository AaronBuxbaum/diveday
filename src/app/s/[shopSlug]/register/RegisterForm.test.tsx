// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SMS_CONSENT_ONCE_FILLED } from "@/components/SmsConsentNote";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import en from "@/i18n/locales/en-US/diver.json";
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
 * empty, so a no-JS submit still carried them (H-09).
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
