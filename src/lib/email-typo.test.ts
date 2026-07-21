import { describe, expect, it } from "vitest";
import { suggestEmailTypo } from "./email-typo";

describe("suggestEmailTypo", () => {
  it("catches a one-edit slip in a common domain", () => {
    expect(suggestEmailTypo("avery@gmial.com")).toBe("avery@gmail.com");
    expect(suggestEmailTypo("avery@gmai.com")).toBe("avery@gmail.com");
    expect(suggestEmailTypo("avery@gmaill.com")).toBe("avery@gmail.com");
    expect(suggestEmailTypo("avery@gnail.com")).toBe("avery@gmail.com");
    expect(suggestEmailTypo("avery@hotmial.com")).toBe("avery@hotmail.com");
    expect(suggestEmailTypo("avery@yahooo.com")).toBe("avery@yahoo.com");
    expect(suggestEmailTypo("avery@outlok.com")).toBe("avery@outlook.com");
  });

  it("catches obvious TLD slips on a known provider", () => {
    expect(suggestEmailTypo("avery@gmail.co")).toBe("avery@gmail.com");
    expect(suggestEmailTypo("avery@gmail.con")).toBe("avery@gmail.com");
    expect(suggestEmailTypo("avery@gmail.cmo")).toBe("avery@gmail.com");
  });

  it("preserves the local part exactly, including dots and plus tags", () => {
    expect(suggestEmailTypo("first.last+dive@gmial.com")).toBe("first.last+dive@gmail.com");
  });

  it("leaves a correct common-domain address alone", () => {
    expect(suggestEmailTypo("avery@gmail.com")).toBeNull();
    expect(suggestEmailTypo("avery@icloud.com")).toBeNull();
  });

  it("does not second-guess a legitimate but similar domain", () => {
    // Real providers that are more than one edit from anything on the list.
    expect(suggestEmailTypo("avery@gmx.com")).toBeNull();
    expect(suggestEmailTypo("avery@me.com")).toBeNull();
    expect(suggestEmailTypo("avery@fastmail.com")).toBeNull();
    expect(suggestEmailTypo("diver@blue-mantis.com")).toBeNull();
  });

  it("returns null for anything that is not a usable address yet", () => {
    expect(suggestEmailTypo("")).toBeNull();
    expect(suggestEmailTypo("avery")).toBeNull();
    expect(suggestEmailTypo("avery@")).toBeNull();
    expect(suggestEmailTypo("@gmail.com")).toBeNull();
    expect(suggestEmailTypo("avery@localhost")).toBeNull();
  });
});
