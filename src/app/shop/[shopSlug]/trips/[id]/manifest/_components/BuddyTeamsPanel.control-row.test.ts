import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A source read: the panel is a Server Component behind the manifest's
 * session, so this pins the source that decides the geometry; nothing here
 * measures it.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "BuddyTeamsPanel.tsx"), "utf8");
const ADD_FORM = SOURCE.slice(
  SOURCE.indexOf("action={addBuddyTeamMemberAction}"),
  SOURCE.indexOf("</form>", SOURCE.indexOf("action={addBuddyTeamMemberAction}")),
);

/**
 * **"Add to this team" stands level with its Add button.** The member select
 * was the stacked field's 44px beside the secondary `md` Add at 48px, in a row
 * aligned `items-end`, so the button stood 4px above the select's top edge
 * (`manifest-buddy-teams-panel`; K-10). A row with a text control in it is an
 * `md` row.
 */
describe("the buddy team's add-member row", () => {
  it("draws the member select at md, the size of the Add button beside it", () => {
    expect(ADD_FORM).toMatch(/<select\s+name="member"/);
    expect(ADD_FORM).toContain('className={controlClassFor("md")}');
    expect(ADD_FORM).not.toContain("className={controlClass}");
    expect(ADD_FORM).toMatch(/buttonClass\(\{ variant: "secondary" \}\)/);
  });
});
