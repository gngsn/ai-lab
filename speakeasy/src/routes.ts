// The page table: everything each old `<name>.html` put in its <head> and
// <body> besides the shared bits that index.html keeps (theme.css, the fonts
// preconnects, config.local.js).
import type { RouteName } from "./lib/route-name";

export type Route = {
  lang: string;
  title: string;
  /** id of the element the page renders into (the old pages differed). */
  mount: "app" | "root";
  /** Stylesheets from public/, before the page's own CSS. */
  styles: { href: string; media?: string }[];
  googleFonts: boolean;
  /** Classic scripts, in order. */
  scripts: string[];
  /** The page's own CSS, then its module (which renders on import). */
  css: () => Promise<unknown>;
  page: () => Promise<unknown>;
};

const FONTS = { href: "/vendor/fonts/fonts.css" };
const HISTORY = { href: "/css/history-ui.css" };
const SHORTCUTS = { href: "/css/shortcuts-help.css" };
const TRAINING = { href: "/css/training-panel.css" };

export const ROUTES: Record<RouteName, Route> = {
  decks: {
    lang: "ko",
    title: "Speakeasy",
    mount: "app",
    styles: [],
    googleFonts: true,
    scripts: [],
    css: () => import("./features/decks/decks.css"),
    page: () => import("./pages/decks/main"),
  },
  captions: {
    lang: "en",
    title: "Live captions",
    mount: "app",
    styles: [],
    googleFonts: false,
    scripts: [],
    css: () => import("./features/captions/captions.css"),
    page: () => import("./pages/captions/main"),
  },
  notes: {
    lang: "ko",
    title: "Notes",
    mount: "app",
    styles: [],
    googleFonts: true,
    scripts: [],
    css: () => import("./features/notes/notes.css"),
    page: () => import("./pages/notes/main"),
  },
  script: {
    lang: "ko",
    title: "Script",
    mount: "app",
    styles: [FONTS, SHORTCUTS],
    googleFonts: true,
    scripts: [],
    css: () => import("./features/script/script.css"),
    page: () => import("./pages/script/main"),
  },
  "script-edit": {
    lang: "ko",
    title: "Notes",
    mount: "root",
    styles: [FONTS, HISTORY, SHORTCUTS],
    googleFonts: true,
    scripts: [],
    css: () => import("./features/script-edit/script-edit.css"),
    page: () => import("./pages/script-edit/main"),
  },
  pronunciation: {
    lang: "en",
    title: "Pronunciation Training",
    mount: "root",
    styles: [FONTS, TRAINING],
    googleFonts: true,
    scripts: [],
    css: () => import("./features/pronunciation/pronunciation.css"),
    page: () => import("./pages/pronunciation/main"),
  },
  edit: {
    lang: "ko",
    title: "Edit",
    mount: "root",
    styles: [
      FONTS,
      HISTORY,
      SHORTCUTS,
      TRAINING,
      {
        href: "/vendor/highlight.js/styles/github.min.css",
        media: "(prefers-color-scheme: light)",
      },
      {
        href: "/vendor/highlight.js/styles/github-dark.min.css",
        media: "(prefers-color-scheme: dark)",
      },
      { href: "/vendor/codemirror/lib/codemirror.min.css" },
      { href: "/vendor/codemirror/theme/monokai.min.css" },
    ],
    googleFonts: true,
    scripts: [
      "/vendor/highlight.js/highlight.min.js",
      "/vendor/highlight.js/languages/xml.min.js",
      "/vendor/codemirror/lib/codemirror.min.js",
      "/vendor/codemirror/mode/xml/xml.min.js",
    ],
    css: () => import("./features/edit/edit.css"),
    page: () => import("./pages/edit/main"),
  },
};
