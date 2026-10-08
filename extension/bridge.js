// The content script on DiveDay's own pages: it tells the page the extension
// is here, and carries the page's one request to the service worker and the
// answer back. It accepts a message only from this page's own window.
(() => {
  const {
    VERSION,
    MARKER_ATTRIBUTE,
    READY_EVENT,
    PAGE_SOURCE,
    EXTENSION_SOURCE,
    REQUEST_TYPE,
    ELEARNING_REQUEST_TYPE,
    RESULT_TYPE,
  } = globalThis.DiveDayCertCheck;

  document.documentElement.setAttribute(MARKER_ATTRIBUTE, VERSION);
  window.dispatchEvent(new Event(READY_EVENT));

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE) return;
    if (data.type !== REQUEST_TYPE && data.type !== ELEARNING_REQUEST_TYPE) return;
    if (typeof data.requestId !== "string" || data.requestId.length > 100) return;
    const reply = (result) =>
      window.postMessage(
        { source: EXTENSION_SOURCE, type: RESULT_TYPE, requestId: data.requestId, ...result },
        window.location.origin,
      );
    chrome.runtime
      .sendMessage({ type: data.type, query: data.query })
      .then((result) => reply(result && typeof result === "object" ? result : { ok: false }))
      .catch(() => reply({ ok: false, reason: "tab_failed" }));
  });
})();
