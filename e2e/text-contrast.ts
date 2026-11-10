import type { Page } from "@playwright/test";

/** Measure rendered text, including alpha on its ink, backgrounds and ancestors.
 * Images/gradients are reported separately: a flat-color ratio cannot prove their contrast.
 * This is a focused color regression check, not an accessibility conformance audit.
 */
export async function measureTextContrast(page: Page) {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("A canvas is required to resolve CSS colors");
    const color = (css: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [
        ...[0, 1, 2].map(
          (i) => ((front[i] ?? 0) * front[3] + (back[i] ?? 0) * back[3] * (1 - front[3])) / alpha,
        ),
        alpha,
      ] as Rgba;
    };
    const luminance = (rgb: Rgba) => {
      const channels = rgb.slice(0, 3).map((n) => {
        const v = n / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return (
        (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
      );
    };
    const measurements: {
      text: string;
      selector: string;
      foreground: number[];
      background: number[];
      ratio: number;
      kind: string;
    }[] = [];
    const unmeasured: { text: string; reason: string }[] = [];
    const measure = (element: Element, text: string, kind = "text", pseudo?: string) => {
      if (
        !text.trim() ||
        !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        return;
      if (element.closest("script, style, svg, noscript, [inert]")) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const style = getComputedStyle(element, pseudo);
      let foreground = color(style.color);
      let background: Rgba = [0, 0, 0, 0];
      if (pseudo) foreground[3] *= Number(style.opacity);
      for (let current: Element | null = element; current; current = current.parentElement) {
        const parentStyle = getComputedStyle(current);
        if (parentStyle.backgroundImage !== "none" && background[3] < 1) {
          unmeasured.push({ text: text.slice(0, 100), reason: "image or gradient behind text" });
          return;
        }
        const fill = color(parentStyle.backgroundColor);
        foreground = over(foreground, fill);
        background = over(background, fill);
        const opacity = Number(parentStyle.opacity);
        foreground[3] *= opacity;
        background[3] *= opacity;
      }
      // The viewport canvas behind an unpainted root is white.
      foreground = over(foreground, [255, 255, 255, 1]);
      background = over(background, [255, 255, 255, 1]);
      const a = luminance(foreground);
      const b = luminance(background);
      measurements.push({
        text: text.trim().slice(0, 100),
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${Array.from(element.classList).join(".")}`,
        foreground: foreground.slice(0, 3),
        background: background.slice(0, 3),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        kind,
      });
    };
    for (const element of document.querySelectorAll("body *")) {
      const text = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(" ");
      measure(element, text);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (!element.value && element.placeholder)
          measure(element, element.placeholder, "placeholder", "::placeholder");
        else if (
          element.value &&
          !["hidden", "password", "checkbox", "radio"].includes(element.type)
        )
          measure(element, element.value, "value");
        if (
          element.matches("input[data-empty]:not(:focus)") &&
          element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        )
          // Chromium returns the host input's color for this native pseudo-element,
          // not the mask's painted ink. The CSS token test checks its specified color.
          unmeasured.push({ text: "empty date/time mask", reason: "native shadow text" });
      }
    }
    return { measurements, unmeasured };
  });
}
