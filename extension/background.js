// The extension's service worker: one job, run on request from a DiveDay page.
// Open the agency's lookup page in a background tab, fill it in, wait for the
// answer to settle, hand the page's text back, close the tab. It decides
// nothing; the DiveDay server reads the text (src/lib/agency-check.ts).
importScripts("protocol.js", "agencies.js", "fill.js");

const { AGENCIES, PAGE_TEXT_MAX_LENGTH, REQUEST_TYPE, fillAgencyForm, readAgencyPage } =
  globalThis.DiveDayCertCheck;

/** How long a lookup may take, end to end. The page gives up at 45 seconds. */
const CHECK_DEADLINE_MS = 40_000;
/** How often the answer is read while it settles. */
const POLL_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tabLoaded(tabId, deadline) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), Math.max(0, deadline - Date.now()));
    function finish(loaded) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(loaded);
    }
    function onUpdated(updatedId, change) {
      if (updatedId === tabId && change.status === "complete") finish(true);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") finish(true);
      },
      () => finish(false),
    );
  });
}

async function run(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return injection ? injection.result : undefined;
}

/** The text a check found, or why there is none. */
async function check(query) {
  const spec = Object.hasOwn(AGENCIES, query.agency) ? AGENCIES[query.agency] : null;
  if (!spec) return { ok: false, reason: "unsupported" };
  const deadline = Date.now() + CHECK_DEADLINE_MS;
  let tab;
  try {
    tab = await chrome.tabs.create({ url: spec.url, active: false });
  } catch {
    return { ok: false, reason: "tab_failed" };
  }
  try {
    if (!(await tabLoaded(tab.id, deadline))) return { ok: false, reason: "timeout" };
    // A page that draws its form after load gets a moment to do it.
    let filled;
    let before = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      before = (await run(tab.id, readAgencyPage)) || "";
      filled = await run(tab.id, fillAgencyForm, [query, spec]);
      if (filled?.ok) break;
      await sleep(POLL_MS);
    }
    if (!filled?.ok) return { ok: false, reason: "fill_failed" };

    // The answer has settled when two reads a second apart agree and differ
    // from the form as it was, whether the page navigated or redrew itself.
    let previous = null;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      let text;
      try {
        text = await run(tab.id, readAgencyPage);
      } catch {
        continue; // Mid-navigation: read again.
      }
      if (typeof text !== "string") continue;
      if (text === previous && text !== before) {
        return { ok: true, pageText: text.slice(0, PAGE_TEXT_MAX_LENGTH) };
      }
      previous = text;
    }
    return previous && previous !== before
      ? { ok: true, pageText: previous.slice(0, PAGE_TEXT_MAX_LENGTH) }
      : { ok: false, reason: "timeout" };
  } catch {
    return { ok: false, reason: "fill_failed" };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function validQuery(query) {
  if (!query || typeof query !== "object") return false;
  const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;
  const optional = (value, max) => value === null || text(value, max);
  return (
    typeof query.agency === "string" &&
    text(query.firstName, 100) &&
    text(query.lastName, 100) &&
    (query.birthDate === null || /^\d{4}-\d{2}-\d{2}$/.test(query.birthDate)) &&
    optional(query.cardNumber, 64)
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content script, in the top frame of a DiveDay
  // staff page, may ask. The manifest's match pattern already says so; this
  // says it again where the work happens.
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
  let from;
  try {
    from = new URL(sender.url);
  } catch {
    return false;
  }
  const local = from.hostname === "localhost" || from.hostname === "127.0.0.1";
  const diveDay = from.protocol === "https:" && from.hostname === "dive.day";
  if ((!diveDay && !local) || !from.pathname.startsWith("/shop/")) return false;
  if (!message || message.type !== REQUEST_TYPE || !validQuery(message.query)) {
    sendResponse({ ok: false, reason: "unsupported" });
    return false;
  }
  const query = {
    agency: message.query.agency,
    firstName: message.query.firstName,
    lastName: message.query.lastName,
    birthDate: message.query.birthDate,
    cardNumber: message.query.cardNumber,
  };
  check(query).then(sendResponse);
  return true;
});
