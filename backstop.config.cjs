const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const baseURL = process.env.BACKSTOP_BASE_URL || "http://127.0.0.1:3200";
const sourceRoot = path.resolve("backstop");
const browserExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  chromium.executablePath(),
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
]
  .filter(Boolean)
  .find((candidate) => fs.existsSync(candidate));

const viewports = [
  { label: "phone", width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 800 },
];

const printViewport = { label: "print", width: 816, height: 1056 };

function parseShardEnv() {
  const total = Number(process.env.BACKSTOP_SHARD_TOTAL || "1");
  const index = Number(process.env.BACKSTOP_SHARD_INDEX || "0");

  if (!Number.isInteger(total) || total < 1) {
    throw new Error("BACKSTOP_SHARD_TOTAL must be a positive integer.");
  }

  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new Error("BACKSTOP_SHARD_INDEX must be an integer from 0 to BACKSTOP_SHARD_TOTAL - 1.");
  }

  return { index, total };
}

function scenario({
  label,
  flow,
  route = "/",
  scheme = "light",
  staff = false,
  media = "screen",
  viewports: scenarioViewports,
}) {
  return {
    label,
    flow,
    scheme,
    staff,
    media,
    url: `${baseURL}${route}`,
    viewports: scenarioViewports,
    readySelector: "body",
    selectors: ["document"],
    selectorExpansion: false,
    misMatchThreshold: 0,
    requireSameDimensions: true,
    engineOptions: {
      gotoParameters: { waitUntil: "networkidle" },
    },
  };
}

const publicRoutes = [
  ["landing", "/", "landing"],
  ["product", "/product", "product"],
  ["pricing", "/pricing", "pricing"],
  ["sign-in", "/sign-in", "sign-in"],
  ["forgot-password", "/forgot-password", "forgot-password"],
  ["verify-invalid", "/verify/not-a-real-token", "verify-invalid"],
  ["reset-password-invalid", "/reset-password/not-a-real-token", "reset-password-invalid"],
  ["schedule", "/shop/blue-mantis/schedule", "schedule"],
  ["schedule-embed", "/shop/blue-mantis/schedule?embed=1", "schedule-embed"],
  ["course-page", "/shop/blue-mantis/courses/open-water-diver", "course-page"],
  ["switching-hub", "/switching", "switching-hub"],
  ["switching-eve", "/switching/eve", "switching-eve"],
  ["switching-spreadsheet", "/switching/spreadsheet", "switching-spreadsheet"],
  ["switching-fareharbor", "/switching/fareharbor", "switching-fareharbor"],
  ["switching-rezdy", "/switching/rezdy", "switching-rezdy"],
  ["about", "/about", "about"],
].flatMap(([name, route, flow]) =>
  ["light", "dark"].map((scheme) => scenario({ label: `${name}-${scheme}`, flow, route, scheme })),
);

const statefulPublic = [
  ["site-briefing", "site-briefing", "light"],
  ["recap", "recap", "light"],
  ["waiver-active", "waiver-active", "light"],
  ["readiness", "readiness", "light"],
].flatMap(([name, flow, defaultScheme]) =>
  ["light", "dark"].map((scheme) =>
    scenario({
      label: `${name}-${scheme}`,
      flow,
      scheme: scheme || defaultScheme,
    }),
  ),
);

const staffFlows = [
  ["today", "/shop/blue-mantis", "today"],
  ["check-in", "/shop/blue-mantis/check-in", "check-in"],
  ["divers", "/shop/blue-mantis/divers", "divers"],
  ["settings-payments", "/shop/blue-mantis/settings", "settings-payments"],
  ["settings-export", "/shop/blue-mantis/settings/export", "settings-export"],
  ["settings-import", "/shop/blue-mantis/settings/import", "settings-import"],
  ["settings-embed", "/shop/blue-mantis/settings/embed", "settings-embed"],
  ["settings-team", "/shop/blue-mantis/settings/team", "settings-team"],
  ["reports", "/shop/blue-mantis/reports", "reports"],
].flatMap(([name, route, flow]) =>
  ["light", "dark"].map((scheme) =>
    scenario({ label: `${name}-${scheme}`, flow, route, scheme, staff: true }),
  ),
);

const staffStateful = [
  ["diver-profile", "diver-profile"],
  ["diver-profile-expired", "diver-profile-expired"],
  ["diver-profile-imported", "diver-profile-imported"],
  ["trip-manage", "trip-manage"],
  ["trip-guests", "trip-guests"],
  ["manifest", "manifest"],
  ["prep", "prep"],
  ["offline-manifest-list", "offline-manifest-list"],
  ["offline-manifest-empty", "offline-manifest-empty"],
  ["trip-guests-identity", "trip-guests-identity"],
  ["prep-no-nitrox", "prep-no-nitrox"],
].flatMap(([name, flow]) =>
  ["light", "dark"].map((scheme) =>
    scenario({ label: `${name}-${scheme}`, flow, scheme, staff: true }),
  ),
);

const printScenarios = ["manifest", "prep"].map((flow) =>
  scenario({
    label: `${flow}-print`,
    flow: `${flow}-print`,
    route: "/",
    staff: true,
    media: "print",
    viewports: [printViewport],
  }),
);

const scenarios = [
  ...publicRoutes,
  ...statefulPublic,
  ...staffFlows,
  ...staffStateful,
  ...printScenarios,
];
const shard = parseShardEnv();
const selectedScenarios =
  shard.total === 1
    ? scenarios
    : scenarios.filter((_scenario, scenarioIndex) => scenarioIndex % shard.total === shard.index);

if (selectedScenarios.length === 0) {
  throw new Error(
    `Backstop shard ${shard.index + 1}/${shard.total} did not receive any scenarios.`,
  );
}

module.exports = {
  id: "diveday_backstop",
  viewports,
  scenarios: selectedScenarios,
  onBeforeScript: "onBefore.cjs",
  onReadyScript: "onReady.cjs",
  paths: {
    bitmaps_reference: path.resolve("backstop_data/bitmaps_reference"),
    bitmaps_test: path.resolve("backstop_data/bitmaps_test"),
    engine_scripts: sourceRoot,
    html_report: path.resolve("backstop_data/html_report"),
    ci_report: path.resolve("backstop_data/ci_report"),
    json_report: path.resolve("backstop_data/json_report"),
  },
  report: ["browser", "CI", "json"],
  openReport: false,
  archiveReport: false,
  engine: "playwright",
  engineOptions: {
    args: ["--no-sandbox"],
    headless: true,
    gotoParameters: { waitUntil: "networkidle" },
    waitTimeout: 60_000,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  },
  asyncCaptureLimit: 1,
  asyncCompareLimit: 10,
  scenarioLogsInReports: true,
};
