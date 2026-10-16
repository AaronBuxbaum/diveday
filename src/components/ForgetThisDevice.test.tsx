// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ForgetThisDevice } from "./ForgetThisDevice";
import { keptTypedKey } from "./KeepTypedOnRefusal";
import { recentsStorageKey } from "./search/palette-recents";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("ForgetThisDevice", () => {
  it("clears ⌘K's recents and every kept form when the sign-in page paints", () => {
    window.localStorage.setItem(recentsStorageKey("blue-mantis", "p-1"), "[]");
    window.sessionStorage.setItem(keptTypedKey("walk-in-party", "blue-mantis.p-1"), "{}");
    window.localStorage.setItem("diveday.theme", "dark");
    render(<ForgetThisDevice />);
    expect(window.localStorage.getItem(recentsStorageKey("blue-mantis", "p-1"))).toBeNull();
    expect(
      window.sessionStorage.getItem(keptTypedKey("walk-in-party", "blue-mantis.p-1")),
    ).toBeNull();
    expect(window.localStorage.getItem("diveday.theme")).toBe("dark");
  });
});
