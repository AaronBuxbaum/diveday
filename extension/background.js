// The extension's service worker: one job, run on request from a DiveDay page.
// Open the agency's lookup page in a background tab, fill it in, wait for the
// answer to settle, hand the page's text back, close the tab. It decides
// nothing; the DiveDay server reads the text (src/lib/agency-check.ts for a
// card, src/lib/elearning-check.ts for a course student's eLearning).
importScripts("protocol.js", "agencies.js", "fill.js");

const {
  AGENCIES,
  ELEARNING,
  PAGE_TEXT_MAX_LENGTH,
  REQUEST_TYPE,
  ELEARNING_REQUEST_TYPE,
  SIGN_IN_PATH: SIGN_IN_PATH_SOURCE,
} = globalThis.DiveDayCertCheck;
// fill.js's functions (fillAgencyForm, readAgencyPage, pageAsksToSignIn,
// excerptAround, excerptAroundName) are this worker's own globals: importScripts ran fill.js
// in this one scope. Never name them again here: a top-level `const` of the
// same name makes that import throw, and the worker never listens.

/** An address that signs in, signs up or manages an account, never a lookup (protocol.js). */
const SIGN_IN_PATH = new RegExp(SIGN_IN_PATH_SOURCE, "i");

/**
 * Whether a page behind the shop's own sign-in landed somewhere other than
 * its lookup: a sign-in page on another host (whose address this extension
 * may not even read, having no permission there) or a sign-in address on its
 * own. A host in `spec.origins` is the same signed-in site (PADI answers at
 * pro.padi.com and pros.padi.com), so a redirect between them is not a
 * sign-out. The staffer is told to sign in, never "couldn't read the page".
 */
async function landedOnSignIn(tabId, spec) {
  if (!spec.signIn) return false;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return false;
  }
  if (!tab.url) return true;
  try {
    const at = new URL(tab.url);
    const site = Array.isArray(spec.origins) ? spec.origins : [new URL(spec.url).origin];
    return !site.includes(at.origin) || SIGN_IN_PATH.test(at.pathname);
  } catch {
    return true;
  }
}

/** The hosts a lookup may be on: its own, or every host in `spec.origins`. */
function siteOf(spec) {
  return Array.isArray(spec.origins) ? spec.origins : [new URL(spec.url).origin];
}

/** Every host behind a shop's own sign-in, whichever lookup opened it. */
const SIGNED_IN_ORIGINS = new Set(
  [...Object.values(AGENCIES), ...Object.values(ELEARNING)]
    .filter((spec) => spec.signIn)
    .flatMap(siteOf),
);

/** The tab's address, or null when it has none this extension may read. */
async function tabAddress(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ? new URL(tab.url) : null;
  } catch {
    return null;
  }
}

/**
 * Whether any lookup's tab is somewhere other than its own site: a public
 * lookup sent to PADI's signed-in Pros' Site is never filled there, and
 * nothing of that page comes back.
 */
async function leftSite(tabId, spec) {
  const at = await tabAddress(tabId);
  return at === null || !siteOf(spec).includes(at.origin);
}

/**
 * Whether a searched page behind the shop's own sign-in now asks the staffer
 * to sign in: it was sent to a sign-in, or it shows a password box or a
 * sign-in address itself (fill.js). A page that cannot be read says so too.
 */
async function signedOutAfterSearch(tabId, spec) {
  if (!spec.signIn) return false;
  if (await landedOnSignIn(tabId, spec)) return true;
  try {
    return (await run(tabId, pageAsksToSignIn, [SIGN_IN_PATH_SOURCE])) !== false;
  } catch {
    return true;
  }
}

/** What a settled page hands back, once it is known to be the lookup's own answer. */
async function settledReply(tabId, spec, text) {
  if (await signedOutAfterSearch(tabId, spec)) return { ok: false, reason: "signed_out" };
  if (await leftSite(tabId, spec)) return { ok: false, reason: "fill_failed" };
  const at = await tabAddress(tabId);
  return {
    ok: true,
    pageText: text.slice(0, PAGE_TEXT_MAX_LENGTH),
    signedInSite: at !== null && SIGNED_IN_ORIGINS.has(at.origin),
  };
}

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
async function check(query, pages) {
  const spec = Object.hasOwn(pages, query.agency) ? pages[query.agency] : null;
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
    if (await landedOnSignIn(tab.id, spec)) return { ok: false, reason: "signed_out" };
    if (await leftSite(tab.id, spec)) return { ok: false, reason: "fill_failed" };
    // A page that draws its form after load gets a moment to do it.
    let filled;
    let before = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      before = (await run(tab.id, readAgencyPage)) || "";
      filled = await run(tab.id, fillAgencyForm, [query, spec, SIGN_IN_PATH_SOURCE]);
      if (filled?.ok) break;
      // A sign-in form: nothing was typed, and retrying would not change that.
      if (filled?.missing?.includes("signedIn")) return { ok: false, reason: "signed_out" };
      await sleep(POLL_MS);
    }
    if (!filled?.ok) {
      return (await landedOnSignIn(tab.id, spec))
        ? { ok: false, reason: "signed_out" }
        : { ok: false, reason: "fill_failed" };
    }

    // The answer has settled when three reads a second apart agree and
    // differ from the form as it was, whether the page navigated or redrew
    // itself; a page that draws its result row by row gets the extra second.
    let previous = null;
    let same = 0;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      let text;
      try {
        text = await run(tab.id, readAgencyPage);
      } catch {
        continue; // Mid-navigation: read again.
      }
      if (typeof text !== "string") continue;
      same = text === previous ? same + 1 : 0;
      previous = text;
      if (same >= 2 && text !== before) return await settledReply(tab.id, spec, text);
    }
    if (previous && previous !== before) return await settledReply(tab.id, spec, previous);
    // The search sent the tab to a sign-in it may not read: a lapsed session.
    return (await landedOnSignIn(tab.id, spec))
      ? { ok: false, reason: "signed_out" }
      : { ok: false, reason: "timeout" };
  } catch {
    // A page this extension may not script: on a signed-in lookup, most often
    // the sign-in page of another host it was sent to.
    return (await landedOnSignIn(tab.id, spec))
      ? { ok: false, reason: "signed_out" }
      : { ok: false, reason: "fill_failed" };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function validElearningQuery(query) {
  if (!query || typeof query !== "object") return false;
  const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;
  return (
    typeof query.agency === "string" &&
    text(query.firstName, 100) &&
    text(query.lastName, 100) &&
    text(query.email, 254) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.email) &&
    text(query.courseTitle, 200)
  );
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
  if (message?.type === ELEARNING_REQUEST_TYPE && validElearningQuery(message.query)) {
    // Only what the search needs goes into the agency's page.
    const query = {
      agency: message.query.agency,
      firstName: message.query.firstName,
      lastName: message.query.lastName,
      email: message.query.email,
    };
    check(query, ELEARNING)
      .then((reply) =>
        reply.ok ? { ok: true, pageText: excerptAround(reply.pageText, query.email) } : reply,
      )
      .then(sendResponse);
    return true;
  }
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
  const spec = Object.hasOwn(AGENCIES, query.agency) ? AGENCIES[query.agency] : null;
  check(query, AGENCIES)
    .then((reply) => {
      if (!reply.ok) return reply;
      // A page behind a shop's sign-in, whichever lookup reached it, hands
      // back only this diver's lines (fill.js).
      return spec?.signIn || reply.signedInSite
        ? {
            ok: true,
            pageText: excerptAroundName(reply.pageText, query.firstName, query.lastName),
          }
        : { ok: true, pageText: reply.pageText };
    })
    .then(sendResponse);
  return true;
});
