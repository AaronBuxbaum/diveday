import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function containsProfile(path, profile) {
  return (
    existsSync(path) &&
    new RegExp(`^\\[${profile.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\]\\s*$`, "m").test(
      readFileSync(path, "utf8"),
    )
  );
}

/** Whether a named profile has been configured for the AWS CLI. */
export function hasAwsProfile(profile, environment = process.env) {
  const awsDirectory = environment.AWS_PROFILE_HOME?.trim() || join(homedir(), ".aws");
  return (
    containsProfile(
      environment.AWS_SHARED_CREDENTIALS_FILE?.trim() || join(awsDirectory, "credentials"),
      profile,
    ) ||
    containsProfile(
      environment.AWS_CONFIG_FILE?.trim() || join(awsDirectory, "config"),
      `profile ${profile}`,
    )
  );
}

/** Whether the wizard has already installed the generated deployer profile. */
export function hasGeneratedDeployerProfile(environment = process.env) {
  return hasAwsProfile("diveday-deployer", environment);
}

/**
 * Prefer an explicitly selected profile. Once the wizard has installed the
 * deployer identity, make it the ergonomic default; before then explicitly
 * target the administrator profile so aws login creates the right profile.
 */
export function selectDeployProfile(environment) {
  if (environment.AWS_ACCESS_KEY_ID && environment.AWS_SECRET_ACCESS_KEY) return environment;

  const profile = environment.INFRA_DEPLOY_PROFILE?.trim() || environment.AWS_PROFILE?.trim();
  if (profile) environment.AWS_PROFILE = profile;
  else if (hasGeneratedDeployerProfile(environment)) environment.AWS_PROFILE = "diveday-deployer";
  else environment.AWS_PROFILE = "diveday-admin";

  delete environment.AWS_ACCESS_KEY_ID;
  delete environment.AWS_SECRET_ACCESS_KEY;
  delete environment.AWS_SESSION_TOKEN;
  return environment;
}
