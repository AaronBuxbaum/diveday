import { describe, expect, it, vi } from "vitest";
import { ensureAwsDeploymentLogin, ensureAwsLogin } from "./aws-login.mjs";

describe("ensureAwsLogin", () => {
  it("does nothing when the selected profile already has a valid session", () => {
    const execute = vi.fn(() => '{"Account":"123456789012"}');
    const spawn = vi.fn();

    expect(
      ensureAwsLogin({
        environment: { AWS_PROFILE: "diveday-admin", AWS_DEFAULT_REGION: "us-east-1" },
        interactive: true,
        execute,
        spawn,
      }),
    ).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("opens the browser login flow and verifies the new session", () => {
    const execute = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("expired");
      })
      .mockReturnValueOnce('{"Account":"123456789012"}');
    const spawn = vi.fn(() => ({ status: 0 }));

    expect(
      ensureAwsLogin({
        environment: { AWS_PROFILE: "diveday-admin", AWS_DEFAULT_REGION: "us-east-1" },
        interactive: true,
        execute,
        spawn,
        log: vi.fn(),
      }),
    ).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "aws",
      ["login", "--profile", "diveday-admin", "--region", "us-east-1"],
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not attempt browser login in a non-interactive process", () => {
    expect(() =>
      ensureAwsLogin({
        environment: { AWS_PROFILE: "diveday-admin" },
        interactive: false,
        execute: () => {
          throw new Error("expired");
        },
      }),
    ).toThrow(/interactive terminal/);
  });

  it("falls back from an unusable deployer key to an administrator browser login", () => {
    const execute = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("deployer invalid");
      })
      .mockImplementationOnce(() => {
        throw new Error("admin needs login");
      })
      .mockReturnValueOnce('{"Account":"123456789012"}');
    const spawn = vi.fn(() => ({ status: 0 }));
    const environment = { AWS_PROFILE: "diveday-deployer", AWS_DEFAULT_REGION: "us-east-1" };

    expect(
      ensureAwsDeploymentLogin({
        environment,
        interactive: true,
        execute,
        spawn,
        log: vi.fn(),
      }),
    ).toBe(true);
    expect(environment.AWS_PROFILE).toBe("diveday-admin");
    expect(spawn).toHaveBeenCalledWith(
      "aws",
      ["login", "--profile", "diveday-admin", "--region", "us-east-1"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });
});
