// Which page a URL path opens. Every page keeps its old addresses: the
// `.html` form (`/edit.html`, used by links already shared) and the clean form
// (`/edit`, what cleanUrls serves). The deck list is `/`, `/index` and
// `/index.html`.
export const ROUTE_NAMES = [
  "decks",
  "edit",
  "notes",
  "script",
  "script-edit",
  "pronunciation",
  "captions",
  "view",
  "share",
  "present",
  "edit-frame",
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];

/** The page for a path, or null when the path is not one of ours. */
export function routeNameFor(pathname: string): RouteName | null {
  const name = pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.html$/, "");
  if (name === "" || name === "index") return "decks";
  return (ROUTE_NAMES as readonly string[]).includes(name) && name !== "decks"
    ? (name as RouteName)
    : null;
}
