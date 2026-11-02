import { describe, expect, it } from "vitest";
import { isStaleDeployError } from "./stale-deploy-error";

describe("isStaleDeployError", () => {
  it("knows a Server Action the server no longer has", () => {
    const error = new Error('Server Action "abc" was not found on the server.');
    error.name = "UnrecognizedActionError";
    expect(isStaleDeployError(error)).toBe(true);
    expect(isStaleDeployError(new Error('Failed to find Server Action "abc".'))).toBe(true);
  });

  it("knows a script chunk a newer deploy removed", () => {
    const error = new Error("Loading chunk 123 failed.");
    error.name = "ChunkLoadError";
    expect(isStaleDeployError(error)).toBe(true);
    expect(isStaleDeployError(new Error("Loading chunk app-page failed."))).toBe(true);
  });

  it("leaves a real crash to the crash page", () => {
    expect(isStaleDeployError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleDeployError("Server Action not found")).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
  });
});
