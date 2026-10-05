import {
  openGridset,
  getNamedStyles,
  getInlineStyles,
  readStyleProps,
  setStyleProp,
  parseArgb,
  argbToCss,
  cssToArgb,
  adjustForContrast,
  compositeOver,
  styleBackgroundRgb,
  styleFontRgb,
  styleContrastInfo,
} from './gridset.js';

const state = {
  fileName: null,
  zip: null,
  stylesDoc: null,
  stylesPath: null,
  gridDocs: new Map(),
  dirtyDocs: new Set(),
  changedStyles: new Set(),
};

const el = (id) => document.getElementById(id);

const VALIDATOR_URL =
  'https://esm.sh/@willwade/aac-processors@0.3.7/dist/browser/validation/gridsetValidator.js';

function setUploadError(message) {
  const p = el('upload-error');
  p.textContent = message;
  p.hidden = !message;
}

async function handleFile(file) {
  if (!/\.gridset$/i.test(file.name)) {
    setUploadError('Please choose a .gridset file (Grid 3). Other formats are not supported yet.');
    return;
  }
  setUploadError('');
  try {
    const opened = await openGridset(file);
    Object.assign(state, {
      fileName: file.name,
      zip: opened.zip,
      stylesDoc: opened.stylesDoc,
      stylesPath: opened.stylesPath,
      gridDocs: opened.gridDocs,
      dirtyDocs: new Set(),
      changedStyles: new Set(),
    });
    el('upload-section').hidden = true;
    el('editor-section').hidden = false;
    clearVerifyStatus();
    renderAll();
  } catch (err) {
    setUploadError(err.message || 'Could not read this gridset.');
  }
}

function targetStyleEls() {
  const els = [...getNamedStyles(state.stylesDoc)];
  if (el('include-inline').checked) {
    for (const doc of state.gridDocs.values()) els.push(...getInlineStyles(doc));
  }
  return els;
}

function markChanged(styleEl) {
  state.changedStyles.add(styleEl);
  state.dirtyDocs.add(styleEl.ownerDocument);
  updateChangeCount();
}

function updateChangeCount() {
  const n = state.changedStyles.size;
  const span = el('change-count');
  span.textContent = n === 0 ? 'No changes yet' : `${n} style${n === 1 ? '' : 's'} changed`;
  el('download-btn').disabled = n === 0;
  clearVerifyStatus();
}

function showFixResult(message) {
  const p = el('fix-result');
  p.textContent = message;
  p.hidden = false;
}

function applyBumpSize() {
  const delta = parseInt(el('bump-delta').value, 10);
  const base = parseInt(el('bump-base').value, 10);
  if (Number.isNaN(delta) || Number.isNaN(base) || base < 1) {
    showFixResult('Enter a valid delta and base first.');
    return;
  }
  let bumped = 0, injected = 0;
  for (const styleEl of targetStyleEls()) {
    const props = readStyleProps(styleEl);
    const current = props.FontSize !== undefined ? parseInt(props.FontSize, 10) : NaN;
    if (!Number.isNaN(current)) {
      setStyleProp(styleEl, 'FontSize', Math.max(1, current + delta));
      bumped++;
    } else {
      setStyleProp(styleEl, 'FontSize', base + delta);
      injected++;
    }
    markChanged(styleEl);
  }
  showFixResult(`Font size: bumped ${bumped} style(s), set ${injected} style(s) that had no size to ${base + delta}.`);
  renderAll();
}

function applySetSize() {
  const value = parseInt(el('set-size-value').value, 10);
  if (Number.isNaN(value) || value < 1) {
    showFixResult('Enter a valid size first.');
    return;
  }
  let n = 0;
  for (const styleEl of targetStyleEls()) {
    setStyleProp(styleEl, 'FontSize', value);
    markChanged(styleEl);
    n++;
  }
  showFixResult(`Set font size to ${value} in ${n} style(s).`);
  renderAll();
}

function applySetFont() {
  const family = el('font-family-value').value.trim();
  if (!family) {
    showFixResult('Enter a font name first.');
    return;
  }
  let n = 0;
  for (const styleEl of targetStyleEls()) {
    setStyleProp(styleEl, 'FontName', family);
    markChanged(styleEl);
    n++;
  }
  showFixResult(`Set font family to "${family}" in ${n} style(s).`);
  renderAll();
}

function applyContrast() {
  const mode = el('contrast-mode').value;
  const target = parseFloat(el('contrast-target').value);
  let adjusted = 0, alreadyOk = 0;

  for (const styleEl of targetStyleEls()) {
    const props = readStyleProps(styleEl);

    if (mode === 'bw' || mode === 'wb') {
      const font = mode === 'bw' ? '#FF000000' : '#FFFFFFFF';
      const tile = mode === 'bw' ? '#FFFFFFFF' : '#FF000000';
      setStyleProp(styleEl, 'FontColour', font);
      setStyleProp(styleEl, 'TileColour', tile);
      if (props.BackColour !== undefined) setStyleProp(styleEl, 'BackColour', tile);
      markChanged(styleEl);
      adjusted++;
      continue;
    }

    const bg = styleBackgroundRgb(props);
    const fg = compositeOver(styleFontRgb(props), bg);
    if (contrastInfoOf(fg, bg) >= target) {
      alreadyOk++;
      continue;
    }
    const fixed = adjustForContrast(fg, bg, target);
    setStyleProp(styleEl, 'FontColour', cssToArgb(argbToCss(fixed)));
    markChanged(styleEl);
    adjusted++;
  }
  showFixResult(
    `Contrast: adjusted ${adjusted} style(s) to reach ${target}:1. ${alreadyOk} already met the target.`
  );
  renderAll();
}

function contrastInfoOf(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(rgb) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

function renderAll() {
  renderSummary();
  renderStyleCards();
  renderGridList();
  updateChangeCount();
}

function renderSummary() {
  const named = getNamedStyles(state.stylesDoc);
  let inline = 0;
  for (const doc of state.gridDocs.values()) inline += getInlineStyles(doc).length;

  let missingSize = 0, lowContrast = 0;
  for (const s of [...named, ...allInlineEls()]) {
    const props = readStyleProps(s);
    if (props.FontSize === undefined) missingSize++;
    if (styleContrastInfo(props).grade !== 'ok') lowContrast++;
  }

  const chips = [];
  chips.push(`<span class="issue-ok">${named.length} named styles</span>`);
  chips.push(`<span class="issue-ok">${state.gridDocs.size} grids (${inline} inline styles)</span>`);
  if (missingSize > 0) {
    chips.push(`<span class="issue-warn">${missingSize} styles set no font size (Grid 3 default applies)</span>`);
  }
  if (lowContrast > 0) {
    chips.push(`<span class="issue-bad">${lowContrast} styles below 4.5:1 text contrast</span>`);
  } else {
    chips.push(`<span class="issue-ok">All styles meet 4.5:1 contrast</span>`);
  }

  el('gridset-summary').innerHTML =
    `<strong>${escapeHtml(state.fileName)}</strong>` +
    `<div class="issues">${chips.join('')}</div>`;
}

function allInlineEls() {
  const out = [];
  for (const doc of state.gridDocs.values()) out.push(...getInlineStyles(doc));
  return out;
}

function renderStyleCards() {
  const container = el('style-cards');
  container.innerHTML = '';
  const named = getNamedStyles(state.stylesDoc);
  el('style-count').textContent = named.length;

  for (const styleEl of named) {
    container.appendChild(buildStyleCard(styleEl));
  }
}

function buildStyleCard(styleEl) {
  const card = document.createElement('div');
  card.className = 'style-card';

  const props = readStyleProps(styleEl);
  const key = styleEl.getAttribute('Key') || '(unnamed)';

  const h = document.createElement('h3');
  h.textContent = key;
  card.appendChild(h);

  if (props.Name && props.Name !== key) {
    const sub = document.createElement('p');
    sub.className = 'style-sub';
    sub.textContent = props.Name;
    card.appendChild(sub);
  }

  const badges = document.createElement('div');
  badges.className = 'badges';
  card.appendChild(badges);

  const preview = document.createElement('div');
  preview.className = 'preview-tile';
  preview.textContent = 'Aa Sample';
  card.appendChild(preview);

  const grid = document.createElement('div');
  grid.className = 'prop-grid';
  card.appendChild(grid);

  const refresh = () => {
    const p = readStyleProps(styleEl);
    const bg = styleBackgroundRgb(p);
    preview.style.background = argbToCss(bg);
    preview.style.color = argbToCss(compositeOver(styleFontRgb(p), bg));
    preview.style.border = `2px solid ${argbToCss(parseArgb(p.BorderColour) || { r: 160, g: 160, b: 160 })}`;
    preview.style.fontFamily = p.FontName ? `"${p.FontName}", sans-serif` : 'sans-serif';
    preview.style.fontSize = `${p.FontSize ? Math.min(64, parseInt(p.FontSize, 10)) : 18}px`;

    badges.innerHTML = '';
    const { ratio, grade } = styleContrastInfo(p);
    const b = document.createElement('span');
    b.className = `badge badge-${grade}`;
    b.textContent = `contrast ${ratio.toFixed(2)}:1${grade === 'ok' ? '' : grade === 'warn' ? ' — low' : ' — fails AA'}`;
    badges.appendChild(b);
    if (p.FontSize === undefined) {
      const m = document.createElement('span');
      m.className = 'badge badge-muted';
      m.textContent = 'no font size set';
      badges.appendChild(m);
    }
  };

  const addRow = (labelText, buildControl) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const cell = document.createElement('div');
    cell.className = 'prop-row';
    cell.appendChild(buildControl());
    grid.appendChild(label);
    grid.appendChild(cell);
  };

  const addColorRow = (labelText, propName) => {
    addRow(labelText, () => {
      const wrap = document.createDocumentFragment();
      const picker = document.createElement('input');
      picker.type = 'color';
      const hex = document.createElement('input');
      hex.type = 'text';
      hex.className = 'hex';
      hex.placeholder = propName;

      const update = () => {
        const parsed = parseArgb(readStyleProps(styleEl)[propName]);
        if (parsed) {
          picker.value = argbToCss(parsed);
          hex.value = `#${parsed.a.toString(16).padStart(2, '0').toUpperCase()}${argbToCss(parsed).slice(1)}`.toUpperCase();
        } else {
          picker.value = '#ffffff';
          hex.value = '';
        }
      };
      picker.addEventListener('input', () => {
        const orig = parseArgb(readStyleProps(styleEl)[propName]);
        setStyleProp(styleEl, propName, cssToArgb(picker.value, orig ? orig.a : 255));
        markChanged(styleEl);
        hex.value = cssToArgb(picker.value, orig ? orig.a : 255);
        refresh();
      });
      hex.addEventListener('change', () => {
        const parsed = parseArgb(hex.value);
        if (parsed) {
          setStyleProp(styleEl, propName,
            cssToArgb(argbToCss(parsed), parsed.a));
          markChanged(styleEl);
          refresh();
        } else {
          update();
        }
      });
      update();
      wrap.appendChild(picker);
      wrap.appendChild(hex);
      return wrap;
    });
  };

  addColorRow('Background', 'BackColour');
  addColorRow('Tile', 'TileColour');
  addColorRow('Border', 'BorderColour');
  addColorRow('Text', 'FontColour');

  addRow('Font', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('list', 'font-suggestions');
    input.placeholder = 'not set';
    input.value = props.FontName || '';
    input.addEventListener('change', () => {
      if (input.value.trim()) {
        setStyleProp(styleEl, 'FontName', input.value.trim());
        markChanged(styleEl);
      }
      refresh();
    });
    return input;
  });

  addRow('Font size', () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.placeholder = 'not set';
    input.value = props.FontSize || '';
    input.addEventListener('change', () => {
      const v = parseInt(input.value, 10);
      if (!Number.isNaN(v) && v >= 1) {
        setStyleProp(styleEl, 'FontSize', v);
        markChanged(styleEl);
      }
      refresh();
    });
    return input;
  });

  refresh();
  return card;
}

function renderGridList() {
  const container = el('grid-list');
  container.innerHTML = '';
  for (const [name, doc] of state.gridDocs) {
    const styles = getInlineStyles(doc);
    const withSize = styles.filter((s) => readStyleProps(s).FontSize !== undefined).length;
    const row = document.createElement('div');
    row.className = 'grid-row';
    const label = document.createElement('span');
    label.textContent = name.replace(/^Grids\//, '').replace(/\/grid\.xml$/i, '');
    const meta = document.createElement('span');
    meta.className = 'g-meta';
    meta.textContent = `${styles.length} style(s), ${withSize} with font size`;
    row.appendChild(label);
    row.appendChild(meta);
    container.appendChild(row);
  }
}

async function buildModifiedBlob() {
  const zip = state.zip;
  const serializer = new XMLSerializer();
  if (state.dirtyDocs.has(state.stylesDoc)) {
    zip.file(state.stylesPath, serializer.serializeToString(state.stylesDoc));
  }
  for (const [name, doc] of state.gridDocs) {
    if (state.dirtyDocs.has(doc)) {
      zip.file(name, serializer.serializeToString(doc));
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function clearVerifyStatus() {
  el('verify-status').innerHTML = '';
}

async function verifyBlob(blob, filename) {
  const { GridsetValidator } = await import(VALIDATOR_URL);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new GridsetValidator().validate(bytes, filename, bytes.byteLength);
}

function renderVerifyStatus(result) {
  const box = el('verify-status');
  if (result.valid && result.warnings === 0) {
    box.innerHTML = `<p class="v-ok">Verified: gridset structure checks passed.</p>`;
    return;
  }
  const cls = result.valid ? 'v-warn' : 'v-bad';
  const heading = result.valid
    ? `Verified with ${result.warnings} warning(s):`
    : `Verification found ${result.errors} error(s), ${result.warnings} warning(s):`;
  const items = [];
  for (const check of result.results || []) {
    if (check.error) items.push(`<li>${escapeHtml(check.description)}: ${escapeHtml(check.error)}</li>`);
    for (const w of check.warnings || []) {
      items.push(`<li>${escapeHtml(check.description)}: ${escapeHtml(w)}</li>`);
    }
  }
  box.innerHTML =
    `<p class="${cls}">${heading}</p>` +
    (items.length ? `<details><summary>Details</summary><ul>${items.join('')}</ul></details>` : '');
}

async function download() {
  const btn = el('download-btn');
  btn.disabled = true;
  try {
    const blob = await buildModifiedBlob();
    const outName = state.fileName.replace(/\.gridset$/i, '') + '-edited.gridset';

    btn.textContent = 'Verifying…';
    try {
      const result = await verifyBlob(blob, outName);
      renderVerifyStatus(result);
    } catch (err) {
      el('verify-status').innerHTML =
        `<p class="v-warn">Could not run the verifier (${escapeHtml(err.message || err)}). Downloading anyway.</p>`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } finally {
    btn.textContent = 'Download modified gridset';
    btn.disabled = state.changedStyles.size === 0;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function wire() {
  const dz = el('drop-zone');
  const input = el('file-input');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    if (input.files.length) handleFile(input.files[0]);
  });
  ['dragover', 'dragenter'].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
    })
  );
  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'bump-size') applyBumpSize();
      else if (action === 'set-size') applySetSize();
      else if (action === 'set-font') applySetFont();
      else if (action === 'fix-contrast') applyContrast();
    });
  });

  el('download-btn').addEventListener('click', download);
}

wire();

window.__gs = {
  state,
  buildModifiedBlob,
  verifyBlob,
};
