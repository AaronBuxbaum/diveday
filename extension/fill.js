// Runs inside the agency's lookup page, through chrome.scripting.executeScript,
// so each function here must stand alone: no references outside its own body.
//
// The agencies publish no documentation for their forms, so a field is found
// by what it says about itself (its name, id, placeholder, aria-label and
// label) rather than by a selector that a redesign would silently break. When
// a field the lookup needs cannot be found, nothing is submitted and the app
// falls back to the plain link.

/** Fill visible SSI fields after the staffer reveals them; never submit or accept terms. */
function fillSsiManualForm(query, sample = false) {
  if (
    !sample &&
    (location.origin !== "https://my.divessi.com" ||
      location.pathname.replace(/\/+$/, "") !== "/online_diver_check")
  )
    return false;
  function words(box) {
    return [
      box.name,
      box.id,
      box.placeholder,
      box.getAttribute("aria-label"),
      ...Array.from(box.labels || [], (label) => label.textContent),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ");
  }
  const root = sample
    ? document.querySelector("form")
    : document.querySelector("#show_diver_check");
  if (!root) return false;
  let observer;
  let timer;
  let writing = false;
  function stop() {
    observer?.disconnect();
    if (timer) clearTimeout(timer);
    window.removeEventListener("pagehide", stop);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("input", onEdit, true);
    query = null;
  }
  function onEdit(event) {
    const target = event.target;
    if (
      !writing &&
      target instanceof HTMLInputElement &&
      root.contains(target) &&
      ["text", "date", "number"].includes(target.type)
    )
      stop();
  }
  function onChange(event) {
    onEdit(event);
    if (query && !writing) attempt();
  }
  function visible(box) {
    if (
      typeof box.checkVisibility === "function" &&
      !box.checkVisibility({ visibilityProperty: true })
    )
      return false;
    for (let at = box; at; at = at.parentElement) {
      const style = window.getComputedStyle(at);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }
  function attempt() {
    if (
      !root.isConnected ||
      (!sample &&
        (location.origin !== "https://my.divessi.com" ||
          location.pathname.replace(/\/+$/, "") !== "/online_diver_check"))
    )
      return stop();
    const boxes = Array.from(root.querySelectorAll('input:not([type="hidden"])')).filter(
      (box) => !box.disabled && !box.readOnly && ["text", "date"].includes(box.type),
    );
    function unique(pattern) {
      const matches = boxes.filter((box) => pattern.test(words(box)));
      return matches.length === 1 ? matches[0] : null;
    }
    const first = unique(/\b(first|given)\s*name\b/i);
    const last = unique(/\b(last|family)\s*name\b/i);
    if (
      !first ||
      !last ||
      !first.form ||
      first.form !== last.form ||
      !visible(first) ||
      !visible(last)
    )
      return;
    const birthday = unique(/\b(birthday|birth\s*date|date\s*of\s*birth)\b/i);
    if (query.birthDate && (!birthday || birthday.form !== first.form || !visible(birthday)))
      return;
    const fields = [
      [first, query.firstName],
      [last, query.lastName],
      [birthday?.form === first.form ? birthday : null, query.birthDate],
    ];
    // Do not combine the diver's information with a different person already
    // in the form, even if the conflicting box is currently hidden.
    const masterId = root.querySelector("#verify-mid");
    if (
      masterId?.value ||
      fields.some(
        ([box, value]) =>
          box?.value && (!value || box.value.trim().toLowerCase() !== value.trim().toLowerCase()),
      )
    )
      return stop();
    writing = true;
    for (const [box, value] of fields) {
      if (!box || !value || box.value) continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    writing = false;
    stop();
  }
  observer = new MutationObserver(attempt);
  observer.observe(root, { childList: true, subtree: true, attributes: true });
  timer = setTimeout(stop, 120_000);
  window.addEventListener("pagehide", stop, { once: true });
  document.addEventListener("change", onChange, true);
  document.addEventListener("input", onEdit, true);
  attempt();
  return true;
}

/**
 * Fill and submit an automatic agency lookup. Missing fields and captchas stop
 * the search; signed-in pages are restricted to their own search controls.
 * @param {{firstName: string, lastName: string, birthDate?: string|null, cardNumber?: string|null, email?: string}} query
 * @param {{fields: string[], dateFormat: string, either?: boolean, signIn?: boolean}} spec
 * @param {string} [signInPath] the source of `SIGN_IN_PATH` (protocol.js)
 * @returns {{ok: true} | {ok: false, missing: string[]}}
 */
function fillAgencyForm(query, spec, signInPath) {
  const PATTERNS = {
    first: /first|given|fname|forename|nombre/i,
    last: /last|family|surname|lname|apellido/i,
    name: /(^|[^a-z])(full ?)?name([^a-z]|$)/i,
    birthDate: /birth|dob|bday|nacimiento/i,
    month: /month|mes/i,
    day: /(^|[^a-z])day([^a-z]|$)|dia|día/i,
    year: /year|año|ano/i,
    number: /number|card|cert|code|c[oó]digo|#/i,
    email: /e-?mail|correo|student/i,
  };
  // Whole words, so "Research" is not a search. A box says it searches with
  // these; a signed-in search's own button may also say check or verify.
  const BOX_SEARCH = /\b(search|find|look ?up|buscar)\b/i;
  // PADI's own DiveChek instructions say its button reads "Run Report".
  const BUTTON_SEARCH =
    /\b(search|find|look ?up|check|chek|divechek|verify|run ?report|buscar|verificar)\b/i;
  const SUBMITS = 'button, input[type="submit"]';
  // A signed-in email box that searches only because its form's button says
  // so must also say whose email it wants: "Email a copy to" is not a search.
  const STUDENT = /\b(student|alumno|estudiante|diver|buceador)\b/i;

  /** Words as a person reads them: "searchFirstName" and "search_first" are two words each. */
  function words(text) {
    return String(text || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-.]+/g, " ");
  }

  function describe(element) {
    const parts = [
      element.getAttribute("name"),
      element.id,
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
    ];
    if (element.labels) for (const label of element.labels) parts.push(label.textContent);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const label = document.getElementById(id);
        if (label) parts.push(label.textContent);
      }
    }
    return parts.filter(Boolean).join(" ");
  }

  function buttonWords(button) {
    return words(button.textContent || button.value || button.getAttribute("aria-label") || "");
  }

  function visible(element) {
    if (element.type === "hidden" || element.disabled || element.readOnly) return false;
    // On the page as a person sees it: a block hidden around the element
    // hides it too.
    if (typeof element.checkVisibility === "function") {
      return element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    }
    for (let at = element; at; at = at.parentElement) {
      const style = window.getComputedStyle(at);
      if (style.display === "none") return false;
      if (at === element && style.visibility === "hidden") return false;
    }
    return window.getComputedStyle(element).visibility !== "hidden";
  }

  /** A button a lookup may press: on the page, and never a reset. */
  function pressable(element) {
    return visible(element) && element.type !== "reset";
  }

  /** A box a lookup could type into: not a button, a tick, a file, a password or an email. */
  function typable(element) {
    return (
      visible(element) &&
      !/^(submit|button|checkbox|radio|file|image|reset|password|email)$/i.test(element.type)
    );
  }

  const signedInPage = spec.signIn === true;

  // A search box says so itself: by its type, a search landmark around it, or
  // its own words.
  function boxSearches(box) {
    return (
      box.type === "search" ||
      Boolean(box.closest('[role="search"]')) ||
      BOX_SEARCH.test(words(describe(box)))
    );
  }

  // A form's button speaks for its boxes only when the form is small: its one
  // submit control says search ("one"), or it says search among others
  // ("all"); either way every box in the form must be one this lookup fills,
  // checked once the boxes are found. A profile form with a Search beside its
  // Save, or a Verify under a Phone box, is neither. A reset is never one.
  function formSearches(form) {
    if (!form) return null;
    const submits = Array.from(form.querySelectorAll(SUBMITS)).filter(
      (button) => visible(button) && button.type !== "reset",
    );
    const searching = submits.filter((button) => BUTTON_SEARCH.test(buttonWords(button)));
    if (searching.length === 0) return null;
    return submits.length === 1 ? "one" : "all";
  }

  function searches(box) {
    return boxSearches(box) || formSearches(box.form) !== null;
  }

  const controls = Array.from(document.querySelectorAll("input, select")).filter(
    (element) =>
      typable(element) &&
      // Behind a sign-in, a diver's details go only into a search.
      (!signedInPage || searches(element)),
  );
  // An email box is only ever filled with the student's email, never a name.
  const emailBoxes = Array.from(document.querySelectorAll("input")).filter(
    (element) =>
      visible(element) &&
      (element.type === "email" ||
        ((element.type === "text" || element.type === "search") &&
          PATTERNS.email.test(describe(element)))),
  );

  function find(pattern, except) {
    return controls.find((element) => !except.includes(element) && pattern.test(describe(element)));
  }

  function setValue(element, value) {
    const proto =
      element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function optionValue(element, wanted) {
    const options = Array.from(element.options);
    const match = options.find(
      (option) =>
        wanted.some((value) => option.value === value) ||
        wanted.some((value) => option.textContent.trim().toLowerCase() === value.toLowerCase()),
    );
    return match ? match.value : null;
  }

  function formatDate(iso, format) {
    const [year, month, day] = iso.split("-");
    return format.replace("YYYY", year).replace("MM", month).replace("DD", day);
  }

  // A sign-in page is never filled: typing a diver's details into an agency's
  // sign-in form would be an attempt to sign in as them. The staffer signs in
  // themselves, and the check falls back to the link until they have.
  const asksForPassword = Array.from(document.querySelectorAll('input[type="password"]')).some(
    visible,
  );
  if (asksForPassword) return { ok: false, missing: ["signedIn"] };
  // A student's email goes only into a search, never a page that signs in,
  // signs up or manages an account, whose first box may also ask for an email.
  const typesEmail = Array.isArray(spec.fields) && spec.fields.includes("email");
  if (typesEmail || signedInPage) {
    // No address rule to hold the page to is no page to type on.
    if (typeof signInPath !== "string" || signInPath.length === 0) {
      return { ok: false, missing: ["signedIn"] };
    }
    if (new RegExp(signInPath, "i").test(location.pathname)) {
      return { ok: false, missing: ["signedIn"] };
    }
  }
  // A signed-in lookup that opens a page of its own (DiveChek) is filled on
  // that page only, never on another of the site's pages it was sent to.
  if (signedInPage) {
    const trim = (path) => path.replace(/\/+$/, "").toLowerCase();
    let wanted = "";
    try {
      wanted = trim(new URL(spec.url).pathname);
    } catch {
      return { ok: false, missing: ["page"] };
    }
    if (wanted !== "" && trim(location.pathname) !== wanted) {
      return { ok: false, missing: ["page"] };
    }
  }
  // A sign-in that asks for the email first and the password on the next
  // step: an email box that is not a search, on a signed-in page.
  if (
    signedInPage &&
    Array.from(document.querySelectorAll('input[type="email"]')).some(
      (box) => visible(box) && !searches(box),
    )
  ) {
    return { ok: false, missing: ["signedIn"] };
  }
  // No box to type into anywhere yet: the page has not drawn its form.
  if (
    !Array.from(document.querySelectorAll("input, select")).some(typable) &&
    emailBoxes.length === 0
  ) {
    return { ok: false, missing: ["form"] };
  }

  // What will be typed where, decided before anything is typed.
  const plan = [];
  const used = () => plan.map((entry) => entry.box);
  const missing = [];

  function planName() {
    const first = find(PATTERNS.first, used());
    const last = first ? find(PATTERNS.last, [...used(), first]) : null;
    if (first && last) {
      plan.push({ box: first, value: query.firstName }, { box: last, value: query.lastName });
      return true;
    }
    const whole = find(PATTERNS.name, used());
    if (whole) {
      plan.push({ box: whole, value: `${query.firstName} ${query.lastName}` });
      return true;
    }
    return false;
  }

  function planBirthDate() {
    if (!query.birthDate) return false;
    const single = find(PATTERNS.birthDate, used());
    if (single && single.tagName === "INPUT") {
      plan.push({
        box: single,
        value:
          single.type === "date" ? query.birthDate : formatDate(query.birthDate, spec.dateFormat),
      });
      return true;
    }
    const [year, month, day] = query.birthDate.split("-");
    const monthBox = find(PATTERNS.month, used());
    const dayBox = find(PATTERNS.day, [...used(), monthBox]);
    const yearBox = find(PATTERNS.year, [...used(), monthBox, dayBox]);
    if (!monthBox || !dayBox || !yearBox) return false;
    const monthNames = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const monthName = monthNames[Number(month) - 1];
    function value(box, typed, options) {
      return box.tagName === "SELECT" ? optionValue(box, options) : typed;
    }
    const entries = [
      {
        box: monthBox,
        value: value(monthBox, month, [
          month,
          String(Number(month)),
          monthName,
          monthName.slice(0, 3),
        ]),
      },
      { box: dayBox, value: value(dayBox, day, [day, String(Number(day))]) },
      { box: yearBox, value: value(yearBox, year, [year]) },
    ];
    if (entries.some((entry) => entry.value === null)) return false;
    plan.push(...entries);
    return true;
  }

  function planNumber() {
    if (!query.cardNumber) return false;
    const box = find(PATTERNS.number, used());
    if (box?.tagName !== "INPUT") return false;
    plan.push({ box, value: query.cardNumber });
    return true;
  }

  function planEmail() {
    if (!query.email) return false;
    const box = emailBoxes.find(
      (element) =>
        !used().includes(element) &&
        searches(element) &&
        (!signedInPage || boxSearches(element) || STUDENT.test(words(describe(element)))),
    );
    if (!box) return false;
    plan.push({ box, value: query.email });
    return true;
  }

  const planners = {
    name: planName,
    birthDate: planBirthDate,
    number: planNumber,
    email: planEmail,
  };
  if (spec.either) {
    // CMAS: the code alone when there is one, or names and birth date.
    const byNumber = Boolean(query.cardNumber) && planNumber();
    if (!byNumber) {
      if (!planName()) missing.push("name");
      if (!planBirthDate()) missing.push("birthDate");
    }
  } else {
    for (const field of spec.fields) if (!planners[field]()) missing.push(field);
  }
  if (missing.length > 0 || plan.length === 0) return { ok: false, missing };

  const boxes = used();
  const form = boxes[0].form;
  let button = null;
  if (signedInPage) {
    // Every box in one search. A box that searches only because its form's
    // button says so is in a form whose every box this lookup fills.
    if (boxes.some((box) => box.form !== form)) return { ok: false, missing: ["submit"] };
    if (!boxes.every(boxSearches) && formSearches(form) !== null) {
      const others = Array.from(form.querySelectorAll("input, select")).filter(
        (element) => typable(element) && !boxes.includes(element),
      );
      if (others.length > 0) return { ok: false, missing: spec.fields.slice() };
    }
    // Only the search's own button: never another of the signed-in page's
    // buttons, whatever it says, and never a bare submit of the form.
    button = form
      ? Array.from(form.querySelectorAll(SUBMITS)).find(
          (element) =>
            visible(element) &&
            element.type !== "reset" &&
            BUTTON_SEARCH.test(buttonWords(element)),
        ) || null
      : Array.from(
          (boxes[0].closest('[role="search"]') || document.createElement("div")).querySelectorAll(
            SUBMITS,
          ),
        ).find(visible) || null;
    if (!button) return { ok: false, missing: ["submit"] };
  } else if (spec.either) {
    // CMAS: one page, two searches, each with its own button ("Search by code"
    // under the code, "Manual Search" under the names and birth date), in one
    // form or none. The search performed is the first search button after its
    // last box, in the nearest block around that box that has one.
    const last = boxes[boxes.length - 1];
    for (let around = last.parentElement; around && !button; around = around.parentElement) {
      button =
        Array.from(around.querySelectorAll(SUBMITS)).find(
          (element) =>
            pressable(element) &&
            BUTTON_SEARCH.test(buttonWords(element)) &&
            Boolean(last.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
        ) || null;
    }
    if (!button) return { ok: false, missing: ["submit"] };
  } else {
    // The form's search-worded button first, else its first submit; never a
    // reset, and never a wordless type="button" (a date picker's toggle).
    const formButtons = form ? Array.from(form.querySelectorAll(SUBMITS)).filter(pressable) : [];
    button =
      formButtons.find((element) => BUTTON_SEARCH.test(buttonWords(element))) ||
      formButtons.find((element) => element.type === "submit") ||
      Array.from(document.querySelectorAll(SUBMITS)).find(
        (element) =>
          pressable(element) &&
          /search|find|verify|check|submit|buscar|verificar/i.test(
            element.textContent || element.value || "",
          ),
      ) ||
      null;
    if (!button && !form) return { ok: false, missing: ["submit"] };
  }

  // The lookup's own form, or the nearest block holding its boxes and button.
  let scope = form;
  for (let around = boxes[0].parentElement; !scope && around; around = around.parentElement) {
    if (boxes.every((box) => around.contains(box)) && (!button || around.contains(button))) {
      scope = around;
    }
  }
  // A captcha box drawn in that form (shape.js reads one the same way):
  // outside reCAPTCHA's badge and any invisible widget. Nothing is typed.
  const asksIfHuman = Array.from(
    (scope || document).querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]',
    ),
  ).some(
    (frame) =>
      visible(frame) &&
      !frame.closest(".grecaptcha-badge, [data-size='invisible']") &&
      !/[?&]size=invisible/.test(frame.getAttribute("src") || ""),
  );
  if (asksIfHuman) return { ok: false, missing: ["captcha"] };

  for (const entry of plan) setValue(entry.box, entry.value);
  if (button) {
    button.click();
  } else {
    form.requestSubmit();
  }
  return { ok: true };
}

/**
 * Whether the page asks to sign in: a password box on it, or an address that
 * signs in, signs up or manages an account (`signInPath`, from protocol.js).
 * A searched page behind the shop's sign-in that does is a lapsed session,
 * never a result.
 * @param {string} signInPath
 */
function pageAsksToSignIn(signInPath) {
  if (typeof signInPath !== "string" || signInPath.length === 0) return true;
  if (new RegExp(signInPath, "i").test(location.pathname)) return true;
  return Array.from(document.querySelectorAll('input[type="password"]')).some((box) => {
    if (box.disabled) return false;
    if (typeof box.checkVisibility === "function") {
      return box.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    }
    for (let at = box; at; at = at.parentElement) {
      if (window.getComputedStyle(at).display === "none") return false;
    }
    return window.getComputedStyle(box).visibility !== "hidden";
  });
}

/** The page's text as a person would read it, one block per line. */
function readAgencyPage() {
  return document.body ? document.body.innerText : "";
}

/**
 * Only the part of an eLearning page about the student searched for, read
 * with the staffer's PADI sign-in, whose other rows are other students' and
 * not DiveDay's to take. Each line carrying the student's email, the line
 * naming them just above it (first and last name, accents and case aside,
 * within the `AFTER` lines the server reads as one record), and the lines
 * under it that are a course, a status or a date, never past `AFTER` lines
 * from the name line (or the email's, with no name line above it), the
 * record the server reads (src/lib/elearning-check.ts). Never a line
 * carrying any other address, never past one, never a line with no course,
 * status or digit on it (the next student's name), and never the line just
 * above another address, which names that address's student, unless it is a
 * status alone ("Complete"), which is this student's.
 * When no line carries the email, only the lines saying why (no result, a
 * count, a sign-in), at most `WHY_LINES`, none with an address on it.
 * @param {string} text
 * @param {string} email
 * @param {string} firstName
 * @param {string} lastName
 */
function excerptAround(text, email, firstName, lastName) {
  const AFTER = 6;
  const WHY_LINES = 10;
  // An address as the server reads one: never brackets or punctuation around it.
  const ADDRESS = /[^\s@,;:()<>]+@[^\s@,;:()<>]+\.[a-z]{2,}/gi;
  const COUNT = /(^| )\d+ (students?|results?|records?)( found)?( |$)/;
  const WHY =
    /(^| )(no results?|no records?|no matching|no students?|not found|could not find|unable to find|0 results|sign ?in|log ?in|password|session (has )?expired)( |$)/;
  // The server's status words (src/lib/elearning-check.ts), folded.
  const STATUS_WORDS = [
    "incomplete",
    "not complete",
    "not completed",
    "in progress",
    "not started",
    "pending",
    "expired",
    "refunded",
    "revoked",
    "cancelled",
    "canceled",
    "suspended",
    "started",
    "partial",
    "assigned",
    "enrolled",
    "awaiting",
    "due",
    "complete by",
    "complete",
    "completed",
    "status",
    "progress",
  ];
  const COURSE =
    /(^| )(diver|course|online|elearning|e learning|open water|advanced|rescue|master|divemaster|instructor|specialty|enriched|nitrox|refresher|reactivate|tec|scuba)( |$)/;
  const fold = (value) =>
    ` ${String(value || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()} `;
  const addressesOn = (line) =>
    (line.match(ADDRESS) || []).map((address) => address.replace(/[.,;:)>]+$/, "").toLowerCase());
  const wanted = email.trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  const folded = lines.map(fold);
  const others = lines.map((line) => addressesOn(line).some((address) => address !== wanted));
  const carries = lines.map((line) => addressesOn(line).includes(wanted));
  const first = fold(firstName);
  const last = fold(lastName);
  const names = (index) => {
    const line = fold(lines[index].replace(ADDRESS, " "));
    return first.trim() !== "" && last.trim() !== "" && line.includes(first) && line.includes(last);
  };
  const hasStatus = (index) => STATUS_WORDS.some((word) => folded[index].includes(` ${word} `));
  /** A status and nothing else: "Complete", "In progress", "100%". */
  const statusOnly = (index) => {
    let rest = folded[index];
    for (const word of STATUS_WORDS) rest = rest.split(` ${word} `).join(" ");
    return folded[index].trim() !== "" && rest.replace(/\d{1,3}/g, " ").trim() === "";
  };
  /** A line a record of this student's may run on with: a course, a status or a date. */
  const recordLine = (index) =>
    /\d/.test(lines[index]) || hasStatus(index) || COURSE.test(folded[index]);
  const keep = new Set();
  lines.forEach((_, index) => {
    if (!carries[index] || others[index]) return;
    keep.add(index);
    // The student's name line above, when the address sits under it: the
    // record is then read from there, as the server reads it.
    let from = index;
    for (let at = index - 1; at >= Math.max(0, index - AFTER); at -= 1) {
      if (others[at] || carries[at]) break;
      if (names(at)) {
        for (let line = at; line < index; line += 1) keep.add(line);
        from = at;
        break;
      }
    }
    for (let at = index + 1; at <= Math.min(lines.length - 1, from + AFTER); at += 1) {
      if (others[at] || carries[at]) break;
      if (!recordLine(at)) break;
      // The line just above another address names that address's student,
      // unless it is a status alone, which is this student's.
      if (at + 1 < lines.length && others[at + 1] && !statusOnly(at)) break;
      keep.add(at);
    }
  });
  if (keep.size === 0) {
    return lines
      .filter(
        (_, index) => !others[index] && (WHY.test(folded[index]) || COUNT.test(folded[index])),
      )
      .slice(0, WHY_LINES)
      .join("\n");
  }
  return lines.filter((_, index) => keep.has(index)).join("\n");
}

/**
 * Only the part of a DiveChek page the server reads about the diver searched
 * for: each of their records, from the line naming them (first and last name
 * in either order, accents and case aside, or split over two labelled lines)
 * to the line where the server ends it (`readAgencyPage` in
 * src/lib/agency-check.ts): the first line that could be someone else's, or
 * the `recordLines`-th line under the name. Every other line comes back only
 * as the words on it that say why or how many ("no results", "2 divers
 * found", "sign in"), once each, above the records: never a neighbour's name,
 * birth date or card, and nothing around a count. A "no results" line
 * straight under a record, which unsays it for the server, comes back there
 * as its words. Read with the shop's own PADI sign-in, the rest of the page
 * is not DiveDay's to take. Only PADI's lookup is behind a sign-in, so only a
 * DiveChek page comes here (background.js).
 *
 * The excerpt must judge as the whole page does, verdict and evidence alike,
 * so it reads lines as the server does (spaces collapsed, blank lines gone),
 * ends a record with the server's own words (`DIVECHEK_RECORD` in
 * protocol.js), keeps a kept labelled name line's page partner, and puts a
 * `GAP` line, which ends a record and never pairs, between lines that were
 * not neighbors on the page.
 * @param {string} text
 * @param {string} firstName
 * @param {string} lastName
 */
function excerptAroundName(text, firstName, lastName) {
  const reading = globalThis.DiveDayCertCheck?.DIVECHEK_RECORD;
  if (!reading) throw new Error("excerptAroundName needs protocol.js");
  const GAP = "…";
  // foldText in src/lib/agency-check.ts.
  const fold = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}&]+/gu, " ")
      .trim();
  const hasWords = (line, phrase) => phrase.length > 0 && ` ${line} `.includes(` ${phrase} `);
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = fold(firstName);
  const last = fold(lastName);
  const raw = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = raw.map(fold);

  // The words that say why or how many, each a whole phrase of the line.
  const noRecordWords = reading.noRecordWords.map(fold);
  const saysNoRecord = (line) => noRecordWords.some((phrase) => hasWords(line, phrase));
  const COUNT = /(?<=^| )\d+ divers?( found)?(?= |$)/g;
  const SIGN_IN = /(?<=^| )(sign ?in|log ?in|password|session (has )?expired)(?= |$)/g;
  const whyWords = (line) => [
    ...noRecordWords.filter((phrase) => hasWords(line, phrase)),
    ...[...line.matchAll(COUNT)].map((match) => match[0]),
    ...[...line.matchAll(SIGN_IN)].map((match) => match[0]),
  ];

  // Dates as the server reads them (`datesOn`).
  const DATE_ON_LINE =
    /(?<![\p{L}\p{N}])(?:(\d{4}) (\d{1,2}) (\d{1,2})|(\d{1,2}) (\d{1,2}) (\d{4})|(\d{1,2}) ([a-z]+) (\d{4})|([a-z]+) (\d{1,2}) (\d{4}))(?![\p{L}\p{N}])/gu;
  const monthNumber = (word) => {
    const index = reading.monthNames.findIndex(
      (name) =>
        word === name || word === name.slice(0, 3) || (name === "september" && word === "sept"),
    );
    return index === -1 ? null : index + 1;
  };
  const isoDate = (year, month, day) =>
    month < 1 || month > 12 || day < 1 || day > 31 ? null : `${year}-${month}-${day}`;
  const hasDate = (line) => {
    for (const m of line.matchAll(DATE_ON_LINE)) {
      let date = null;
      if (m[1]) {
        date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
      } else if (m[4]) {
        const a = Number(m[4]);
        const b = Number(m[5]);
        const year = Number(m[6]);
        if (a > 12) date = isoDate(year, b, a);
        else if (b > 12) date = isoDate(year, a, b);
        else date = reading.dates === "mdy" ? isoDate(year, a, b) : isoDate(year, b, a);
      } else if (m[7]) {
        const month = monthNumber(m[8]);
        date = month ? isoDate(Number(m[9]), month, Number(m[7])) : null;
      } else if (m[10]) {
        const month = monthNumber(m[10]);
        date = month ? isoDate(Number(m[12]), month, Number(m[11])) : null;
      }
      if (date) return true;
    }
    return false;
  };

  // A record's words as the server reads them (`readAgencyPage`).
  const levelWording = reading.levelWording.map(fold);
  const listedWording = reading.listedWording.map(fold);
  const limiting = reading.limitingWords.map(fold);
  const furniture = reading.furnitureWords.map(fold);
  const controls = reading.searchControlLines.map(fold);
  const trainer = reading.trainerWords.map(fold);
  const recordLineWords = new Set(reading.recordLineWords);
  const withoutCardNames = (line) =>
    listedWording
      .reduce((rest, phrase) => ` ${rest} `.split(` ${phrase} `).join(" "), line)
      .replace(/ +/g, " ")
      .trim();
  const isFurniture = (line) =>
    furniture.some((phrase) => line === phrase || line.startsWith(`${phrase} `)) ||
    controls.some((control) => line === control);
  const limits = (line) => limiting.some((word) => hasWords(withoutCardNames(line), word));
  const ratingWords = (line) =>
    levelWording.some((phrase) => hasWords(line, phrase)) ||
    listedWording.some((phrase) => hasWords(line, phrase)) ||
    limiting.some((word) => hasWords(line, word));
  const recordLinePhrases = [...levelWording, ...listedWording, ...limiting].sort(
    (a, b) => b.length - a.length,
  );
  const isRecordLine = (line) => {
    let rest = ` ${line} `;
    for (const phrase of recordLinePhrases) rest = rest.split(` ${phrase} `).join("  ");
    return rest
      .trim()
      .split(/ +/)
      .every((word) => !word || /\p{N}/u.test(word) || recordLineWords.has(word));
  };

  // The diver's name on one line, as the server reads it.
  const forward = new RegExp(`(^| )${escapeRegExp(first)}( \\S+)* ${escapeRegExp(last)}( |$)`);
  const reversed = new RegExp(`(^| )${escapeRegExp(last)} ?, ?${escapeRegExp(first)}( |$)`);
  const commaFolded = raw.map((line) =>
    line
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}&,]+/gu, " ")
      .replace(/ ?, ?/g, " , ")
      .trim(),
  );
  const namesDiver = (index) => forward.test(lines[index]) || reversed.test(commaFolded[index]);

  // A name split over two adjacent labelled lines, as the server reads it
  // (`splitNamesOf`): paired top to bottom once, a pair with a stray labelled
  // line beside it refused.
  const partOf = (index) => {
    for (const part of ["given", "family"]) {
      for (const label of reading.nameLabels[part]) {
        if (!lines[index].startsWith(`${label} `)) continue;
        const labelWords = label.split(" ").length;
        const tokens = raw[index].split(" ").filter(Boolean);
        let consumed = 0;
        let at = 0;
        while (at < tokens.length && consumed < labelWords) {
          consumed += fold(tokens[at]).split(" ").filter(Boolean).length;
          at += 1;
        }
        if (consumed !== labelWords) return null;
        return { part, words: lines[index].slice(label.length + 1).split(" ") };
      }
    }
    return null;
  };
  const parts = lines.map((_, index) => partOf(index));
  const partner = new Map();
  for (let index = 0; index + 1 < parts.length; ) {
    const a = parts[index];
    const b = parts[index + 1];
    if (a && b && a.part !== b.part) {
      partner.set(index, index + 1);
      partner.set(index + 1, index);
      index += 2;
    } else {
      index += 1;
    }
  }
  const stray = (index) => parts[index] != null && !partner.has(index);
  const firstWords = first.split(" ");
  const lastWords = last.split(" ");
  const splitNameAt = (index) => {
    if (partner.get(index) !== index + 1 || stray(index - 1) || stray(index + 2)) return false;
    const a = parts[index];
    const b = parts[index + 1];
    const given = a.part === "given" ? a : b;
    const family = a.part === "given" ? b : a;
    if (
      given.words.slice(0, firstWords.length).join(" ") !== first ||
      family.words.slice(-lastWords.length).join(" ") !== last ||
      given.words.length > firstWords.length + reading.splitNameExtraWords ||
      family.words.length > lastWords.length + reading.splitNameExtraWords
    ) {
      return false;
    }
    const name = `${given.words.join(" ")} ${family.words.join(" ")}`;
    return !/\p{N}/u.test(name) && !ratingWords(name) && !trainer.some((w) => hasWords(name, w));
  };

  // Each record of the diver's, ended where the server ends a DiveChek record.
  const kept = new Map();
  const below = new Map();
  if (first !== "" && last !== "") {
    for (let index = 0; index < lines.length; index += 1) {
      const split = splitNameAt(index);
      if (!split && !namesDiver(index)) continue;
      const nameEnd = split ? index + 1 : index;
      const ownDate = !split && hasDate(lines[index]);
      let to = nameEnd + 1;
      while (to < lines.length && to <= nameEnd + reading.recordLines) {
        const line = lines[to];
        if (saysNoRecord(line)) break;
        if (isFurniture(line)) {
          if (limits(line)) to += 1;
          break;
        }
        if (split && !isRecordLine(line)) break;
        if (namesDiver(to) || splitNameAt(to)) break;
        const birthDateLine = to === nameEnd + 1 && !ownDate && hasDate(line);
        if (!birthDateLine && !ratingWords(line) && (!/\d/.test(line) || hasDate(line))) break;
        to += 1;
      }
      for (let at = index; at < to; at += 1) kept.set(at, raw[at]);
      if (to < lines.length && saysNoRecord(lines[to])) below.set(to, whyWords(lines[to])[0]);
    }
  }
  // Labelled name lines keep their page pairing: a kept line's partner, and a
  // stray labelled line beside a kept pair, are kept with it.
  for (const index of [...kept.keys()]) {
    const other = partner.get(index);
    if (other === undefined) continue;
    kept.set(other, raw[other]);
    const above = Math.min(index, other) - 1;
    const under = Math.max(index, other) + 1;
    if (stray(above)) kept.set(above, raw[above]);
    if (stray(under)) kept.set(under, raw[under]);
  }

  const why = new Set();
  lines.forEach((line, index) => {
    if (!kept.has(index)) for (const words of whyWords(line)) why.add(words);
  });
  const out = [...why];
  let previous = null;
  const indices = [...new Set([...kept.keys(), ...below.keys()])].sort((a, b) => a - b);
  for (const index of indices) {
    const whole = kept.has(index);
    // A "no results" line's words sit straight under their record, and
    // nothing runs on from them.
    if (previous !== null && (index !== previous + 1 || !kept.has(previous))) out.push(GAP);
    out.push(whole ? kept.get(index) : below.get(index));
    previous = index;
  }
  return out.join("\n");
}

globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  fillSsiManualForm,
  fillAgencyForm,
  readAgencyPage,
  pageAsksToSignIn,
  excerptAround,
  excerptAroundName,
});
