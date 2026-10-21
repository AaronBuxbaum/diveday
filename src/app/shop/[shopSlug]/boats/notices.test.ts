import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { boatValidationError } from "./notices";

const t = staffTranslator("en-US");

describe("boatValidationError", () => {
  it.each([
    { notice: "boat-invalid", text: t("boats.boatInvalid") },
    { notice: "boat-radio-invalid", text: t("boats.boatRadioInvalid") },
    { notice: "boat-channel-distress", text: t("boats.boatChannelDistress") },
  ])("places $notice beside the editor it names", ({ notice, text }) => {
    expect(boatValidationError(t, { notice, boat: "new" })).toEqual({ boat: "new", text });
    expect(boatValidationError(t, { notice, boat: "boat-id" })).toEqual({ boat: "boat-id", text });
  });

  it("does not treat a success, an unknown notice or an unscoped refusal as a row error", () => {
    expect(boatValidationError(t, { notice: "boat-updated", boat: "boat-id" })).toBeNull();
    expect(boatValidationError(t, { notice: "constructor", boat: "boat-id" })).toBeNull();
    expect(boatValidationError(t, { notice: "boat-radio-invalid" })).toBeNull();
  });
});
