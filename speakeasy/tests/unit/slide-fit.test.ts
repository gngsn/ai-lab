// The numbers the legacy public/js/slide-fit.js produced.
import { describe, expect, it } from "vitest";
import { fitStyle } from "../../src/lib/slide-fit";

describe("fitStyle", () => {
  it("is the identity at the design size", () => {
    expect(fitStyle(1280, 720)).toEqual({
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "1280px",
      height: "720px",
      maxWidth: "none",
      maxHeight: "none",
      transformOrigin: "0 0",
      transform: "scale(1)",
    });
  });

  it("scales by the tighter side and centres the other", () => {
    // a square box is limited by its width: scale 0.78125, centred vertically
    const square = fitStyle(1000, 1000);
    expect(square.transform).toBe("scale(0.78125)");
    expect(square.left).toBe("0px");
    expect(square.top).toBe("218.75px");
    // a wide box is limited by its height, centred horizontally
    const wide = fitStyle(2000, 720);
    expect(wide.transform).toBe("scale(1)");
    expect(wide.left).toBe("360px");
    expect(wide.top).toBe("0px");
  });

  it("can scale up", () => {
    const big = fitStyle(2560, 1440);
    expect(big.transform).toBe("scale(2)");
    expect(big.left).toBe("0px");
    expect(big.top).toBe("0px");
  });

  it("keeps the frame at the design size whatever the scale", () => {
    for (const [w, h] of [
      [300, 200],
      [640, 360],
      [1920, 1080],
    ] as const) {
      const s = fitStyle(w, h);
      expect(s.width).toBe("1280px");
      expect(s.height).toBe("720px");
    }
  });
});
