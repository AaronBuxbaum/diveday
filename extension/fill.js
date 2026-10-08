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
 * @param {{firstName: string, lastName: string, birthDate: string|null, cardNumber: string|null}} query
 * @param {{fields: string[], dateFormat: string, either?: boolean}} spec
 * @returns {{ok: true} | {ok: false, missing: string[]}}
 */
function fillAgencyForm(query, spec) {
  const PATTERNS = {
    first: /first|given|fname|forename|nombre/i,
    last: /last|family|surname|lname|apellido/i,
    name: /(^|[^a-z])(full ?)?name([^a-z]|$)/i,
    birthDate: /birth|dob|bday|nacimiento/i,
    month: /month|mes/i,
    day: /(^|[^a-z])day([^a-z]|$)|dia|día/i,
    year: /year|año|ano/i,
    number: /number|card|cert|code|c[oó]digo|#/i,
  };

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

  function visible(element) {
    if (element.type === "hidden" || element.disabled || element.readOnly) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  const controls = Array.from(document.querySelectorAll("input, select")).filter(
    (element) =>
      visible(element) &&
      !/^(submit|button|checkbox|radio|file|image|reset|password|email)$/i.test(element.type),
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

  function selectOption(element, wanted) {
    const options = Array.from(element.options);
    const match = options.find(
      (option) =>
        wanted.some((value) => option.value === value) ||
        wanted.some((value) => option.textContent.trim().toLowerCase() === value.toLowerCase()),
    );
    if (!match) return false;
    setValue(element, match.value);
    return true;
  }

  function formatDate(iso, format) {
    const [year, month, day] = iso.split("-");
    return format.replace("YYYY", year).replace("MM", month).replace("DD", day);
  }

  const used = [];
  const missing = [];

  function fillName() {
    const first = find(PATTERNS.first, used);
    const last = first ? find(PATTERNS.last, [...used, first]) : null;
    if (first && last) {
      setValue(first, query.firstName);
      setValue(last, query.lastName);
      used.push(first, last);
      return true;
    }
    const whole = find(PATTERNS.name, used);
    if (whole) {
      setValue(whole, `${query.firstName} ${query.lastName}`);
      used.push(whole);
      return true;
    }
    return false;
  }

  function fillBirthDate() {
    if (!query.birthDate) return false;
    const single = find(PATTERNS.birthDate, used);
    if (single && single.tagName === "INPUT") {
      setValue(
        single,
        single.type === "date" ? query.birthDate : formatDate(query.birthDate, spec.dateFormat),
      );
      used.push(single);
      return true;
    }
    const [year, month, day] = query.birthDate.split("-");
    const monthBox = find(PATTERNS.month, used);
    const dayBox = find(PATTERNS.day, [...used, monthBox]);
    const yearBox = find(PATTERNS.year, [...used, monthBox, dayBox]);
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
    function put(box, typed, options) {
      if (box.tagName === "SELECT") return selectOption(box, options);
      setValue(box, typed);
      return true;
    }
    const ok = [
      put(monthBox, month, [month, String(Number(month)), monthName, monthName.slice(0, 3)]),
      put(dayBox, day, [day, String(Number(day))]),
      put(yearBox, year, [year]),
    ].every(Boolean);
    if (ok) used.push(monthBox, dayBox, yearBox);
    return ok;
  }

  function fillNumber() {
    if (!query.cardNumber) return false;
    const box = find(PATTERNS.number, used);
    if (box?.tagName !== "INPUT") return false;
    setValue(box, query.cardNumber);
    used.push(box);
    return true;
  }

  const fillers = { name: fillName, birthDate: fillBirthDate, number: fillNumber };
  if (spec.either) {
    // CMAS: the code alone when there is one, or names and birth date.
    const byNumber = Boolean(query.cardNumber) && fillNumber();
    if (!byNumber) {
      if (!fillName()) missing.push("name");
      if (!fillBirthDate()) missing.push("birthDate");
    }
  } else {
    for (const field of spec.fields) if (!fillers[field]()) missing.push(field);
  }
  if (missing.length > 0 || used.length === 0) return { ok: false, missing };

  const form = used[0].form;
  const button =
    (form &&
      Array.from(form.querySelectorAll('button, input[type="submit"]')).find(
        (element) => element.type === "submit" || element.tagName === "BUTTON",
      )) ||
    Array.from(document.querySelectorAll('button, input[type="submit"]')).find((element) =>
      /search|verify|check|submit|buscar|verificar/i.test(
        element.textContent || element.value || "",
      ),
    );
  if (button) {
    button.click();
  } else if (form) {
    form.requestSubmit();
  } else {
    return { ok: false, missing: ["submit"] };
  }
  return { ok: true };
}

/** The page's text as a person would read it, one block per line. */
function readAgencyPage() {
  return document.body ? document.body.innerText : "";
}

globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  fillAgencyForm,
  readAgencyPage,
});
