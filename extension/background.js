// The extension's service worker: one job, run on request from a DiveDay page.
// Open the agency's lookup page in a background tab, fill it in, wait for the
// answer to settle, hand the page's text back, close the tab. It decides
// nothing; the DiveDay server reads the text (src/lib/agency-check.ts for a
// card, src/lib/elearning-check.ts for a course student's eLearning).
importScripts("protocol.js", "agencies.js", "fill.js", "shape.js");

const {
  VERSION,
  AGENCIES,
  ELEARNING,
  PAGE_TEXT_MAX_LENGTH,
  REQUEST_TYPE,
  SSI_MANUAL_REQUEST_TYPE,
  ELEARNING_REQUEST_TYPE,
  HELLO_REQUEST_TYPE,
  DRY_RUN_REQUEST_TYPE,
  PADI_SESSION_REQUEST_TYPE,
  PAGE_SHAPE_WORDS,
  SIGN_IN_PATH: SIGN_IN_PATH_SOURCE,
} = globalThis.DiveDayCertCheck;
// fill.js's functions (fillAgencyForm, readAgencyPage, pageAsksToSignIn,
// excerptAround, excerptAroundName) and shape.js's describePageShape are this
// worker's own globals: importScripts ran them in this one scope. Never name
// them again here: a top-level `const` of the same name makes that import
// throw, and the worker never listens.

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

/**
 * The shape of the page in the tab (shape.js), or null when it cannot be read
 * or is not the lookup's own site: a lookup sent elsewhere is never read, not
 * even its shape. Only the shape, never a word outside a form's vocabulary,
 * and never the diver's own names.
 */
async function shapeOf(tabId, spec, query) {
  if (await leftSite(tabId, spec)) return null;
  try {
    const shape = await run(tabId, describePageShape, [
      PAGE_SHAPE_WORDS,
      [query.firstName, query.lastName],
    ]);
    return shape && typeof shape === "object" ? shape : null;
  } catch {
    return null;
  }
}

/** A check that ends short of the page's text: its fixed reason, and the page's shape when there is one. */
function failed(reason, pageShape) {
  return pageShape ? { ok: false, reason, pageShape } : { ok: false, reason };
}

/** Text folded as the server folds it: no accents, no case, words split by single spaces. */
function foldWords(value) {
  return ` ${String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** Words a lookup's answer finds nobody with. Never a bare "not found", which a missing page says too. */
const NO_RECORD =
  /(^| )(no results?|no records?( found)?|no matching|no (divers?|students?) found|0 results|could not find|unable to find)( |$)/;

/**
 * Whether a settled page says something about the diver: it names them (first
 * and last name), or it says it found nobody. The server judges it either way.
 */
function answersAboutDiver(text, query) {
  const page = foldWords(text);
  const first = foldWords(query.firstName);
  const last = foldWords(query.lastName);
  const named =
    first.trim() !== "" && last.trim() !== "" && page.includes(first) && page.includes(last);
  return named || NO_RECORD.test(page);
}

/** What a settled page hands back, once it is known to be the lookup's own answer. */
async function settledReply(tabId, spec, text, query) {
  if (await signedOutAfterSearch(tabId, spec)) return { ok: false, reason: "signed_out" };
  if (await leftSite(tabId, spec)) return { ok: false, reason: "fill_failed" };
  // A page asking whether the staffer is human, and saying nothing about the
  // diver, answers nothing: none of its text comes back. One that names the
  // diver or finds nobody is an answer, captcha beside it or not.
  const shape = await shapeOf(tabId, spec, query);
  if (shape?.captcha && !answersAboutDiver(text, query)) return failed("captcha", shape);
  const at = await tabAddress(tabId);
  return {
    ok: true,
    pageText: text.slice(0, PAGE_TEXT_MAX_LENGTH),
    signedInSite: at !== null && SIGNED_IN_ORIGINS.has(at.origin),
  };
}

/**
 * **Where the last lookups spent their time**, for a check that stalls (#2878): each phase's
 * fixed name and when it began, nothing else. No address, no query, no page text, and only in
 * this worker's memory, gone when Chrome stops it; the real-extension browser test reads it
 * back when a check there fails (`e2e/agency-check-extension.spec.ts`).
 */
const CHECK_PHASES_KEPT = 200;
globalThis.DiveDayCheckPhases = [];
function phase(name) {
  const kept = globalThis.DiveDayCheckPhases;
  kept.push([Date.now(), name]);
  if (kept.length > CHECK_PHASES_KEPT) kept.splice(0, kept.length - CHECK_PHASES_KEPT);
}

/** How long a lookup may take, end to end. The page gives up at 45 seconds. */
const CHECK_DEADLINE_MS = 40_000;
/** How often the answer is read while it settles. */
const POLL_MS = 1_000;
/** How many times a form that is there, short of a box or button the lookup needs, is tried. */
const FILL_TRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tabLoaded(tabId, deadline) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), Math.max(0, deadline - Date.now()));
    let finished = false;
    function finish(loaded) {
      if (!finished) phase(loaded ? "tab:loaded" : "tab:not-loaded");
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(loaded);
    }
    function onUpdated(updatedId, change) {
      if (updatedId === tabId && change.status) phase(`tab:updated:${change.status}`);
      if (updatedId === tabId && change.status === "complete") finish(true);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(
      (tab) => {
        phase(`tab:get:${tab.status}`);
        if (tab.status === "complete") finish(true);
      },
      () => finish(false),
    );
  });
}

async function run(tabId, func, args = []) {
  phase(`run:${func.name}`);
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    phase(`ran:${func.name}`);
    return injection ? injection.result : undefined;
  } catch (error) {
    phase(`threw:${func.name}`);
    throw error;
  }
}

/** The text a check found, or why there is none. */
async function check(query, pages) {
  const spec = Object.hasOwn(pages, query.agency) ? pages[query.agency] : null;
  if (!spec) return { ok: false, reason: "unsupported" };
  const deadline = Date.now() + CHECK_DEADLINE_MS;
  phase("check:start");
  let tab;
  try {
    tab = await chrome.tabs.create({ url: spec.url, active: false });
  } catch {
    phase("tab:create-failed");
    return { ok: false, reason: "tab_failed" };
  }
  phase(`tab:created:${tab.status}`);
  try {
    if (!(await tabLoaded(tab.id, deadline))) return { ok: false, reason: "timeout" };
    if (await landedOnSignIn(tab.id, spec)) return { ok: false, reason: "signed_out" };
    if (await leftSite(tab.id, spec)) return { ok: false, reason: "fill_failed" };
    // A page with no box at all yet (a form still drawing, a challenge in
    // front of it) is waited for to the deadline, and is never a changed
    // page. A form that is there, short of a box or button the lookup needs,
    // gets `FILL_TRIES` tries a second apart.
    let filled;
    let before = "";
    let tries = 0;
    for (;;) {
      before = (await run(tab.id, readAgencyPage)) || "";
      filled = await run(tab.id, fillAgencyForm, [query, spec, SIGN_IN_PATH_SOURCE]);
      phase(filled?.ok ? "fill:ok" : "fill:short");
      if (filled?.ok) break;
      // A sign-in form: nothing was typed, and retrying would not change that.
      if (filled?.missing?.includes("signedIn")) return { ok: false, reason: "signed_out" };
      // A captcha on the lookup's own form is the staffer's to answer: nothing was typed.
      if (filled?.missing?.includes("captcha")) {
        return failed("captcha", await shapeOf(tab.id, spec, query));
      }
      if (!filled?.missing?.includes("form")) tries += 1;
      if (tries >= FILL_TRIES || Date.now() + POLL_MS >= deadline) break;
      await sleep(POLL_MS);
    }
    if (!filled?.ok) {
      if (await landedOnSignIn(tab.id, spec)) return { ok: false, reason: "signed_out" };
      const shape = await shapeOf(tab.id, spec, query);
      // Still no box at the deadline: a challenge in front of the page, or a
      // page that never drew its form. Never a changed page.
      if (filled?.missing?.includes("form")) {
        return failed(shape?.captcha ? "captcha" : "timeout", shape);
      }
      // On the lookup's own site, a form with no box or button where the
      // lookup expects one: the agency has changed its page.
      if (shape && Array.isArray(filled?.missing) && filled.missing.length > 0) {
        return failed("page_changed", shape);
      }
      return failed("fill_failed", shape);
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
      if (same >= 2 && text !== before) return await settledReply(tab.id, spec, text, query);
    }
    if (previous && previous !== before) {
      return await settledReply(tab.id, spec, previous, query);
    }
    // The search sent the tab to a sign-in it may not read: a lapsed session.
    if (await landedOnSignIn(tab.id, spec)) return { ok: false, reason: "signed_out" };
    const shape = await shapeOf(tab.id, spec, query);
    if (shape?.captcha) return failed("captcha", shape);
    return failed("timeout", shape);
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

/** Open SSI for the staffer. Do not accept terms, submit, or read its result. */
async function openSsiManual(query) {
  const spec = AGENCIES.ssi;
  let tab;
  try {
    tab = await chrome.tabs.create({ url: spec.url, active: true });
    if (!(await tabLoaded(tab.id, Date.now() + CHECK_DEADLINE_MS))) {
      return { ok: false, reason: "timeout" };
    }
    const loaded = await chrome.tabs.get(tab.id);
    const url = new URL(loaded.url);
    if (
      url.origin !== "https://my.divessi.com" ||
      url.pathname.replace(/\/+$/, "") !== "/online_diver_check"
    ) {
      return { ok: false, reason: "page_changed" };
    }
    const filled = await run(tab.id, fillSsiManualForm, [query]);
    return filled ? { ok: false, reason: "manual_opened" } : { ok: false, reason: "page_changed" };
  } catch {
    return { ok: false, reason: "fill_failed" };
  }
}

/**
 * **"Try the checks"**: fill one agency's sample page, which this extension
 * carries (`sample.html`), with a made-up diver, and say whether every box
 * was found, typed into and sent. No agency is opened and nothing leaves the
 * browser. A lookup behind a member sign-in (PADI) has no dry run: its filler
 * types only on the agency's own page.
 */
const DRY_RUN_DEADLINE_MS = 10_000;
/** A dry run waiting for its sample page, by the tab it was opened in. */
const dryRunsWaiting = new Map();
/** A sample page's answer that came before its tab was known. */
const dryRunsAnswered = new Map();

function answerDryRun(tabId, result) {
  const waiting = dryRunsWaiting.get(tabId);
  if (waiting) waiting(result);
  else dryRunsAnswered.set(tabId, result);
}

/**
 * Whether this browser lets the extension on every host a lookup may be on.
 * Chrome lets a person withhold a host the extension asks for (its site
 * access), and a lookup there can then neither be filled nor read.
 */
async function hostAccess(spec) {
  try {
    return (
      (await chrome.permissions.contains({
        origins: siteOf(spec).map((origin) => `${origin}/*`),
      })) === true
    );
  } catch {
    return false;
  }
}

async function dryRun(agency) {
  const spec = Object.hasOwn(AGENCIES, agency) ? AGENCIES[agency] : null;
  if (!spec || spec.signIn) return { ok: false, reason: "unsupported" };
  // The sample page is the extension's own; the agency's site is where a
  // real check runs, so whether it may go there is part of the dry run.
  const allowed = await hostAccess(spec);
  let tab;
  try {
    tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`sample.html#${agency}`),
      active: false,
    });
  } catch {
    return { ok: false, reason: "tab_failed" };
  }
  try {
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), DRY_RUN_DEADLINE_MS);
      function finish(result) {
        clearTimeout(timer);
        dryRunsWaiting.delete(tab.id);
        dryRunsAnswered.delete(tab.id);
        resolve(result);
      }
      if (dryRunsAnswered.has(tab.id)) finish(dryRunsAnswered.get(tab.id));
      else dryRunsWaiting.set(tab.id, finish);
    });
    return result.ok ? { ...result, hostAccess: allowed } : result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** What a sample page says it did: four fixed answers and its shape, nothing else. */
function dryRunResult(result) {
  if (!result || typeof result !== "object") return { ok: false, reason: "fill_failed" };
  const missing = Array.isArray(result.missing)
    ? result.missing.filter((field) => typeof field === "string" && /^[a-zA-Z]{1,20}$/.test(field))
    : [];
  return {
    ok: true,
    filled: result.filled === true,
    typed: result.typed === true,
    submitted: result.submitted === true,
    ...(result.manual === true ? { manual: true } : {}),
    missing: missing.slice(0, 10),
    ...(result.pageShape && typeof result.pageShape === "object"
      ? { pageShape: result.pageShape }
      : {}),
  };
}

/**
 * **Whether a PADI Pros' Site tab is signed in**, for "Try the checks": the
 * open tabs on PADI's hosts, each read only for a sign-in address or a
 * password box (`pageAsksToSignIn`). No tab is opened, nothing is typed or
 * searched, and nothing of any page comes back but the one word:
 * `no_access` when this browser keeps the extension off either PADI host.
 */
async function padiSession() {
  const origins = siteOf(AGENCIES.padi);
  if (!(await hostAccess(AGENCIES.padi))) return { ok: true, padi: "no_access" };
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: origins.map((origin) => `${origin}/*`) });
  } catch {
    return { ok: false, reason: "tab_failed" };
  }
  if (tabs.length === 0) return { ok: true, padi: "no_tab" };
  for (const tab of tabs) {
    try {
      const at = new URL(tab.url);
      if (!origins.includes(at.origin) || SIGN_IN_PATH.test(at.pathname)) continue;
      if ((await run(tab.id, pageAsksToSignIn, [SIGN_IN_PATH_SOURCE])) === false) {
        return { ok: true, padi: "signed_in" };
      }
    } catch {
      // A tab still loading, or one this extension may not script: not signed in here.
    }
  }
  return { ok: true, padi: "signed_out" };
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

function validSsiManualQuery(query) {
  if (!query || query.agency !== "ssi") return false;
  const name = (value) => typeof value === "string" && value.length <= 100;
  return (
    name(query.firstName) &&
    name(query.lastName) &&
    (query.firstName.trim() || query.lastName.trim()) &&
    (query.birthDate === null || /^\d{4}-\d{2}-\d{2}$/.test(query.birthDate))
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A sample page of this extension's own, answering the dry run it was opened for.
  if (
    sender.id === chrome.runtime.id &&
    sender.tab &&
    typeof sender.url === "string" &&
    sender.url.startsWith(chrome.runtime.getURL("sample.html")) &&
    message?.type === "dry-run-result"
  ) {
    answerDryRun(sender.tab.id, dryRunResult(message.result));
    return false;
  }
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
  if (message?.type === HELLO_REQUEST_TYPE) {
    sendResponse({
      ok: true,
      version: VERSION,
      agencies: Object.keys(AGENCIES),
      elearning: Object.keys(ELEARNING),
    });
    return false;
  }
  if (message?.type === DRY_RUN_REQUEST_TYPE) {
    const agency = typeof message.query?.agency === "string" ? message.query.agency : "";
    dryRun(agency).then(sendResponse);
    return true;
  }
  if (message?.type === PADI_SESSION_REQUEST_TYPE) {
    padiSession().then(sendResponse);
    return true;
  }
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
        reply.ok
          ? {
              ok: true,
              pageText: excerptAround(reply.pageText, query.email, query.firstName, query.lastName),
            }
          : reply,
      )
      .then(sendResponse);
    return true;
  }
  if (message?.type === SSI_MANUAL_REQUEST_TYPE && validSsiManualQuery(message.query)) {
    openSsiManual(message.query).then(sendResponse);
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
  // Older app copies may still request an automatic SSI check. It now always
  // requires the staffer to review the terms and submit on SSI's own page.
  if (query.agency === "ssi") {
    openSsiManual(query).then(sendResponse);
    return true;
  }
  phase("message:check");
  check(query, AGENCIES)
    .then((reply) => {
      phase(reply.ok ? "reply:ok" : `reply:${reply.reason}`);
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
