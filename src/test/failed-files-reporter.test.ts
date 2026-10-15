import { describe, expect, it } from "vitest";
import { ANNOTATION_TITLE, failedFileCommand } from "./failed-files-reporter";

describe("the failed-file annotation", () => {
  it("anchors at the test file, repo-relative, with the title base-ci.mjs reads", () => {
    expect(failedFileCommand("/repo/src/db/trips.test.ts", "/repo")).toBe(
      `::error file=src/db/trips.test.ts,title=${ANNOTATION_TITLE}::src/db/trips.test.ts`,
    );
  });
});
