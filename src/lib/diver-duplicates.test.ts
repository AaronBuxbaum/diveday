import { describe, expect, it } from "vitest";
import {
  diverDuplicateReasons,
  emailMatchKey,
  matchRestsOnNameAlone,
  phoneMatchKey,
} from "./diver-duplicates";

const base = { fullName: "Maya Rivera", email: null, phone: null, dateOfBirth: null };

describe("emailMatchKey", () => {
  it("folds case and spacing, and nothing else", () => {
    expect(emailMatchKey(" Maya.Rivera@Example.com ")).toBe("maya.rivera@example.com");
    expect(emailMatchKey("maya.rivera@example.com")).not.toBe(
      emailMatchKey("mayarivera@example.com"),
    );
  });

  it("never folds a plus tag: a family booked as parent+kid@ is several people", () => {
    expect(emailMatchKey("ana+kid@example.com")).not.toBe(emailMatchKey("ana@example.com"));
    expect(emailMatchKey("success+priya@simulator.amazonses.com")).not.toBe(
      emailMatchKey("success+tom@simulator.amazonses.com"),
    );
  });

  it("answers null for nothing usable", () => {
    expect(emailMatchKey(null)).toBeNull();
    expect(emailMatchKey("")).toBeNull();
    expect(emailMatchKey("no-at-sign")).toBeNull();
    expect(emailMatchKey("@example.com")).toBeNull();
    expect(emailMatchKey("+tag@example.com")).toBe("+tag@example.com");
  });
});

describe("phoneMatchKey", () => {
  it("compares digits and ignores a stub too short to mean anything", () => {
    expect(phoneMatchKey("+1 (305) 555-0142")).toBe("13055550142");
    expect(phoneMatchKey("12")).toBeNull();
  });
});

describe("diverDuplicateReasons", () => {
  it("names one address written with different case", () => {
    expect(
      diverDuplicateReasons(
        { ...base, fullName: "M Rivera", email: "Maya.Rivera@Example.com" },
        { ...base, fullName: "Maya R", email: "maya.rivera@example.com " },
      ),
    ).toEqual(["same_email"]);
  });

  it("does not call a parent and a child on plus-tagged addresses the same email", () => {
    expect(
      diverDuplicateReasons(
        { ...base, fullName: "Ana Sol", email: "ana@example.com" },
        { ...base, fullName: "Leo Sol", email: "ana+leo@example.com" },
      ),
    ).toEqual([]);
  });

  it("names a phone match", () => {
    expect(
      diverDuplicateReasons(
        { ...base, fullName: "A", phone: "+1 305 555 0142" },
        { ...base, fullName: "B", phone: "1 (305) 555-0142" },
      ),
    ).toEqual(["same_phone"]);
  });

  it("strengthens a name match with the same birth date", () => {
    expect(
      diverDuplicateReasons(
        { ...base, dateOfBirth: "1990-04-02" },
        { ...base, fullName: "maya  rivera", dateOfBirth: "1990-04-02" },
      ),
    ).toEqual(["same_name_and_birth_date"]);
  });

  it("never offers a name alone, with a date missing on one side", () => {
    expect(diverDuplicateReasons({ ...base, dateOfBirth: "1990-04-02" }, base)).toEqual([]);
    expect(diverDuplicateReasons(base, base)).toEqual([]);
  });

  it("offers a name with a date missing once the phone agrees too", () => {
    expect(
      diverDuplicateReasons(
        { ...base, phone: "305 555 0142", dateOfBirth: "1990-04-02" },
        { ...base, phone: "305-555-0142" },
      ),
    ).toEqual(["same_phone", "same_name"]);
  });

  it("never offers a namesake with a different birth date on the name", () => {
    expect(
      diverDuplicateReasons(
        { ...base, dateOfBirth: "1968-01-10" },
        { ...base, dateOfBirth: "2012-06-30" },
      ),
    ).toEqual([]);
  });

  it("still offers the namesake on a shared phone, where the phone is the evidence", () => {
    expect(
      diverDuplicateReasons(
        { ...base, phone: "305 555 0142", dateOfBirth: "1968-01-10" },
        { ...base, phone: "305-555-0142", dateOfBirth: "2012-06-30" },
      ),
    ).toEqual(["same_phone"]);
  });

  it("finds nothing between two strangers", () => {
    expect(
      diverDuplicateReasons(
        { ...base, email: "a@example.com" },
        { ...base, fullName: "Jules Other", email: "b@example.com" },
      ),
    ).toEqual([]);
  });
});

describe("matchRestsOnNameAlone", () => {
  it("is true for one name with no contact in common", () => {
    expect(
      matchRestsOnNameAlone(
        { ...base, email: "ana@example.com" },
        { ...base, email: "ana+kid@example.com" },
      ),
    ).toBe(true);
  });

  it("is false once a phone agrees, and for two different names", () => {
    expect(
      matchRestsOnNameAlone(
        { ...base, phone: "+1 305 555 0142" },
        { ...base, phone: "1 305 555 0142" },
      ),
    ).toBe(false);
    expect(matchRestsOnNameAlone(base, { ...base, fullName: "Carmen Diaz" })).toBe(false);
  });
});
