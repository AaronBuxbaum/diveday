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
 * password or, outside any search, an email; every box filled must search;
 * and the only button pressed is that search's own.
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
  const BUTTON_SEARCH = /\b(search|find|look ?up|check|chek|divechek|verify|buscar|verificar)\b/i;
  const SUBMITS = 'button, input[type="submit"]';

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
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
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
  // submit control says search ("one"), or it says search among others and
  // every box in the form is one this lookup fills ("all", checked once the
  // boxes are found). A profile form with a Search beside its Save is neither.
  function formSearches(form) {
    if (!form) return null;
    const submits = Array.from(form.querySelectorAll(SUBMITS)).filter(visible);
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
    const box = emailBoxes.find((element) => !used().includes(element) && searches(element));
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
    if (!boxes.every(boxSearches) && formSearches(form) === "all") {
      const others = Array.from(form.querySelectorAll("input, select")).filter(
        (element) => typable(element) && !boxes.includes(element),
      );
      if (others.length > 0) return { ok: false, missing: spec.fields.slice() };
    }
    // Only the search's own button: never another of the signed-in page's
    // buttons, whatever it says, and never a bare submit of the form.
    button = form
      ? Array.from(form.querySelectorAll(SUBMITS)).find(
          (element) => visible(element) && BUTTON_SEARCH.test(buttonWords(element)),
        ) || null
      : Array.from(
          (boxes[0].closest('[role="search"]') || document.createElement("div")).querySelectorAll(
            SUBMITS,
          ),
        ).find(visible) || null;
    if (!button) return { ok: false, missing: ["submit"] };
  } else {
    button =
      (form &&
        Array.from(form.querySelectorAll(SUBMITS)).find(
          (element) => element.type === "submit" || element.tagName === "BUTTON",
        )) ||
      Array.from(document.querySelectorAll(SUBMITS)).find((element) =>
        /search|find|verify|check|submit|buscar|verificar/i.test(
          element.textContent || element.value || "",
        ),
      ) ||
      null;
    if (!button && !form) return { ok: false, missing: ["submit"] };
  }

  for (const entry of plan) setValue(entry.box, entry.value);
  if (button) {
    button.click();
  } else {
    form.requestSubmit();
  }
  return { ok: true };
}

/** The page's text as a person would read it, one block per line. */
function readAgencyPage() {
  return document.body ? document.body.innerText : "";
}

/**
 * Only the part of an eLearning page about the email searched for: the lines
 * near each line naming it, or, when none does, the page's first lines (enough
 * to say "No results" or "Sign in"). Read with the staffer's PADI sign-in, the
 * rest of the page may be about other students, and it is not DiveDay's to
 * take.
 * @param {string} text
 * @param {string} email
 */
function excerptAround(text, email) {
  const AROUND = 8;
  const lines = text.split(/\r?\n/);
  const wanted = email.trim().toLowerCase();
  const keep = new Set();
  lines.forEach((line, index) => {
    if (!line.toLowerCase().includes(wanted)) return;
    for (let at = Math.max(0, index - AROUND); at <= index + AROUND; at += 1) keep.add(at);
  });
  if (keep.size === 0) return lines.slice(0, 40).join("\n");
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
 * @param {string} text
 * @param {string} firstName
 * @param {string} lastName
 */
function excerptAroundName(text, firstName, lastName) {
  const AFTER = 4;
  const WHY_LINES = 10;
  const COUNT = /(^| )\d+ divers?( found)?( |$)/;
  const WHY =
    /(^| )(no results?|no records?|no matching|no diver|not found|could not find|unable to find|0 results|sign ?in|log ?in|password|session (has )?expired)( |$)/;
  const fold = (value) =>
    ` ${value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()} `;
  const first = fold(firstName);
  const last = fold(lastName);
  const lines = text.split(/\r?\n/);
  const folded = lines.map(fold);
  const names = (line) => line.includes(first) && line.includes(last);
  const kept = new Map();
  folded.forEach((line, index) => {
    // The count's own words, never the rest of a long line around them.
    const count = line.match(COUNT);
    if (count && !kept.has(index)) {
      kept.set(index, line.length < 60 ? lines[index] : count[0].trim());
    }
    if (!names(line)) return;
    for (let at = index; at <= Math.min(lines.length - 1, index + AFTER); at += 1) {
      kept.set(at, lines[at]);
    }
  });
  if (!folded.some(names)) {
    return lines
      .filter((_, index) => WHY.test(folded[index]) || COUNT.test(folded[index]))
      .slice(0, WHY_LINES)
      .join("\n");
  }
  return [...kept.keys()]
    .sort((a, b) => a - b)
    .map((index) => kept.get(index))
    .join("\n");
}

globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  fillAgencyForm,
  readAgencyPage,
  excerptAround,
  excerptAroundName,
});
