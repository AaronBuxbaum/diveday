import { isTimeout, readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

function profileArguments(environment) {
  return environment.AWS_PROFILE?.trim() ? ["--profile", environment.AWS_PROFILE.trim()] : [];
}

/**
 * Ensure the selected AWS CLI profile can call STS. A normal deploy remains
 * quiet; an absent or expired console session opens the browser login flow and
 * verifies the fresh session before any deployment command can run.
 */
export function ensureAwsLogin({
  environment,
  interactive,
  execute = readBounded,
  spawn = runBounded,
  log = console.log,
}) {
  const verify = () =>
    execute("aws", ["sts", "get-caller-identity", "--output", "json"], {
      encoding: "utf8",
      env: environment,
      stdio: "pipe",
      timeoutMs: SUBPROCESS_TIMEOUTS.awsApi,
    });

  try {
    verify();
    return false;
  } catch (error) {
    // A wedged STS call is not an expired session, and must not be answered by
    // opening a browser or by telling an operator to sign in -- both send them
    // looking in the wrong place. Rethrow the timeout, which already names the
    // command that hung.
    if (isTimeout(error)) throw error;
    if (!interactive) {
      // Deliberately static, per CodeQL (clear-text logging): `environment` is
      // not always a stripped-of-secrets object by the time it reaches this
      // function -- a CI-unattended caller (ADR 20260811-ci-deploy-full-wizard)
      // passes one that still carries the real OIDC session credentials, so
      // nothing derived from it is echoed here even for a property as
      // unremarkable as a profile name.
      throw new Error(
        "AWS profile is not signed in. Run this command in an interactive terminal so it can open aws login.",
      );
    }
  }

  const region = environment.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  log("AWS profile needs sign-in; opening aws login…");
  const login = spawn("aws", ["login", ...profileArguments(environment), "--region", region], {
    env: environment,
    stdio: "inherit",
    // Minutes, not seconds: this opens a browser and waits for a human to click
    // through an SSO screen. It is also the likeliest call in the repo to wedge
    // forever -- `interactive` is derived from the absence of CI, so an agent
    // session on a cloud runner reaches it with no browser to open.
    timeoutMs: SUBPROCESS_TIMEOUTS.awsLogin,
  });
  if (isTimeout(login)) throw login.error;
  if (login.status !== 0) {
    throw new Error(`aws login exited with ${login.status ?? "an unknown status"}.`);
  }

  try {
    verify();
  } catch (error) {
    if (isTimeout(error)) throw error;
    throw new Error("aws login completed, but the selected profile still cannot call STS.");
  }
  return true;
}

/**
 * Prefer the generated deployer key, but an invalid or not-yet-usable deployer
 * must never send an operator to log in as that limited IAM user. Fall back to
 * the administrator profile, which can both deploy the first stack and read the
 * post-deploy handoff secret.
 */
export function ensureAwsDeploymentLogin({ environment, interactive, ...options }) {
  try {
    return ensureAwsLogin({ environment, interactive: false, ...options });
  } catch (error) {
    // A timeout says the STS endpoint is unreachable, not that this profile is
    // the wrong one -- falling back would spend the same bound a second time
    // and report the fallback profile as the problem.
    if (isTimeout(error)) throw error;
    if (environment.AWS_PROFILE === "diveday-deployer") {
      environment.AWS_PROFILE = "diveday-admin";
      delete environment.AWS_ACCESS_KEY_ID;
      delete environment.AWS_SECRET_ACCESS_KEY;
      delete environment.AWS_SESSION_TOKEN;
      options.log?.("diveday-deployer is unavailable; signing in as diveday-admin instead…");
    }
    return ensureAwsLogin({ environment, interactive, ...options });
  }
}
