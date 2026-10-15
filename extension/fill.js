// Runs inside the agency's lookup page, through chrome.scripting.executeScript,
// so each function here must stand alone: no references outside its own body.
//
// The agencies publish no documentation for their forms, so a field is found
// by what it says about itself (its name, id, placeholder, aria-label and
// label) rather than by a selector that a redesign would silently break. When
// a field the lookup needs cannot be found, nothing is submitted and the app
// falls back to the plain link.

/**
 * Fill the agency's form with one diver and submit it.
 *
 * Nothing is typed until every box the lookup needs, and the button that
 * sends it, has been found: a lookup that cannot be finished leaves the page
 * exactly as it was.
 *
 * A page behind the shop's own sign-in (`spec.signIn`, PADI's Pros' Site) is
 * held tighter than a public lookup: nothing is typed on a sign-in, sign-up or
 * account address (`signInPath`, from protocol.js) or a page asking for a
 * password or, outside any search, an email; nothing is typed anywhere but the
 * page the lookup opened, when its address names one (DiveChek's
 * `/divechek`); every box filled must search, in a form with no other box;
 * a student's email goes only into a box that says it searches or is the
 * student's; and the only button pressed is that search's own.
 *
 * Two answers say the page is not ready rather than changed: `form`, a page
 * with no box to type into at all yet (a form still drawing, a challenge in
 * front of it), and `captcha`, a lookup whose own form asks whether the
 * staffer is human (a captcha box drawn in it, as shape.js reads one). A
 * captcha elsewhere on the page, on a newsletter's form, stops nothing.
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
 * Only the part of a signed-in lookup page about the diver searched for: each
 * line naming them (first and last name in either order, accents and case
 * aside) and the `AFTER` lines under it, the most the server reads as one
 * record (`RECORD_LINES` in src/lib/agency-check.ts), plus the words of any
 * line saying how many divers were found, which say nothing about anyone. When
 * no line names them, only the lines saying why: no result, several divers, or
 * a sign-in, at most `WHY_LINES`. Read with the shop's own PADI sign-in, the
 * rest of the page is not DiveDay's to take.
 *
 * The excerpt must judge as the whole page does, so it reads lines as the
 * judge does (spaces collapsed, blank lines gone), and a `GAP` line stands
 * between lines that were not neighbors on the page: the judge ends a record
 * there, and never pairs labelled name lines across it.
 * @param {string} text
 * @param {string} firstName
 * @param {string} lastName
 */
function excerptAroundName(text, firstName, lastName) {
  const AFTER = 4;
  const WHY_LINES = 10;
  const GAP = "…";
  const COUNT = /(^| )\d+ divers?( found)?( |$)/;
  const WHY =
    /(^| )(no results?|no records?|no matching|no diver|not found|no certifications? found|could not find|unable to find|0 results|sign ?in|log ?in|password|session (has )?expired)( |$)/;
  const NO_RECORD =
    /(^| )(no results?|no records?|no matching|no diver|not found|no certifications? found|could not find|unable to find|0 results)( |$)/;
  // foldText in src/lib/agency-check.ts, wrapped in spaces.
  const fold = (value) =>
    ` ${String(value || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}&]+/gu, " ")
      .trim()} `;
  const first = fold(firstName);
  const last = fold(lastName);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const folded = lines.map(fold);
  const names = (line) => {
    const plain = line.replace(/&/g, " ").replace(/ +/g, " ");
    return (
      first.trim() !== "" && last.trim() !== "" && plain.includes(first) && plain.includes(last)
    );
  };
  // A name split over two adjacent labelled lines ("First name: Lena" over
  // "Last name: Ortiz", either order, Spanish labels too), read exactly as the
  // judge reads it (`splitNamesOf` in src/lib/agency-check.ts): each line one
  // label and the name after it, paired top to bottom once, a pair with a
  // stray labelled line beside it refused, the given line starting with the
  // first name and the family line ending with the last, a few more words at
  // most. The pair, and the record under it, is kept like one name line.
  const LABELS = {
    given: ["first name", "given name", "forename", "nombre"],
    family: ["last name", "family name", "surname", "apellido", "apellidos"],
  };
  const EXTRA_WORDS = 3;
  const partOf = (index) => {
    const line = folded[index].trim();
    for (const part of ["given", "family"]) {
      for (const label of LABELS[part]) {
        if (!line.startsWith(`${label} `)) continue;
        const labelWords = label.split(" ").length;
        const tokens = lines[index].split(" ").filter(Boolean);
        let consumed = 0;
        let at = 0;
        while (at < tokens.length && consumed < labelWords) {
          consumed += fold(tokens[at]).trim().split(" ").filter(Boolean).length;
          at += 1;
        }
        if (consumed !== labelWords) return null;
        return { part, words: line.slice(label.length + 1).split(" ") };
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
  const firstWords = first.trim().split(" ");
  const lastWords = last.trim().split(" ");
  const splitAt = (index) => {
    if (partner.get(index) !== index + 1 || stray(index - 1) || stray(index + 2)) return false;
    const a = parts[index];
    const b = parts[index + 1];
    const given = a.part === "given" ? a : b;
    const family = a.part === "given" ? b : a;
    return (
      given.words.slice(0, firstWords.length).join(" ") === firstWords.join(" ") &&
      family.words.slice(-lastWords.length).join(" ") === lastWords.join(" ") &&
      given.words.length <= firstWords.length + EXTRA_WORDS &&
      family.words.length <= lastWords.length + EXTRA_WORDS
    );
  };
  const named = folded.map((line, index) => names(line) || splitAt(index));
  if (!named.some(Boolean)) {
    return lines
      .map((line, index) => {
        if (WHY.test(folded[index])) return line;
        const count = folded[index].match(COUNT);
        return count ? count[0].trim() : null;
      })
      .filter((line) => line !== null)
      .slice(0, WHY_LINES)
      .join("\n");
  }
  const kept = new Map();
  folded.forEach((line, index) => {
    // The count's own words, never the rest of the line around them, which
    // may name the shop.
    const count = line.match(COUNT);
    if (count && !kept.has(index)) kept.set(index, count[0].trim());
    if (!named[index]) return;
    let end = Math.min(lines.length - 1, index + AFTER + (splitAt(index) ? 1 : 0));
    // A "no results" line straight under the record unsays it for the judge.
    if (end + 1 < lines.length && NO_RECORD.test(folded[end + 1])) end += 1;
    for (let at = index; at <= end; at += 1) kept.set(at, lines[at]);
  });
  // Labelled name lines keep their page pairing: a kept line's partner, and a
  // stray labelled line beside a kept pair, are kept with it.
  for (const index of [...kept.keys()]) {
    const other = partner.get(index);
    if (other === undefined) continue;
    kept.set(other, lines[other]);
    const above = Math.min(index, other) - 1;
    const below = Math.max(index, other) + 1;
    if (stray(above)) kept.set(above, lines[above]);
    if (stray(below)) kept.set(below, lines[below]);
  }
  const out = [];
  let previous = null;
  for (const index of [...kept.keys()].sort((a, b) => a - b)) {
    if (previous !== null && index !== previous + 1) out.push(GAP);
    out.push(kept.get(index));
    previous = index;
  }
  return out.join("\n");
}

globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  fillAgencyForm,
  readAgencyPage,
  pageAsksToSignIn,
  excerptAround,
  excerptAroundName,
});
