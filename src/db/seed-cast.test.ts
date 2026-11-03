import { describe, expect, it } from "vitest";
import { buildCast, customerDefs } from "./seed-cast";

const rows = customerDefs.map((def, i) => ({ id: `p${i}`, fullName: def.fullName }));

describe("buildCast", () => {
  // These handles replaced positional `customers[n]` reads. The slots they
  // resolve to are what the seed produced before, so the demo's rows are
  // unchanged; a reorder of `customerDefs` now moves the slot, not the person.
  it("finds each named diver where the positional reads used to land", () => {
    const cast = buildCast(rows);
    expect(cast.priya.id).toBe("p0");
    expect(cast.tom.id).toBe("p1");
    expect(cast.lena.id).toBe("p2");
    expect(cast.june.id).toBe("p4");
    expect(cast.amara.id).toBe("p10");
    expect(cast.felix.id).toBe("p11");
    expect(cast.hana.id).toBe("p12");
  });

  it("finds by name, not position", () => {
    const [first, ...rest] = rows;
    const cast = buildCast([...rest, first as (typeof rows)[number]]);
    expect(cast.priya.id).toBe("p0");
    expect(cast.slot(0)?.id).toBe("p1");
  });

  it("refuses a roster that lacks a named diver", () => {
    expect(() => buildCast(rows.filter((r) => r.fullName !== "Hana Kobayashi"))).toThrow(
      /Hana Kobayashi/,
    );
  });

  it("returns undefined for a slot past the end", () => {
    expect(buildCast(rows).slot(rows.length)).toBeUndefined();
  });
});
