#!/usr/bin/env node

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const action = process.argv[2] || "test";
const allowedActions = new Set(["test", "reference", "approve"]);
if (!allowedActions.has(action)) {
  console.error(`Usage: node scripts/backstop-run.mjs ${[...allowedActions].join("|")}`);
  process.exit(2);
}

const port = Number(process.env.BACKSTOP_PORT || 3200);
const baseURL = process.env.BACKSTOP_BASE_URL || `http://127.0.0.1:${port}`;
const frozenClock = process.env.DIVEDAY_CLOCK || "2026-07-21T13:30:00.000Z";
const authSecret = process.env.AUTH_SECRET || "diveday-e2e-secret";
const statePath = path.resolve("backstop_data/.owner-storage-state.json");
const backstopBin = path.resolve("node_modules/.bin/backstop");
const nextBin = path.resolve("node_modules/.bin/next");

const serverEnv = {
  ...process.env,
  APP_HOST: "",
  DATABASE_URL: "",
  DATABASE_URL_UNPOOLED: "",
  PGLITE_DATA_DIR: "memory",
  DIVEDAY_E2E: "1",
  DIVEDAY_CLOCK: frozenClock,
  DIVEDAY_RATE_LIMIT_DISABLED: "1",
  AUTH_TRUST_HOST: "true",
  AUTH_SECRET: authSecret,
  DIVEDAY_DISABLE_EXTERNAL_HTTP: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  BACKSTOP_BASE_URL: baseURL,
};

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`));
      else resolve();
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseURL}: ${lastError?.message || "unknown error"}`);
}

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    "/opt/pw-browsers/chromium",
    chromium.executablePath(),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

async function createOwnerStorageState() {
  await mkdir(path.dirname(statePath), { recursive: true });
  const launchOptions = { headless: true };
  const executablePath = browserExecutable();
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((iso) => {
    const fixed = new Date(iso).getTime();
    const RealDate = Date;
    globalThis.Date = new Proxy(RealDate, {
      construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
      get: (target, prop, receiver) =>
        prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
    });
  }, frozenClock);
  await context.route("https://maps.google.com/**", (route) => route.abort());

  const reset = await context.request.post(`${baseURL}/api/test/reset`);
  if (!reset.ok()) throw new Error(`Backstop owner reset failed with HTTP ${reset.status()}`);

  const page = await context.newPage();
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill("dana@demo.invalid");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/shop/);
  await context.storageState({ path: statePath });
  await context.close();
  await browser.close();
}

let server;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

process.once("SIGINT", async () => {
  await shutdown();
  process.exit(130);
});
process.once("SIGTERM", async () => {
  await shutdown();
  process.exit(143);
});

try {
  if (action === "approve") {
    const args = ["approve", "--config=backstop.config.cjs"];
    if (process.env.BACKSTOP_FILTER) args.push(`--filter=${process.env.BACKSTOP_FILTER}`);
    await run(backstopBin, args, serverEnv);
  } else {
    if (process.env.BACKSTOP_SKIP_BUILD !== "1") {
      await run(nextBin, ["build"], {
        ...serverEnv,
        DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
        PGLITE_DATA_DIR: path.resolve(".pglite-e2e"),
      });
    }

    server = spawn(nextBin, ["start", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: { ...serverEnv, PORT: String(port) },
      stdio: "inherit",
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      waitForServer().then(resolve, reject);
    });
    await createOwnerStorageState();

    const args = [action, "--config=backstop.config.cjs"];
    if (process.env.BACKSTOP_FILTER) args.push(`--filter=${process.env.BACKSTOP_FILTER}`);
    await run(backstopBin, args, serverEnv);
  }
} finally {
  await shutdown();
}
