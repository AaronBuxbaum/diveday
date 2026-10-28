/**
 * Next loads dotenv files and binds its actual PORT before evaluating the dev
 * config. Default here, rather than in the supervisor before auto-port selection.
 * An explicit origin (even blank) remains the developer's configuration.
 */
export function applyDevOrigin(phase, env = process.env) {
  if (phase !== "phase-development-server" || env.APP_HOST !== undefined) return;
  const port = env.PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("The development server port must be an integer from 1 to 65535.");
  }
  env.APP_HOST = `http://localhost:${port}`;
}
