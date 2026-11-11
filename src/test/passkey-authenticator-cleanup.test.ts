import { describe, expect, it, vi } from "vitest";
import { closePasskeyAuthenticator } from "../../e2e/passkey-authenticator";

function session() {
  return {
    send: vi.fn(async () => ({})),
    detach: vi.fn(async () => undefined),
  };
}

describe("test-only virtual authenticator teardown", () => {
  it("removes only its own authenticator and detaches on a live target", async () => {
    const cdp = session();
    await closePasskeyAuthenticator({ isClosed: () => false }, cdp, "owned-test-key");
    expect(cdp.send).toHaveBeenCalledWith("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId: "owned-test-key",
    });
    expect(cdp.detach).toHaveBeenCalledOnce();
  });

  it("does not send commands to an already closed target after a test timeout", async () => {
    const cdp = session();
    await closePasskeyAuthenticator({ isClosed: () => true }, cdp, "owned-test-key");
    expect(cdp.send).not.toHaveBeenCalled();
    expect(cdp.detach).not.toHaveBeenCalled();
  });

  it("does not mask the primary failure when the target closes during removal", async () => {
    const cdp = session();
    cdp.send.mockRejectedValue(new Error("Target page, context or browser has been closed"));
    await expect(
      closePasskeyAuthenticator({ isClosed: () => false }, cdp, "owned-test-key"),
    ).resolves.toBeUndefined();
    expect(cdp.detach).not.toHaveBeenCalled();
  });

  it("tolerates only the known closed-target race while detaching", async () => {
    const cdp = session();
    cdp.detach.mockRejectedValue(new Error("Target page, context or browser has been closed"));
    await expect(
      closePasskeyAuthenticator({ isClosed: () => false }, cdp, "owned-test-key"),
    ).resolves.toBeUndefined();
  });

  it("still reports an unrelated protocol failure", async () => {
    const cdp = session();
    cdp.send.mockRejectedValue(new Error("unknown authenticator ID"));
    await expect(
      closePasskeyAuthenticator({ isClosed: () => false }, cdp, "owned-test-key"),
    ).rejects.toThrow("unknown authenticator ID");
  });
});
