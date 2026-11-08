// Where LOOTBOX's code is published, so the site and the docs can link each rule to the file that
// carries it out. The live site is built from `main`, so links point there. No imports: the docs
// sidebar (a client component) reads this too.
export const GITHUB_URL = "https://github.com/javajd9/lootbox";

// A file ("lib/draws/tickets.ts") or a folder ("lib/treasury/") on GitHub.
export const sourceUrl = (path: string) =>
  path.endsWith("/") ? `${GITHUB_URL}/tree/main/${path.slice(0, -1)}` : `${GITHUB_URL}/blob/main/${path}`;
