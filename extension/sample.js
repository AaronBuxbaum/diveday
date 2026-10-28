// "Try the checks" (Settings): a lookup form shaped like the agency's, on a
// page this extension carries, filled by the same fill.js with a made-up
// diver. Its search is never sent anywhere: the form stops it, and this page
// tells the service worker what was found, typed and pressed.
(() => {
  const {
    AGENCIES,
    SIGN_IN_PATH,
    PAGE_SHAPE_WORDS,
    fillAgencyForm,
    fillSsiManualForm,
    describePageShape,
  } = globalThis.DiveDayCertCheck;
  /** Nobody: a name, birth date and number no agency holds. */
  const SAMPLE = {
    firstName: "Alex",
    lastName: "Sample",
    birthDate: "1990-01-31",
    cardNumber: "SAMPLE123",
  };
  const agency = location.hash.slice(1);
  const spec = Object.hasOwn(AGENCIES, agency) ? AGENCIES[agency] : null;

  const form = document.createElement("form");
  const boxes = {};
  function box(key, label, into) {
    const wrapper = document.createElement("label");
    wrapper.textContent = `${label} `;
    const input = document.createElement("input");
    input.name = key;
    wrapper.append(input);
    into.append(wrapper);
    boxes[key] = input;
  }
  function searchButton(words, into) {
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = words;
    into.append(button);
    return button;
  }
  const fields = spec ? spec.fields : [];
  // CMAS's one page holds two searches, each with its own button: the code
  // under "Search by code", the names and birth date under "Manual Search".
  const byCode = document.createElement("div");
  const byName = document.createElement("div");
  form.append(byCode, byName);
  let codeButton = null;
  let nameButton = null;
  if (spec?.either) {
    box("card_number", "CMAS code", byCode);
    codeButton = searchButton("Search by code", byCode);
    box("first_name", "First name", byName);
    box("last_name", "Last name", byName);
    box("birth_date", "Date of birth", byName);
    nameButton = searchButton("Manual Search", byName);
  } else {
    if (fields.includes("number")) box("card_number", "Card number", form);
    if (fields.includes("name")) {
      box("first_name", "First name", form);
      box("last_name", "Last name", form);
    }
    if (fields.includes("birthDate")) box("birth_date", "Date of birth", form);
    nameButton = searchButton("Search", form);
  }
  let pressed = null;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    pressed = event.submitter || null;
  });
  document.getElementById("sample").append(form);

  const [year, month, day] = SAMPLE.birthDate.split("-");
  const date = spec
    ? spec.dateFormat.replace("YYYY", year).replace("MM", month).replace("DD", day)
    : "";

  /** One lookup: fill the form, then whether each box holds what it should and the right button was pressed. */
  function attempt(query, expected, button) {
    for (const input of Object.values(boxes)) input.value = "";
    pressed = null;
    const filled =
      agency === "ssi"
        ? { ok: fillSsiManualForm(query, true) }
        : spec && !spec.signIn
          ? fillAgencyForm(query, spec, SIGN_IN_PATH)
          : { ok: false, missing: ["agency"] };
    const typed =
      Object.keys(boxes).length > 0 &&
      Object.entries(boxes).every(([key, input]) =>
        key in expected ? input.value === expected[key] : input.value === "",
      );
    return { filled, typed, submitted: pressed !== null && pressed === button };
  }

  // Every box the agency's form asks for; on CMAS, the code alone when there
  // is one, and the names and birth date when there is none.
  const attempts = spec?.either
    ? [
        attempt(SAMPLE, { card_number: SAMPLE.cardNumber }, codeButton),
        attempt(
          { ...SAMPLE, cardNumber: null },
          { first_name: SAMPLE.firstName, last_name: SAMPLE.lastName, birth_date: date },
          nameButton,
        ),
      ]
    : [
        attempt(
          SAMPLE,
          {
            card_number: SAMPLE.cardNumber,
            first_name: SAMPLE.firstName,
            last_name: SAMPLE.lastName,
            birth_date: date,
          },
          nameButton,
        ),
      ];
  const failedFill = attempts.find((each) => each.filled?.ok !== true);

  chrome.runtime.sendMessage({
    type: "dry-run-result",
    result: {
      filled: !failedFill,
      typed: attempts.every((each) => each.typed),
      submitted: attempts.every((each) => each.submitted),
      manual: agency === "ssi",
      missing: failedFill ? failedFill.filled?.missing || [] : [],
      pageShape: describePageShape(PAGE_SHAPE_WORDS, [SAMPLE.firstName, SAMPLE.lastName]),
    },
  });
})();
