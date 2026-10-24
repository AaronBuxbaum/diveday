// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** Visual review 2026-10-24, B22: the SMS consent appears once a number is typed. */
describe("RegisterForm SMS consent", () => {
  it("reveals the consent's unchanged words on phone entry", () => {
    render(
      <DiverIntlProvider
        locale="en-US"
        timeZone="America/New_York"
        namespaces={["register", "common", "course"]}
      >
        <RegisterForm action={vi.fn()} shopName="Blue Mantis" />
      </DiverIntlProvider>,
    );
    const consent = /you agree to texts from DiveDay/i;
    expect(screen.queryByText(consent)).toBeNull();
    const phone = document.querySelector<HTMLInputElement>("input#phone");
    if (!phone) throw new Error("phone input missing");
    fireEvent.input(phone, { target: { value: "+1 305 555 0142" } });
    expect(screen.getByText(consent)).toBeInTheDocument();
  });
});
