const fs = require("node:fs");
const path = require("node:path");

const frozenClock = process.env.DIVEDAY_CLOCK || "2026-07-21T13:30:00.000Z";
const baseURL = process.env.BACKSTOP_BASE_URL || "http://127.0.0.1:3200";

module.exports = async (page, scenario, _viewport, _isReference, browserContext) => {
  await browserContext.addInitScript((iso) => {
    const fixed = new Date(iso).getTime();
    const RealDate = Date;
    globalThis.Date = new Proxy(RealDate, {
      construct: (target, args) => Reflect.construct(target, args.length === 0 ? [fixed] : args),
      get: (target, prop, receiver) =>
        prop === "now" ? () => fixed : Reflect.get(target, prop, receiver),
    });
  }, frozenClock);

  await browserContext.route("https://maps.google.com/**", (route) => route.abort());

  const reset = await page.request.post(`${baseURL}/api/test/reset`);
  if (!reset.ok()) {
    throw new Error(`Backstop reset failed with HTTP ${reset.status()}`);
  }

  if (scenario.staff) {
    const statePath = path.resolve("backstop_data/.owner-storage-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    await browserContext.addCookies(state.cookies || []);
  }

  await page.emulateMedia({
    colorScheme: scenario.scheme || "light",
    media: scenario.media || "screen",
  });
};
