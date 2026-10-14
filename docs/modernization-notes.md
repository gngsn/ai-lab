# Modernization notes

Things found while writing the Phase 0 tests. The tests pin today's behavior; nothing here was changed.

- **Captions CC toggle:** switching CC off and on again does not re-show the caption that was on screen; the box stays hidden until the next caption arrives (`js/captions/audience.js`). Possible small improvement later.
- **docs/function.md** still calls the follow button "Follow/Stop"; the app's label is "Pause" (hover shows "Pause · manual control") / "Follow" (hover: "Follow the presenter").
- **Playback state:** a slide saved with a fragment already `show`n starts hidden (by design, see `stripPlaybackState`), so that slide needs one extra key press to move on. Tests rely on this.
- **Share is inside "⋮ More"** in the editor toolbar, so tests open that menu first.
- **Local runs use the working tree.** Someone else's uncommitted edits to `edit.html` (export menu) are present locally; the tests don't touch those parts. CI runs the committed code.
- **Import redirects:** after a successful import the app navigates to `edit.html?deck=<id>` (it does not stay on the deck list). The plan's P0-17 said "the deck is created"; the test pins both.
- **PPTX removed:** the export menu no longer offers PPTX or screenshot-PDF, so `exportPptx`, `vendor/pptxgenjs/` and the pdf-export page are gone. `README.md` ("Export to HTML, PDF, Marp, PPTX"), `SPEC.md` and `docs/function.md` still mention PPTX; they are outside this task's scope and need a human edit.
