// "Try the checks" (Settings): a lookup form shaped like the agency's, on a
// page this extension carries, filled by the same fill.js with a made-up
// diver. Its search is never sent anywhere: the form stops it, and this page
// tells the service worker what was found, typed and pressed.
(() => {
  const { AGENCIES, SIGN_IN_PATH, PAGE_SHAPE_WORDS, fillAgencyForm, describePageShape } =
    globalThis.DiveDayCertCheck;
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
  function box(key, label) {
    const wrapper = document.createElement("label");
    wrapper.textContent = `${label} `;
    const input = document.createElement("input");
    input.name = key;
    wrapper.append(input);
    form.append(wrapper);
    boxes[key] = input;
  }
  const fields = spec ? spec.fields : [];
  if (fields.includes("number")) box("card_number", "Card number");
  if (fields.includes("name")) {
    box("first_name", "First name");
    box("last_name", "Last name");
  }
  if (fields.includes("birthDate")) box("birth_date", "Date of birth");
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Search";
  form.append(button);
  let submitted = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitted = true;
  });
  document.getElementById("sample").append(form);

  const filled =
    spec && !spec.signIn
      ? fillAgencyForm(SAMPLE, spec, SIGN_IN_PATH)
      : { ok: false, missing: ["agency"] };

  // What each box should hold once filled: the code alone on a lookup that
  // takes either (CMAS), else every box the agency's form asks for.
  const [year, month, day] = SAMPLE.birthDate.split("-");
  const expected = spec?.either
    ? { card_number: SAMPLE.cardNumber }
    : {
        card_number: SAMPLE.cardNumber,
        first_name: SAMPLE.firstName,
        last_name: SAMPLE.lastName,
        birth_date: spec
          ? spec.dateFormat.replace("YYYY", year).replace("MM", month).replace("DD", day)
          : "",
      };
  const typed =
    Object.keys(boxes).length > 0 &&
    Object.entries(boxes).every(([key, input]) =>
      key in expected ? input.value === expected[key] : input.value === "",
    );

  chrome.runtime.sendMessage({
    type: "dry-run-result",
    result: {
      filled: filled?.ok === true,
      typed,
      submitted,
      missing: filled?.ok ? [] : filled?.missing || [],
      pageShape: describePageShape(PAGE_SHAPE_WORDS, [SAMPLE.firstName, SAMPLE.lastName]),
    },
  });
})();
