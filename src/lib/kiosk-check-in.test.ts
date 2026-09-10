import { describe, expect, it } from "vitest";
import {
  KIOSK_INPUT_MAX,
  kioskCheckInPath,
  kioskSelection,
  matchableNameTokens,
  readKioskInput,
  surnameOf,
} from "./kiosk-check-in";

describe("kioskCheckInPath", () => {
  it("encodes the token into the segment, so no caller can detach it", () => {
    expect(kioskCheckInPath("abc123")).toBe("/check-in/abc123");
    // A token is base64url in practice, but the encoding is what stops a
    // crafted value from adding a segment or a query of its own.
    expect(kioskCheckInPath("a/b?c=d#e")).toBe("/check-in/a%2Fb%3Fc%3Dd%23e");
  });
});

describe("surnameOf", () => {
  it("takes the last whitespace-separated word, lower-cased", () => {
    expect(surnameOf("Adaeze Nwosu")).toBe("nwosu");
    expect(surnameOf("  priya   SHARMA  ")).toBe("sharma");
    expect(surnameOf("Ana María Ruiz Gómez")).toBe("gómez");
  });

  it("treats a one-word name as its own surname", () => {
    expect(surnameOf("Prince")).toBe("prince");
  });

  it("answers an empty string for an empty name rather than throwing", () => {
    expect(surnameOf("   ")).toBe("");
  });
});

describe("matchableNameTokens", () => {
  /**
   * The defect this rule exists for. Asked for *su apellido*, a diver recorded
   * as "Ana García Márquez" answers *García* — the paternal one — and the
   * tablet used to match only *Márquez*, so in es-ES the box always said no
   * (issue #1610).
   */
  it("finds a two-apellido diver by either apellido", () => {
    expect(matchableNameTokens("Ana García Márquez")).toEqual(["garcía", "márquez"]);
  });

  it("keeps a compound given name out of it", () => {
    // Four words or more means the first two are given names. Without this
    // clause "José" would find her, and compound given names are as ordinary
    // in this market as compound surnames.
    expect(matchableNameTokens("María José García Márquez")).toEqual(["garcía", "márquez"]);
  });

  it("drops the given name of an ordinary two-word name", () => {
    expect(matchableNameTokens("Adaeze Nwosu")).toEqual(["nwosu"]);
    expect(matchableNameTokens("  priya   SHARMA  ")).toEqual(["sharma"]);
  });

  it("carries a tussenvoegsel and a compound surname", () => {
    expect(matchableNameTokens("Jan van der Berg")).toEqual(["der", "berg"]);
    expect(matchableNameTokens("Sara Bell Whitmore")).toEqual(["bell", "whitmore"]);
  });

  it("treats a one-word name as its own surname, and an empty one as nothing", () => {
    expect(matchableNameTokens("Prince")).toEqual(["prince"]);
    expect(matchableNameTokens("   ")).toEqual([]);
  });

  /**
   * The pair that makes the lookup work: what a diver types reduces to its last
   * word, and that word is matched against the whole of this list.
   */
  it("meets surnameOf on whatever the diver types", () => {
    const stored = matchableNameTokens("Ana García Márquez");
    expect(stored).toContain(surnameOf("García"));
    expect(stored).toContain(surnameOf("García Márquez"));
    expect(stored).toContain(surnameOf("Ana García Márquez"));
    expect(stored).not.toContain(surnameOf("Ana"));
  });
});

describe("readKioskInput", () => {
  it("reads a booking reference as a booking, case-folded", () => {
    expect(readKioskInput("A1B2C3D4-1111-4222-8333-444444444444")).toEqual({
      kind: "booking",
      bookingId: "a1b2c3d4-1111-4222-8333-444444444444",
    });
  });

  it("reads anything else as a surname", () => {
    expect(readKioskInput("Adaeze Nwosu")).toEqual({ kind: "surname", surname: "nwosu" });
    expect(readKioskInput("  nwosu ")).toEqual({ kind: "surname", surname: "nwosu" });
  });

  /**
   * Everything unusable is `null`, and the surface answers `null` with the same
   * sentence it answers a miss with. A kiosk that said "that isn't a name"
   * would be telling whoever typed it something about the shape of the lookup.
   */
  it("refuses a non-string, a blank, and an answer longer than the box allows", () => {
    expect(readKioskInput(undefined)).toBeNull();
    expect(readKioskInput(null)).toBeNull();
    expect(readKioskInput(42)).toBeNull();
    expect(readKioskInput(new File([], "x"))).toBeNull();
    expect(readKioskInput("")).toBeNull();
    expect(readKioskInput("   ")).toBeNull();
    expect(readKioskInput("n".repeat(KIOSK_INPUT_MAX + 1))).toBeNull();
    // The boundary itself is allowed.
    expect(readKioskInput("n".repeat(KIOSK_INPUT_MAX))).not.toBeNull();
  });
});

/**
 * **One match is an answer; none and several are the same answer.**
 *
 * The security shape of the surface, not a convenience. A tablet in a lobby is
 * operated by whoever walks up to it, so an outcome that varied with how many
 * people called Nwosu are on today's boats would tell a stranger something
 * about the shop's divers. It is also the right operational answer: two divers
 * sharing a surname is exactly the case a staffer resolves by looking at a
 * person, and a tablet guessing would put an arrival on the wrong record.
 */
describe("kioskSelection", () => {
  it("answers with the one match", () => {
    expect(kioskSelection(["only"])).toBe("only");
  });

  it("answers null for no match and for several alike", () => {
    expect(kioskSelection([])).toBeNull();
    expect(kioskSelection(["one", "two"])).toBeNull();
    expect(kioskSelection(["one", "two", "three"])).toBeNull();
  });
});
