import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preferOfficialArchive, prepareUbuntuMirrors } from "./ci-ubuntu-mirrors.mjs";

const azure = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n";
const archive = "https://archive.ubuntu.com/ubuntu/\tpriority:2\n";
const security = "https://security.ubuntu.com/ubuntu/\tpriority:3\n";

describe("CI Ubuntu mirror preference", () => {
  it("removes the failing first mirror while preserving official fallbacks and priorities", () => {
    expect(preferOfficialArchive(azure + archive + security)).toBe(archive + security);
  });

  it("preserves comments, custom entries, whitespace and CRLF line endings", () => {
    const rest =
      "# mirror list\r\n  https://archive.ubuntu.com/ubuntu/\tpriority:2\r\nhttps://custom.example/ubuntu/\tpriority:4\r\n";
    expect(
      preferOfficialArchive(`https://azure.archive.ubuntu.com/ubuntu/\tpriority:1\r\n${rest}`),
    ).toBe(rest);
  });

  it.each(["", azure, azure + security, "# https://archive.ubuntu.com/ubuntu/\n" + azure])(
    "leaves a list without an official package archive unchanged: %j",
    (contents) => expect(preferOfficialArchive(contents)).toBe(contents),
  );

  it("matches exact URLs, leaving similarly named hosts and paths alone", () => {
    const contents =
      "https://azure.archive.ubuntu.com.example/ubuntu/\nhttps://azure.archive.ubuntu.com/other/\n" +
      archive;
    expect(preferOfficialArchive(contents)).toBe(contents);
    const unrecognized = azure + "https://archive.ubuntu.com.example/ubuntu/\n";
    expect(preferOfficialArchive(unrecognized)).toBe(unrecognized);
  });

  it("updates an existing fixture once and leaves missing files alone", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ci-mirrors-"));
    const file = path.join(directory, "apt-mirrors.txt");
    try {
      expect(prepareUbuntuMirrors(file)).toBe(false);
      writeFileSync(file, azure + archive + security);
      expect(prepareUbuntuMirrors(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toBe(archive + security);
      expect(prepareUbuntuMirrors(file)).toBe(false);
      expect(() => prepareUbuntuMirrors(directory)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
