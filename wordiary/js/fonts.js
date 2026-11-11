/* ---------------- fonts (bundled Pretendard, loaded as binary so the frame's font rules don't matter) ---------------- */
export const FONT_FILES = { 400: "Regular", 600: "SemiBold", 700: "Bold", 800: "ExtraBold" };
export const fontsReady = Promise.all(Object.entries(FONT_FILES).map(async ([w, n]) => {
  try {
    const buf = await (await fetch(`fonts/Pretendard-${n}.woff2`)).arrayBuffer();
    const face = new FontFace("Pretendard", buf, { weight: w });
    await face.load();
    document.fonts.add(face);
  } catch (e) { /* falls back to the system Korean font */ }
}));
