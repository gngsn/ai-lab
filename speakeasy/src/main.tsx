// The one entry point. It picks the page from the URL, prepares the document
// the way that page's own HTML used to (language, title, mount element,
// stylesheets, classic scripts) and then loads the page module, which renders
// itself. Navigation between pages is still a full page load.
import { loadScript, loadStylesheet } from "./lib/load-assets";
import { routeNameFor } from "./lib/route-name";
import { ROUTES } from "./routes";

const GOOGLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400&family=Space+Grotesk:wght@400;500&display=swap";

async function boot() {
  const route = ROUTES[routeNameFor(location.pathname) ?? "decks"];
  document.documentElement.lang = route.lang;
  document.title = route.title;

  const mount = document.createElement("div");
  mount.id = route.mount;
  document.body.prepend(mount);

  if (route.googleFonts) void loadStylesheet(GOOGLE_FONTS, { wait: false });
  await Promise.all(route.styles.map((style) => loadStylesheet(style.href, style)));
  for (const src of route.scripts) await loadScript(src);
  await route.css();
  await route.page();
}

void boot();
