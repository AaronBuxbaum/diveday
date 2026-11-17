import { describe, expect, it } from "vitest";
import { rollCallPlace } from "./trip-frame";

const at = (shown: Parameters<typeof rollCallPlace>[0]["shown"], more = {}) =>
  rollCallPlace({ door: true, editing: false, cancelled: false, shown, ...more });

describe("rollCallPlace", () => {
  it("is the hero only at Check-in and On the water", () => {
    expect(at("checkin")).toBe("hero");
    expect(at("water")).toBe("hero");
    expect(at("filling")).toBe("header");
    expect(at("ready")).toBe("header");
    expect(at("wrapped")).toBe("header");
  });

  it("keeps a quiet door on a cancelled trip and on Edit trip", () => {
    expect(at("water", { cancelled: true })).toBe("header");
    expect(at("checkin", { editing: true })).toBe("header");
  });

  it("waits in More before Roll call has a door", () => {
    expect(at("checkin", { door: false })).toBe("more");
  });
});
