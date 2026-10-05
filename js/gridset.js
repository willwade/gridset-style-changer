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

export function parseArgb(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  const full = s.length === 8 ? s : 'FF' + s;
  return {
    a: parseInt(full.slice(0, 2), 16),
    r: parseInt(full.slice(2, 4), 16),
    g: parseInt(full.slice(4, 6), 16),
    b: parseInt(full.slice(6, 8), 16),
  };
}

export function argbToCss(rgb) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return '#' + h(rgb.r) + h(rgb.g) + h(rgb.b);
}

export function cssToArgb(css6, alpha = 255) {
  const s = css6.replace('#', '');
  const a = alpha.toString(16).padStart(2, '0');
  return ('#' + a + s).toUpperCase();
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
  if (fg.a >= 255) return { r: fg.r, g: fg.g, b: fg.b };
  const t = fg.a / 255;
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

  const bgLum = relativeLuminance(bgRgb);
  const hsl = rgbToHsl(fontRgb);
  const darken = bgLum > 0.35;

  for (let step = 1; step <= 20; step++) {
    const l = darken ? Math.max(0, hsl.l - step * 0.05) : Math.min(1, hsl.l + step * 0.05);
    const candidate = hslToRgb({ ...hsl, l });
    if (contrastRatio(candidate, bgRgb) >= target) return candidate;
  }

  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  return contrastRatio(black, bgRgb) >= contrastRatio(white, bgRgb) ? black : white;
}

export function styleBackgroundRgb(props) {
  return parseArgb(props.TileColour) || parseArgb(props.BackColour) || { r: 255, g: 255, b: 255, a: 255 };
}

export function styleFontRgb(props) {
  return parseArgb(props.FontColour) || { r: 0, g: 0, b: 0, a: 255 };
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
