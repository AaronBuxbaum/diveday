# Coverage denominators

One JSON file per dive area (`src/content/dive-areas.ts`): the named sites shops in that area
actually run, drawn up from public lists, and the catalog template (if any) that defines each one.
The shape and the counting rule are in `src/content/coverage.ts`; `pnpm content:coverage` prints
the share each area's templates cover, and `src/content/coverage.test.ts` fails when a promised
area falls below 80%.

A site belongs in the list when it is named, divable on a recreational dive, and on at least two
independent lists: an official marine-park, sanctuary or mooring list counts as one, an
operator's published site list as another. A site taken out of the count keeps its line with an
`excluded` reason. New areas arrive through the **expand-content** skill.
