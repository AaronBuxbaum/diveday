import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "@/lib/authz";
import { DIVER_LOCALES } from "./settings";
import { staffTranslator } from "./staff-messages";
import {
  isRole,
  STAFF_ROLE_LABEL_KEYS,
  staffRoleLabel,
  staffRoleLabels,
} from "./staff-role-labels";

/**
 * The boat manifest rendered `member.roles.join(", ")` straight out of
 * `effectiveCrewRoles` for as long as every role code happened to be one
 * lowercase English word. `assistant_instructor` is the first that reads as a
 * database value, and the roll-call sheet is the document that goes ashore
 * (issue #1680).
 */
describe("staff role labels", () => {
  for (const locale of DIVER_LOCALES) {
    it(`gives every role a word that is not its code (${locale})`, () => {
      const t = staffTranslator(locale);
      for (const role of ALL_ROLES) {
        const label = t(STAFF_ROLE_LABEL_KEYS[role]);
        expect([role, label]).not.toEqual([role, role]);
        // The thing the manifest would have printed: no underscores, and a
        // capital at the front, because this is a name rather than an enum.
        expect([role, label.includes("_")]).toEqual([role, false]);
        expect([role, label[0]]).toEqual([role, label[0]?.toUpperCase()]);
      }
    });
  }

  it("passes an unrecognised code through rather than dropping the crew member", () => {
    const t = staffTranslator("en-US");
    // Cannot happen through the schema. A role that silently vanished off a
    // roll-call sheet would be worse than one that reads oddly.
    expect(staffRoleLabel(t, "deckhand")).toBe("deckhand");
    expect(isRole("deckhand")).toBe(false);
    expect(isRole("assistant_instructor")).toBe(true);
  });

  it("keeps a person's roles in the order they were given", () => {
    const t = staffTranslator("en-US");
    expect(staffRoleLabels(t, ["captain", "assistant_instructor"])).toEqual([
      t(STAFF_ROLE_LABEL_KEYS.captain),
      t(STAFF_ROLE_LABEL_KEYS.assistant_instructor),
    ]);
  });
});
