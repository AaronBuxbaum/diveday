import { execFileSync, spawnSync } from "node:child_process";

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
  execute = execFileSync,
  spawn = spawnSync,
  log = console.log,
}) {
  const verify = () =>
    execute("aws", ["sts", "get-caller-identity", "--output", "json"], {
      encoding: "utf8",
      env: environment,
      stdio: "pipe",
    });

  try {
    verify();
    return false;
  } catch {
    if (!interactive) {
      throw new Error(
        "AWS profile is not signed in. Run this command in an interactive terminal so it can open aws login.",
      );
    }
  }

  const region = environment.AWS_DEFAULT_REGION?.trim() || "us-east-1";
  log("Opening aws login…");
  const login = spawn("aws", ["login", ...profileArguments(environment), "--region", region], {
    env: environment,
    stdio: "inherit",
  });
  if (login.status !== 0) {
    throw new Error(`aws login exited with ${login.status ?? "an unknown status"}.`);
  }

  try {
    verify();
  } catch {
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
  } catch {
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
