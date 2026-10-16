import { describe, expect, it } from "vitest";
import {
  fillSavedAnswer,
  SAVED_ANSWER_TITLE_MAX,
  savedAnswerTitle,
  withNameMarker,
} from "./saved-answers";

describe("withNameMarker", () => {
  it("swaps the diver's first name for the marker, so the answer is about nobody", () => {
    expect(withNameMarker("Hi Lena, park behind the shop.", "Lena Ortiz")).toBe(
      "Hi {name}, park behind the shop.",
    );
  });

  it("swaps the whole name first, and every mention", () => {
    expect(withNameMarker("Lena Ortiz is set. Thanks, Lena!", "Lena Ortiz")).toBe(
      "{name} is set. Thanks, {name}!",
    );
  });

  it("leaves a word that only contains the name alone", () => {
    expect(withNameMarker("Ana, the cabana is open.", "Ana Ruiz")).toBe(
      "{name}, the cabana is open.",
    );
  });

  it("matches the name however it was capitalized, accents included", () => {
    expect(withNameMarker("Hola josé, te esperamos.", "José Pérez")).toBe(
      "Hola {name}, te esperamos.",
    );
  });

  it("takes out an email address and a phone number, which belong to somebody", () => {
    expect(
      withNameMarker(
        "Hi Lena, write to dr.patel@clinic.example or call +1 (305) 555-0177 before 7:15.",
        "Lena Ortiz",
      ),
    ).toBe("Hi {name}, write to or call before 7:15.");
    expect(withNameMarker("Text 305.555.0177, not 2 tanks at $45.", "Lena Ortiz")).toBe(
      "Text, not 2 tanks at $45.",
    );
    expect(withNameMarker("Your slot is 2026-10-18.", "Lena Ortiz")).toBe(
      "Your slot is 2026-10-18.",
    );
  });

  it("does nothing without a name", () => {
    expect(withNameMarker("Park behind the shop.", "  ")).toBe("Park behind the shop.");
  });
});

describe("fillSavedAnswer", () => {
  it("fills the name and the trip", () => {
    expect(
      fillSavedAnswer("Hi {name}, see you on {trip}.", {
        name: "Lena",
        trip: "Reef Morning on Oct 18 at 8:00 AM",
      }),
    ).toBe("Hi Lena, see you on Reef Morning on Oct 18 at 8:00 AM.");
  });

  it("leaves a marker it has nothing for, so the reader sees it before sending", () => {
    expect(fillSavedAnswer("See you on {trip}.", { name: "Lena", trip: null })).toBe(
      "See you on {trip}.",
    );
  });
});

describe("savedAnswerTitle", () => {
  it("is the first line", () => {
    expect(savedAnswerTitle("Parking\nBehind the shop, by the tanks.")).toBe("Parking");
  });

  it("is cut at a word with an ellipsis when the line is long", () => {
    const title = savedAnswerTitle(
      "We do rent 5mm wetsuits in a women's medium, and I can put one aside for you",
    );
    expect(title.length).toBeLessThanOrEqual(SAVED_ANSWER_TITLE_MAX);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain(" …");
  });

  it("names a marker by its word rather than its braces", () => {
    expect(savedAnswerTitle("Hi {name}, park behind the shop.")).toBe("Hi, park behind the shop.");
  });
});
