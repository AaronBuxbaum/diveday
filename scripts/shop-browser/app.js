const secret = location.hash.slice(1);
history.replaceState(null, "", "/");
const status = document.querySelector("#status");
const list = document.querySelector("#shops");
const next = document.querySelector("#next");
const recovery = document.querySelector("#recovery");
let cursor = "";
let query = "";
async function request(path) {
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error("Request failed");
  return response.json();
}
function showRecovery(row, shop, details) {
  recovery.querySelector("h2").textContent = `Demo access · ${shop.name}`;
  recovery.querySelector("pre").textContent = `${shop.slug}\n${details}`;
  row.append(recovery);
  recovery.hidden = false;
  recovery.focus({ preventScroll: true });
  recovery.scrollIntoView({ block: "nearest" });
  status.textContent = `Demo access ready for ${shop.slug}.`;
}
async function browse(after = "") {
  status.textContent = "Loading shops…";
  next.disabled = true;
  recovery.hidden = true;
  try {
    const data = await request(`/shops?${new URLSearchParams({ q: query, after })}`);
    list.replaceChildren();
    for (const shop of data.rows) {
      const row = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = shop.name;
      const slug = document.createElement("code");
      slug.textContent = shop.slug;
      row.append(name, slug);
      if (shop.is_demo) {
        const button = document.createElement("button");
        button.textContent = "Show demo sign-in";
        button.className = "secondary";
        button.onclick = async () => {
          try {
            const value = await request(`/demo?${new URLSearchParams({ slug: shop.slug })}`);
            if (!value) {
              status.textContent = "No eligible sample owner found.";
              return;
            }
            showRecovery(row, shop, `${value.email}\n${value.password}`);
          } catch {
            status.textContent = "Recovery unavailable. Try again.";
          }
        };
        row.append(button);
        const generate = document.createElement("button");
        generate.textContent = "Generate 24-hour demo link";
        generate.onclick = async () => {
          generate.disabled = true;
          try {
            const value = await request(`/demo-link?${new URLSearchParams({ slug: shop.slug })}`);
            if (!value) {
              status.textContent = "No eligible sample owner found.";
              return;
            }
            showRecovery(
              row,
              shop,
              `${value.url}\nExpires: ${value.expiresAt} (UTC)\nSingle use. Copy this link into your email. Generating another invalidates this one.`,
            );
          } catch {
            status.textContent = "Link generation unavailable. Try again.";
          } finally {
            generate.disabled = false;
          }
        };
        row.append(generate);
      }
      list.append(row);
    }
    cursor = data.next;
    next.hidden = !cursor;
    status.textContent = data.rows.length ? `${data.rows.length} shops` : "No shops found.";
  } catch {
    status.textContent =
      "Unable to load shops. Reopen the private URL printed by the operator command.";
  } finally {
    next.disabled = false;
  }
}
document.querySelector("#search").onsubmit = (event) => {
  event.preventDefault();
  query = document.querySelector("#query").value;
  void browse();
};
next.onclick = () => {
  void browse(cursor);
};
void browse();
