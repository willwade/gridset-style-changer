import {
  hexToRgba,
  rgbaToHex,
} from 'https://esm.sh/@willwade/aac-processors@0.3.7/dist/browser/processors/gridset/colorUtils.js';

export { rgbaToHex };

const STYLES_PATH = 'Settings0/Styles/styles.xml';
const GRID_RE = /^Grids\/.+\/grid\.xml$/i;

export function stripBom(s) {
  return s.startsWith('\uFEFF') ? s.slice(1) : s;
}

export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML parse error');
  }
  return doc;
}

export async function openGridset(file) {
  const zip = await JSZip.loadAsync(file);
  const stylesEntry = zip.file(STYLES_PATH);
  if (!stylesEntry) {
    throw new Error('This does not look like a Grid 3 gridset (missing Settings0/Styles/styles.xml).');
  }
  const stylesDoc = parseXml(stripBom(await stylesEntry.async('string')));

  const gridDocs = new Map();
  for (const entry of zip.file(GRID_RE)) {
    gridDocs.set(entry.name, parseXml(stripBom(await entry.async('string'))));
  }
  return { zip, stylesDoc, stylesPath: STYLES_PATH, gridDocs };
}

export function getNamedStyles(stylesDoc) {
  return Array.from(stylesDoc.getElementsByTagName('Style'));
}

export function isDefaultStyle(styleEl) {
  return styleEl.getAttribute('Key')?.toLowerCase() === 'default';
}

export function ensureDefaultStyle(stylesDoc) {
  const existing = getNamedStyles(stylesDoc).find(isDefaultStyle);
  if (existing) return existing;
  const container = stylesDoc.getElementsByTagName('Styles')[0];
  if (!container) throw new Error('Cannot add the Default style: styles.xml has no Styles element.');
  const style = stylesDoc.createElementNS(container.namespaceURI, 'Style');
  style.setAttribute('Key', 'Default');
  container.appendChild(style);
  return style;
}

export function getInlineStyles(gridDoc) {
  return Array.from(gridDoc.getElementsByTagName('Style'));
}

export function readStyleProps(styleEl) {
  const props = {};
  for (const child of styleEl.children) {
    props[child.localName] = child.textContent;
  }
  return props;
}

export function setStyleProp(styleEl, name, value) {
  let el = null;
  for (const child of styleEl.children) {
    if (child.localName === name) {
      el = child;
      break;
    }
  }
  if (!el) {
    el = styleEl.ownerDocument.createElementNS(null, name);
    styleEl.appendChild(el);
  }
  el.textContent = String(value);
}

export function parseColour(str) {
  if (typeof str !== 'string') return null;
  const hex = str.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  return hexToRgba('#' + hex);
}

export function rgbToCss(rgb) {
  return rgbaToHex(rgb.r, rgb.g, rgb.b, 1).slice(0, 7);
}

export function relativeLuminance(rgb) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

export function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function compositeOver(fg, bg) {
  const t = fg.a ?? 1;
  return {
    r: Math.round(fg.r * t + bg.r * (1 - t)),
    g: Math.round(fg.g * t + bg.g * (1 - t)),
    b: Math.round(fg.b * t + bg.b * (1 - t)),
  };
}

function rgbToHsl(rgb) {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(hsl) {
  const { h, s, l } = { h: hsl.h / 360, s: hsl.s, l: hsl.l };
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(conv(h + 1 / 3) * 255),
    g: Math.round(conv(h) * 255),
    b: Math.round(conv(h - 1 / 3) * 255),
  };
}

export function adjustForContrast(fontRgb, bgRgb, target) {
  if (contrastRatio(fontRgb, bgRgb) >= target) return fontRgb;

  const hsl = rgbToHsl(fontRgb);

  for (let step = 1; step <= 100; step++) {
    for (const direction of [-1, 1]) {
      const l = Math.max(0, Math.min(1, hsl.l + direction * step / 100));
      const candidate = hslToRgb({ ...hsl, l });
      if (contrastRatio(candidate, bgRgb) >= target) return candidate;
    }
  }

  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  return contrastRatio(black, bgRgb) >= contrastRatio(white, bgRgb) ? black : white;
}

export function resolveStyleProps(styleEl, stylesDoc, visited = new Set()) {
  if (visited.has(styleEl)) throw new Error('Circular BasedOnStyle reference in styles.xml.');
  visited.add(styleEl);
  const props = readStyleProps(styleEl);
  const named = getNamedStyles(stylesDoc);
  const baseKey = props.BasedOnStyle ||
    (isDefaultStyle(styleEl) ? null : 'Default');
  const base = baseKey && named.find((style) => style.getAttribute('Key') === baseKey);
  const inherited = base && base !== styleEl ? resolveStyleProps(base, stylesDoc, visited) : {};
  return { ...inherited, ...props };
}

export function styleAppearance(styleEl, stylesDoc, gridDoc = null) {
  const props = resolveStyleProps(styleEl, stylesDoc);
  const root = gridDoc?.documentElement;
  const field = (name) => root && Array.from(root.children).find((child) => child.localName === name)?.textContent;
  const canvas = parseColour(field('BackgroundColour'));
  const imageBackground = /image/i.test(field('BackgroundStyle') || '') ||
    Boolean(root && Array.from(root.children).some((child) =>
      /background.*image|background.*picture/i.test(child.localName) && child.textContent.trim()
    ));
  const back = parseColour(props.BackColour);
  const tile = parseColour(props.TileColour);
  const backgroundKnown = tile?.a === 1 || back?.a === 1 ||
    Boolean(canvas?.a === 1 && !imageBackground);
  return {
    props,
    backgroundKnown,
    bg: styleBackgroundRgb(props, canvas && !imageBackground ? canvas : undefined),
  };
}

export function styleBackgroundRgb(props, canvas = { r: 255, g: 255, b: 255, a: 1 }) {
  const transparent = { r: 255, g: 255, b: 255, a: 0 };
  const base = compositeOver(canvas, { r: 255, g: 255, b: 255 });
  const back = compositeOver(parseColour(props.BackColour) || transparent, base);
  return compositeOver(parseColour(props.TileColour) || transparent, back);
}

export function styleFontRgb(props) {
  return parseColour(props.FontColour) || { r: 0, g: 0, b: 0, a: 1 };
}

export function styleContrastInfo(props) {
  const bg = styleBackgroundRgb(props);
  const fg = compositeOver(styleFontRgb(props), bg);
  const ratio = contrastRatio(fg, bg);
  let grade = 'bad';
  if (ratio >= 4.5) grade = 'ok';
  else if (ratio >= 3) grade = 'warn';
  return { ratio, grade };
}
