import { describe, expect, it } from "vitest";
import { DEMO_ROLE_IDS, DEMO_ROLE_KEYS, DEMO_ROLE_META } from "./demo-roles";

/**
 * The in-app switcher and the landing page's picker both read this roster, so
 * the three exports have to agree with each other exactly — the same ids, in
 * the same order, each with its own face and its own three message keys.
 */
describe("the demo roster", () => {
  it("lists every role once, in the order the pickers show them", () => {
    expect(DEMO_ROLE_META.map((role) => role.id)).toEqual([...DEMO_ROLE_IDS]);
    expect(Object.keys(DEMO_ROLE_KEYS).sort()).toEqual([...DEMO_ROLE_IDS].sort());
  });

  it("gives every role a distinct icon and sample person", () => {
    expect(new Set(DEMO_ROLE_META.map((role) => role.icon)).size).toBe(DEMO_ROLE_META.length);
    expect(new Set(DEMO_ROLE_META.map((role) => role.name)).size).toBe(DEMO_ROLE_META.length);
  });

  it("names each role's copy under its own demo.roles.<id> prefix", () => {
    for (const id of DEMO_ROLE_IDS) {
      const keys = DEMO_ROLE_KEYS[id];
      expect(keys.title).toBe(`demo.roles.${id}.title`);
      expect(keys.desc).toBe(`demo.roles.${id}.desc`);
      expect(keys.tryThis).toBe(`demo.roles.${id}.tryThis`);
    }
  });
});
