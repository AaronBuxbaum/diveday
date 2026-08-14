import { describe, expect, it, vi } from "vitest";
import { ensureAwsDeploymentLogin, ensureAwsLogin } from "./aws-login.mjs";
import { SUBPROCESS_TIMEOUTS, TIMEOUT_EXIT_CODE } from "./subprocess.mjs";

/** What runBounded/readBounded hand back when the child had to be killed. */
const timeout = (message) => Object.assign(new Error(message), { code: "ETIMEDOUT" });
const timedOutRun = (message) => ({
  status: TIMEOUT_EXIT_CODE,
  error: timeout(message),
});

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

// `aws login` is the likeliest call in this repo to hang forever: `interactive`
// is derived from the absence of CI, so an agent session on a cloud runner
// reaches it and waits on a browser nobody will open. `aws sts` is the second,
// because a wedged endpoint looks exactly like an expired session from here.
describe("a wedged AWS call", () => {
  it("bounds both the session check and the browser login", () => {
    const execute = vi.fn(() => '{"Account":"123456789012"}');

    ensureAwsLogin({
      environment: { AWS_PROFILE: "diveday-admin" },
      interactive: true,
      execute,
      spawn: vi.fn(),
    });

    expect(execute).toHaveBeenCalledWith(
      "aws",
      ["sts", "get-caller-identity", "--output", "json"],
      expect.objectContaining({ timeoutMs: SUBPROCESS_TIMEOUTS.awsApi }),
    );
  });

  it("gives the browser login minutes, not the seconds an API call gets", () => {
    const spawn = vi.fn(() => ({ status: 0 }));

    ensureAwsLogin({
      environment: { AWS_PROFILE: "diveday-admin" },
      interactive: true,
      log: vi.fn(),
      spawn,
      execute: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("expired");
        })
        .mockReturnValueOnce('{"Account":"123456789012"}'),
    });

    expect(spawn).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining(["login"]),
      expect.objectContaining({ timeoutMs: SUBPROCESS_TIMEOUTS.awsLogin }),
    );
    expect(SUBPROCESS_TIMEOUTS.awsLogin).toBeGreaterThan(SUBPROCESS_TIMEOUTS.awsApi);
  });

  it("reports a timed-out session check as a timeout, not as a profile that needs signing in", () => {
    // Both wrong answers send an operator to the wrong place: opening a browser
    // when the endpoint is unreachable, or printing "run this in an interactive
    // terminal" at somebody whose terminal is fine.
    const spawn = vi.fn();

    expect(() =>
      ensureAwsLogin({
        environment: { AWS_PROFILE: "diveday-admin" },
        interactive: true,
        spawn,
        log: vi.fn(),
        execute: () => {
          throw timeout("`aws sts get-caller-identity --output json` did not finish within 60s");
        },
      }),
    ).toThrow(/did not finish within 60s/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports a timed-out browser login rather than a bare exit status", () => {
    expect(() =>
      ensureAwsLogin({
        environment: { AWS_PROFILE: "diveday-admin" },
        interactive: true,
        log: vi.fn(),
        execute: () => {
          throw new Error("expired");
        },
        spawn: () => timedOutRun("`aws login --profile diveday-admin` did not finish within 300s"),
      }),
    ).toThrow(/did not finish within 300s/);
  });

  it("does not spend the bound twice by falling back to the administrator profile", () => {
    // The deployer fallback exists for a profile that is the wrong one. A
    // timeout says the endpoint is unreachable, which the second profile will
    // discover just as slowly -- and then get blamed for.
    const execute = vi.fn(() => {
      throw timeout("`aws sts get-caller-identity --output json` did not finish within 60s");
    });
    const environment = { AWS_PROFILE: "diveday-deployer" };

    expect(() =>
      ensureAwsDeploymentLogin({ environment, interactive: true, execute, log: vi.fn() }),
    ).toThrow(/did not finish within 60s/);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(environment.AWS_PROFILE).toBe("diveday-deployer");
  });
});
