/**
 * A tiny PNG writer, so the seed can produce images instead of describing them.
 *
 * WHY THIS EXISTS. The demo businesses are for judging THEMES, and a theme is
 * mostly judged on how a palette sits next to photographs. A seed with no
 * images produces the one screen every tenant site already looked like: tinted
 * grey blocks where the food should be, which tells you nothing about whether
 * "Brasa" works and quite a lot about how empty the product feels.
 *
 * WHY NOT A DEPENDENCY, AND WHY NOT A DOWNLOAD. `sharp` and friends are native
 * builds that a seed script has no business requiring, and fetching from a stock
 * photo service makes seeding a thing that fails on a plane and silently embeds
 * somebody else's licensing into a demo. Node ships `zlib`, a PNG is a CRC and
 * a deflate stream, and the whole encoder is ninety lines.
 *
 * WHAT IT DRAWS. Not photographs - it cannot invent a ceviche. It draws what a
 * good placeholder does: a brand-coloured gradient, a soft highlight, and the
 * dish's initials in a 5x7 bitmap face, all seeded from the product name so two
 * dishes never come out identical. On a page that is enough to see whether the
 * palette holds up, which is the question being asked.
 */

import { deflateSync } from "node:zlib";

/* -------------------------------------------------------------------------- */
/*  PNG encoding                                                              */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

/**
 * An RGB canvas with the handful of primitives this script needs.
 *
 * No alpha channel: every image produced here is opaque, and leaving the
 * channel out is one less thing for the encoder to get wrong. Blending against
 * what is already there is done in `blend`, at the point where it is wanted.
 */
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
  }

  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.pixels[offset] = r;
    this.pixels[offset + 1] = g;
    this.pixels[offset + 2] = b;
  }

  /** Mixes `color` over what is already at (x, y) at `alpha` (0..1). */
  blend(x, y, [r, g, b], alpha) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const offset = (y * this.width + x) * 3;
    const a = Math.min(1, alpha);
    this.pixels[offset] = Math.round(this.pixels[offset] * (1 - a) + r * a);
    this.pixels[offset + 1] = Math.round(this.pixels[offset + 1] * (1 - a) + g * a);
    this.pixels[offset + 2] = Math.round(this.pixels[offset + 2] * (1 - a) + b * a);
  }

  /** A diagonal two-stop gradient across the whole canvas. */
  gradient(from, to, angle = 0.6) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const span = Math.abs(dx) * this.width + Math.abs(dy) * this.height;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const t = Math.min(1, Math.max(0, (x * dx + y * dy) / span));
        this.set(x, y, [
          Math.round(from[0] + (to[0] - from[0]) * t),
          Math.round(from[1] + (to[1] - from[1]) * t),
          Math.round(from[2] + (to[2] - from[2]) * t),
        ]);
      }
    }
  }

  /** A soft-edged disc. `softness` is the fraction of the radius it fades over. */
  disc(cx, cy, radius, color, alpha = 1, softness = 0.35) {
    const outer = radius;
    const inner = radius * (1 - softness);

    for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
      for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > outer) continue;
        const falloff = distance <= inner ? 1 : 1 - (distance - inner) / Math.max(1, outer - inner);
        this.blend(x, y, color, alpha * falloff);
      }
    }
  }

  toPng() {
    // One filter byte per scanline. Filter 0 (None) keeps the encoder honest:
    // a smarter filter compresses better and is one more thing to debug in a
    // script whose output is a placeholder.
    const raw = Buffer.alloc(this.height * (this.width * 3 + 1));
    for (let y = 0; y < this.height; y++) {
      const from = y * this.width * 3;
      const to = y * (this.width * 3 + 1);
      raw[to] = 0;
      this.pixels.copy(raw, to + 1, from, from + this.width * 3);
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: truecolour RGB
    header[10] = 0; // deflate
    header[11] = 0; // adaptive filtering
    header[12] = 0; // no interlace

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/* -------------------------------------------------------------------------- */
/*  A 5x7 bitmap face                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Enough of a font to set two or three initials.
 *
 * Each glyph is seven rows of five bits, most significant bit on the left. A
 * real font would be a file and a parser; this is a logo mark with two letters
 * in it, and the whole alphabet fits in the space the parser would have taken.
 */
const GLYPHS = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

/**
 * Draws `text` centred on (cx, cy), each bitmap pixel scaled to `scale`.
 *
 * Unknown characters are skipped rather than drawn as a box: the callers pass
 * initials taken from a business name, and a name with an accent in it should
 * lose the accent, not gain a tofu square.
 */
export function drawText(canvas, text, cx, cy, scale, color) {
  const letters = [...text.toUpperCase()].filter((char) => char in GLYPHS);
  if (letters.length === 0) return;

  const glyphWidth = 5 * scale;
  const gap = scale * 2;
  const totalWidth = letters.length * glyphWidth + (letters.length - 1) * gap;
  const totalHeight = 7 * scale;

  let x0 = Math.round(cx - totalWidth / 2);
  const y0 = Math.round(cy - totalHeight / 2);

  for (const letter of letters) {
    const rows = GLYPHS[letter];
    for (let row = 0; row < 7; row++) {
      for (let column = 0; column < 5; column++) {
        if ((rows[row] & (1 << (4 - column))) === 0) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            canvas.set(x0 + column * scale + dx, y0 + row * scale + dy, color);
          }
        }
      }
    }
    x0 += glyphWidth + gap;
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Black or white, whichever reads on `rgb`. Mirrors `readableOn` in seo/theme.
 *
 * It measures both candidates rather than thresholding, for the same reason
 * that file does: a fixed cut-off is wrong for exactly the mid-tones a brand
 * accent tends to be. The two must agree, or a seeded favicon comes out with
 * different contrast from the button the same colour paints on the site.
 */
export function readableOn([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const against = (other) => {
    const [lighter, darker] = luminance > other ? [luminance, other] : [other, luminance];
    return (lighter + 0.05) / (darker + 0.05);
  };

  // Luminance of #111827 and of #ffffff.
  return against(0.0107) >= against(1) ? [17, 24, 39] : [255, 255, 255];
}

/** A small stable number from a string, so one dish always looks the same. */
export function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 0xffffffff;
}

/** The initials a logo mark shows: up to two letters from the business name. */
export function initials(name) {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter((word) => /[a-z]/i.test(word));

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0][0] + words[1][0];
}

/* -------------------------------------------------------------------------- */
/*  The three pictures the seed needs                                          */
/* -------------------------------------------------------------------------- */

/**
 * A product photo stand-in: brand gradient, two soft discs, the dish initials.
 *
 * `seed` drives the disc placement and the gradient angle, so a menu of
 * fourteen dishes comes out as fourteen distinguishable cards rather than the
 * same tile repeated - which is the difference between a page you can judge and
 * a page you can only tell is not empty.
 */
export function productImage(name, primaryHex, accentHex, width = 900, height = 675) {
  const primary = hexToRgb(primaryHex);
  const accent = hexToRgb(accentHex);
  const seed = hash(name);

  const canvas = new Canvas(width, height);
  canvas.gradient(mix(primary, [255, 255, 255], 0.12), mix(accent, [0, 0, 0], 0.15), 0.4 + seed);

  canvas.disc(
    width * (0.18 + seed * 0.5),
    height * (0.22 + ((seed * 7) % 1) * 0.4),
    width * 0.34,
    [255, 255, 255],
    0.16,
    0.9,
  );
  canvas.disc(
    width * (0.82 - ((seed * 13) % 1) * 0.4),
    height * (0.78 - seed * 0.3),
    width * 0.26,
    mix(accent, [255, 255, 255], 0.5),
    0.2,
    0.85,
  );

  /*
   * A plate, then the initials on it.
   *
   * The first version set the letters at a twelfth of the height and they read
   * as what they are - a 5x7 bitmap blown up until every step in the diagonal
   * is a centimetre across. Smaller type inside a soft disc reads as a
   * deliberate placeholder mark instead, which is what it is, and it stops
   * competing with the palette that the image exists to show off.
   */
  canvas.disc(width / 2, height / 2, height * 0.22, [255, 255, 255], 0.22, 0.12);
  drawText(
    canvas,
    initials(name),
    width / 2,
    height / 2,
    Math.max(2, Math.round(height / 46)),
    [255, 255, 255],
  );

  return canvas.toPng();
}

/** A wordmark-ish logo: the initials on a brand-coloured plate. */
export function logoImage(businessName, primaryHex, accentHex, width = 600, height = 240) {
  const primary = hexToRgb(primaryHex);
  const accent = hexToRgb(accentHex);

  const canvas = new Canvas(width, height);
  canvas.gradient(primary, mix(accent, primary, 0.35), 0.2);
  canvas.disc(width * 0.86, height * 0.2, height * 0.7, [255, 255, 255], 0.12, 1);

  drawText(
    canvas,
    initials(businessName),
    width / 2,
    height / 2,
    Math.round(height / 15),
    [255, 255, 255],
  );

  return canvas.toPng();
}

/** A square favicon: one initial, high contrast, legible at 16 pixels. */
export function faviconImage(businessName, primaryHex) {
  const primary = hexToRgb(primaryHex);
  const size = 128;

  const canvas = new Canvas(size, size);
  canvas.gradient(primary, mix(primary, [0, 0, 0], 0.3), 0.8);

  drawText(canvas, initials(businessName)[0], size / 2, size / 2, 10, readableOn(primary));

  return canvas.toPng();
}

/** A wide banner for a page hero. Same palette, no letters. */
export function bannerImage(seedText, primaryHex, accentHex, width = 1600, height = 900) {
  const primary = hexToRgb(primaryHex);
  const accent = hexToRgb(accentHex);
  const seed = hash(seedText);

  const canvas = new Canvas(width, height);
  canvas.gradient(mix(primary, [0, 0, 0], 0.25), mix(accent, [255, 255, 255], 0.2), 0.3 + seed / 2);

  for (let i = 0; i < 5; i++) {
    const s = hash(`${seedText}-${i}`);
    canvas.disc(
      width * s,
      height * ((s * 3) % 1),
      width * (0.1 + s * 0.2),
      i % 2 === 0 ? [255, 255, 255] : accent,
      0.1,
      1,
    );
  }

  return canvas.toPng();
}
