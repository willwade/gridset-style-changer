import {
  openGridset,
  getNamedStyles,
  isDefaultStyle,
  ensureDefaultStyle,
  getInlineStyles,
  readStyleProps,
  setStyleProp,
  parseColour,
  rgbToCss,
  rgbaToHex,
  adjustForContrast,
  contrastRatio,
  compositeOver,
  styleBackgroundRgb,
  styleFontRgb,
  styleContrastInfo,
  styleAppearance,
} from './gridset.js';

const state = {
  fileName: null,
  isUserFile: false,
  outerZip: null,
  contexts: [],
  selectedGridsets: new Set(),
  activeContext: null,
  zip: null,
  stylesDoc: null,
  stylesPath: null,
  gridDocs: new Map(),
  dirtyDocs: new Set(),
  changedStyles: new Set(),
  commonStyleChanges: new Map(),
};

const el = (id) => document.getElementById(id);

const VALIDATOR_URL =
  'https://esm.sh/@willwade/aac-processors@0.3.7/dist/browser/validation/gridsetValidator.js';

const COLOUR_MATRIX = [
  '#FFFFFF', '#E0E0E0', '#BDBDBD', '#9E9E9E', '#757575', '#616161', '#424242', '#000000',
  '#FFCDD2', '#FFE0B2', '#FFF9C4', '#DCEDC8', '#B2DFDB', '#BBDEFB', '#D1C4E9', '#F8BBD0',
  '#EF9A9A', '#FFCC80', '#FFF59D', '#AED581', '#80CBC4', '#90CAF9', '#B39DDB', '#F48FB1',
  '#F44336', '#FF9800', '#FFEB3B', '#8BC34A', '#009688', '#2196F3', '#673AB7', '#E91E63',
  '#B71C1C', '#E65100', '#827717', '#33691E', '#004D40', '#0D47A1', '#311B92', '#880E4F',
];

const FONT_FAMILIES = [
  'Arial', 'Verdana', 'Tahoma', 'Times New Roman', 'Georgia',
  'Comic Sans MS', 'Trebuchet MS', 'Calibri', 'Roboto', 'Booster',
];

function buildFontControl(value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'font-control';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Font family');
  const families = [...new Set([...FONT_FAMILIES, ...(value ? [value] : [])])];
  for (const family of ['', ...families, '__custom__']) {
    const option = document.createElement('option');
    option.value = family;
    option.textContent = family === '__custom__' ? 'Custom font...' : family || 'Not set';
    option.disabled = !family;
    select.appendChild(option);
  }
  select.value = value;
  const custom = document.createElement('input');
  custom.type = 'text';
  custom.placeholder = 'Font name';
  custom.setAttribute('aria-label', 'Custom font family');
  custom.hidden = true;
  custom.addEventListener('change', () => {
    if (custom.value.trim()) onChange(custom.value.trim());
    else {
      custom.setCustomValidity('Enter a font name.');
      custom.reportValidity();
    }
  });
  custom.addEventListener('input', () => custom.setCustomValidity(''));
  select.addEventListener('change', () => {
    custom.hidden = select.value !== '__custom__';
    if (!custom.hidden) custom.focus();
    else if (select.value) onChange(select.value);
  });
  wrap.append(select, custom);
  return wrap;
}

function setUploadError(message) {
  const p = el('upload-error');
  p.textContent = message;
  p.hidden = !message;
}

async function handleFile(file) {
  if (!/\.(gridset|grid3user)$/i.test(file.name)) {
    setUploadError('Please choose a .gridset or .grid3user file (Grid 3).');
    return;
  }
  setUploadError('');
  try {
    state.fileName = file.name;
    state.isUserFile = /\.grid3user$/i.test(file.name);
    state.outerZip = null;
    state.contexts = [];
    state.selectedGridsets = new Set();
    state.changedStyles = new Set();
    state.commonStyleChanges.clear();
    state.dirtyDocs = new Set();

    if (state.isUserFile) {
      const { zip, contexts } = await openGrid3User(file);
      state.outerZip = zip;
      state.contexts = contexts;
      state.selectedGridsets = new Set(contexts.map((context) => context.id));
      el('user-gridsets').hidden = false;
      el('gridset-editor-section').hidden = false;
    } else {
      const context = await openGridsetContext(file.name, file, 'standalone');
      state.contexts = [context];
      state.selectedGridsets = new Set([context.id]);
      el('user-gridsets').hidden = true;
      el('gridset-editor-section').hidden = true;
    }
    state.activeContext = state.contexts[0];
    useActiveContext();
    el('upload-section').hidden = true;
    el('editor-section').hidden = false;
    clearVerifyStatus();
    renderAll();
  } catch (err) {
    setUploadError(err.message || 'Could not read this Grid 3 file.');
  }
}

async function openGridsetContext(name, file, sourceType, sourcePath = '') {
  const opened = await openGridset(file);
  return {
    id: `${sourceType}:${sourcePath || name}`,
    name,
    sourceType,
    sourcePath,
    ...opened,
    dirtyDocs: new Set(),
  };
}

async function openGrid3User(file) {
  const zip = await JSZip.loadAsync(file);
  const contexts = [];
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const gridsetFiles = entries.filter((entry) => /\.gridset$/i.test(entry.name));
  for (const entry of gridsetFiles) {
    const blob = await entry.async('blob');
    contexts.push(await openGridsetContext(entry.name, blob, 'archive', entry.name));
  }

  const prefixes = new Set();
  for (const entry of entries) {
    const match = /^(.*?)(?:Settings0\/Styles\/styles\.xml)$/i.exec(entry.name);
    if (match) prefixes.add(match[1]);
  }

  for (const prefix of prefixes) {
    const hasGrid = entries.some((entry) =>
      entry.name.startsWith(prefix) &&
      /^Grids\/.+\/grid\.xml$/i.test(entry.name.slice(prefix.length))
    );
    if (!hasGrid) continue;

    const gridsetZip = new JSZip();
    for (const entry of entries) {
      if (entry.name.startsWith(prefix)) {
        gridsetZip.file(entry.name.slice(prefix.length), await entry.async('uint8array'));
      }
    }
    const name = prefix.replace(/\/$/, '') || 'Gridset';
    const gridsetBlob = await gridsetZip.generateAsync({ type: 'blob' });
    contexts.push(await openGridsetContext(name, gridsetBlob, 'directory', prefix));
  }

  if (contexts.length === 0) {
    throw new Error('No gridsets were found in this .grid3user file.');
  }
  return { zip, contexts };
}

function useActiveContext() {
  const context = state.activeContext;
  Object.assign(state, {
    zip: context.zip,
    stylesDoc: context.stylesDoc,
    stylesPath: context.stylesPath,
    gridDocs: context.gridDocs,
    dirtyDocs: context.dirtyDocs,
  });
}

function selectedContexts() {
  return state.contexts.filter((context) => state.selectedGridsets.has(context.id));
}

function targetStyleEls(createDefault = true) {
  const els = [];
  for (const context of selectedContexts()) {
    if (createDefault && el('include-default').checked) ensureDefaultStyle(context.stylesDoc);
    els.push(...getNamedStyles(context.stylesDoc).filter((style) =>
      el('include-default').checked || !isDefaultStyle(style)
    ));
    if (el('include-inline').checked) {
      for (const doc of context.gridDocs.values()) els.push(...getInlineStyles(doc));
    }
  }
  return [...new Set(els)];
}

function markChanged(styleEl) {
  state.changedStyles.add(styleEl);
  const context = state.contexts.find((item) =>
    item.stylesDoc === styleEl.ownerDocument ||
    [...item.gridDocs.values()].includes(styleEl.ownerDocument)
  );
  if (context) context.dirtyDocs.add(styleEl.ownerDocument);
  updateChangeCount();
}

function setNamedStyleProp(styleEl, propName, value) {
  setStyleProp(styleEl, propName, value);
  markChanged(styleEl);
  renderCommonStyle();
}

function updateChangeCount() {
  const n = state.changedStyles.size;
  const span = el('change-count');
  span.textContent = n === 0 ? 'No changes yet' : `${n} style${n === 1 ? '' : 's'} changed`;
  el('download-btn').disabled = n === 0;
  el('download-btn').textContent = state.isUserFile
    ? 'Download modified user file'
    : 'Download modified gridset';
  clearVerifyStatus();
}

function showFixResult(message, warning = false) {
  const p = el('fix-result');
  p.textContent = message;
  p.classList.toggle('fix-result-warning', warning);
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
  state.commonStyleChanges.delete('FontSize');
  renderAll();
}

function applyContrast() {
  const mode = el('contrast-mode').value;
  const target = parseFloat(el('contrast-target').value);
  for (const property of ['BackColour', 'TileColour', 'FontColour']) {
    state.commonStyleChanges.delete(property);
  }
  let adjusted = 0, alreadyOk = 0, belowTarget = 0, opaqueBackgrounds = 0;

  // Snapshot inheritance before edits to Default or other base styles change it.
  const targets = targetStyleEls().map((styleEl) => {
    const context = state.contexts.find((item) =>
      item.stylesDoc === styleEl.ownerDocument ||
      [...item.gridDocs.values()].includes(styleEl.ownerDocument)
    );
    const gridDoc = styleEl.ownerDocument === context.stylesDoc ? null : styleEl.ownerDocument;
    return { styleEl, ...styleAppearance(styleEl, context.stylesDoc, gridDoc) };
  });
  for (const { styleEl, props, bg, backgroundKnown } of targets) {

    if (mode === 'bw' || mode === 'wb') {
      const font = mode === 'bw' ? '#000000FF' : '#FFFFFFFF';
      const tile = mode === 'bw' ? '#FFFFFFFF' : '#000000FF';
      setStyleProp(styleEl, 'FontColour', font);
      setStyleProp(styleEl, 'TileColour', tile);
      setStyleProp(styleEl, 'BackColour', tile);
      markChanged(styleEl);
      adjusted++;
      continue;
    }

    const local = readStyleProps(styleEl);
    for (const property of ['BackColour', 'TileColour', 'FontColour']) {
      const effective = props[property] ??
        (property === 'FontColour' ? '#000000FF' : '#FFFFFF00');
      if (local[property] === undefined) {
        setStyleProp(styleEl, property, effective);
        markChanged(styleEl);
      }
    }
    if (!backgroundKnown) {
      const background = rgbaToHex(bg.r, bg.g, bg.b, 1);
      setStyleProp(styleEl, 'BackColour', background);
      setStyleProp(styleEl, 'TileColour', background);
      markChanged(styleEl);
      opaqueBackgrounds++;
    }
    const fg = compositeOver(styleFontRgb(props), bg);
    if (contrastRatio(fg, bg) >= target) {
      if (isDefaultStyle(styleEl) &&
          (props.FontColour === undefined ||
            (props.TileColour === undefined && props.BackColour === undefined))) {
        if (props.FontColour === undefined) {
          const font = styleFontRgb(props);
          setStyleProp(styleEl, 'FontColour', rgbaToHex(font.r, font.g, font.b, font.a));
        }
        if (props.TileColour === undefined && props.BackColour === undefined) {
          setStyleProp(styleEl, 'BackColour', rgbaToHex(bg.r, bg.g, bg.b, 1));
        }
        markChanged(styleEl);
      }
      alreadyOk++;
      continue;
    }
    const fixed = adjustForContrast(fg, bg, target);
    setStyleProp(styleEl, 'FontColour', rgbaToHex(fixed.r, fixed.g, fixed.b, 1));
    if (isDefaultStyle(styleEl) && props.TileColour === undefined && props.BackColour === undefined) {
      setStyleProp(styleEl, 'BackColour', rgbaToHex(bg.r, bg.g, bg.b, 1));
    }
    if (contrastRatio(fixed, bg) < target) belowTarget++;
    markChanged(styleEl);
    adjusted++;
  }
  showFixResult(
    `Contrast: adjusted ${adjusted} style(s). ${alreadyOk} already met ${target}:1.` +
    (opaqueBackgrounds
      ? ` Made ${opaqueBackgrounds} background(s) opaque because the inherited/grid background was unknown or image-based.`
      : '') +
    (belowTarget
      ? ` ${belowTarget} cannot reach ${target}:1 with text changes alone; the best black/white text was used. Try black-on-white or white-on-black.`
      : ` All targeted styles now meet ${target}:1.`),
    belowTarget > 0
  );
  renderAll();
}

function renderAll() {
  renderUserGridsets();
  renderCommonStyle();
  renderSummary();
  renderStyleCards();
  renderGridList();
  updateChangeCount();
}

function renderUserGridsets() {
  if (!state.isUserFile) return;
  const targets = el('gridset-targets');
  const editor = el('gridset-editor');
  targets.replaceChildren();
  editor.replaceChildren();

  for (const context of state.contexts) {
    const label = document.createElement('label');
    label.className = 'gridset-target';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedGridsets.has(context.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.selectedGridsets.add(context.id);
      } else if (state.selectedGridsets.size > 1) {
        state.selectedGridsets.delete(context.id);
      } else {
        checkbox.checked = true;
        return;
      }
      renderAll();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(context.name));
    targets.appendChild(label);

    const option = document.createElement('option');
    option.value = context.id;
    option.textContent = context.name;
    option.selected = context === state.activeContext;
    editor.appendChild(option);
  }
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
    `<strong>${escapeHtml(state.isUserFile ? state.fileName + ' — ' + state.activeContext.name : state.fileName)}</strong>` +
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

function renderCommonStyle() {
  const targets = targetStyleEls(false);
  const properties = ['BackColour', 'TileColour', 'BorderColour', 'FontColour', 'FontName', 'FontSize'];
  const snapshot = document.implementation.createDocument(null, 'Style');
  const style = snapshot.documentElement;
  const values = targets.map(readStyleProps);
  const colourStates = new Map();
  for (const property of properties) {
    const value = values[0]?.[property];
    if (property.endsWith('Colour')) {
      const colours = values.map((props) => parseColour(props[property]));
      const first = colours[0];
      const rgbKnown = Boolean(first && colours.every((colour) => colour && rgbToCss(colour) === rgbToCss(first)));
      const alphaKnown = Boolean(first && colours.every((colour) => colour?.a === first.a));
      colourStates.set(property, { rgbKnown, alphaKnown });
      if (rgbKnown || alphaKnown) {
        const colour = rgbKnown ? first : { r: 255, g: 255, b: 255 };
        setStyleProp(style, property, rgbaToHex(colour.r, colour.g, colour.b, alphaKnown ? first.a : 1));
      }
    } else if (value !== undefined && values.every((props) => props[property] === value)) {
      setStyleProp(style, property, value);
    }
  }
  for (const [property, change] of state.commonStyleChanges) {
    setStyleProp(style, property, change.value);
    const known = colourStates.get(property);
    if (known) {
      if (change.components.has('rgb')) known.rgbKnown = true;
      if (change.components.has('alpha')) known.alphaKnown = true;
    }
  }
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'btn btn-primary';
  apply.dataset.action = 'apply-common-style';
  apply.textContent = 'Apply';
  apply.disabled = state.commonStyleChanges.size === 0;
  const card = buildStyleCard(style, {
    common: true,
    colourStates,
    setProperty(property, value, component) {
      const previous = state.commonStyleChanges.get(property);
      const components = new Set(previous?.components);
      if (component) components.add(component);
      const known = colourStates.get(property);
      if (known && component === 'rgb') known.rgbKnown = true;
      if (known && component === 'alpha') known.alphaKnown = true;
      state.commonStyleChanges.set(property, { value, components });
      setStyleProp(style, property, value);
      apply.disabled = false;
    },
  });
  apply.addEventListener('click', () => {
    for (const input of card.querySelectorAll('input')) {
      if (!input.hidden && !input.reportValidity()) return;
    }
    const targets = targetStyleEls();
    if (!targets.length) {
      showFixResult('No styles are targeted. Include Default or inline styles, or choose another gridset.', true);
      return;
    }
    for (const target of targets) {
      for (const [property, { value, components }] of state.commonStyleChanges) {
        let updated = value;
        if (components.size === 1) {
          const colour = parseColour(value);
          const original = parseColour(readStyleProps(target)[property]) ||
            (property === 'FontColour' ? styleFontRgb({}) : { r: 255, g: 255, b: 255, a: 1 });
          const result = components.has('alpha') ? { ...original, a: colour.a } : { ...colour, a: original.a };
          updated = rgbaToHex(result.r, result.g, result.b, result.a);
        }
        setStyleProp(target, property, updated);
      }
      markChanged(target);
    }
    showFixResult(`Applied ${state.commonStyleChanges.size} style change(s) to ${targets.length} style(s).`);
    state.commonStyleChanges.clear();
    renderAll();
  });
  card.appendChild(apply);
  card.querySelector('.font-control option').textContent = 'Mixed / not set';
  card.querySelector('.prop-row > input[type="number"]').placeholder = 'Mixed / not set';
  el('common-style').replaceChildren(card);
}

function buildStyleCard(styleEl, { common = false, colourStates, setProperty = (property, value) =>
  setNamedStyleProp(styleEl, property, value) } = {}) {
  const card = document.createElement('div');
  card.className = 'style-card';

  const props = readStyleProps(styleEl);
  const key = common ? 'Change styles throughout' : styleEl.getAttribute('Key') || '(unnamed)';

  const h = document.createElement('h3');
  h.textContent = key;
  card.appendChild(h);
  if (common) {
    const hint = document.createElement('p');
    hint.className = 'style-sub';
    hint.textContent = 'Edit fields, then click Apply to change them in all targeted styles. Blank values mean mixed or not set. Preview is illustrative when values differ.';
    card.appendChild(hint);
  }

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
    preview.style.background = rgbToCss(bg);
    preview.style.color = rgbToCss(compositeOver(styleFontRgb(p), bg));
    const border = parseColour(p.BorderColour) || { r: 160, g: 160, b: 160, a: 1 };
    preview.style.border = `2px solid ${rgbaToHex(border.r, border.g, border.b, border.a)}`;
    preview.style.fontFamily = p.FontName ? `"${p.FontName}", sans-serif` : 'sans-serif';
    preview.style.fontSize = `${p.FontSize ? Math.min(64, parseInt(p.FontSize, 10)) : 18}px`;

    badges.innerHTML = '';
    const { ratio, grade } = styleContrastInfo(p);
    const b = document.createElement('span');
    b.className = `badge badge-${grade}`;
    b.textContent = `contrast ${ratio.toFixed(2)}:1${grade === 'ok' ? '' : grade === 'warn' ? ' — low' : ' — fails AA'}`;
    badges.appendChild(b);
    badges.hidden = common;
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
      const wrap = document.createElement('div');
      wrap.className = 'colour-control';
      wrap.dataset.property = propName;

      const palette = document.createElement('details');
      palette.className = 'colour-palette';
      const summary = document.createElement('summary');
      summary.setAttribute('aria-label', `${labelText} colour matrix`);
      const sample = document.createElement('span');
      sample.className = 'colour-sample';
      const sampleFill = document.createElement('span');
      sample.appendChild(sampleFill);
      summary.title = `${labelText}: open colour matrix`;
      summary.appendChild(sample);
      palette.appendChild(summary);

      const matrix = document.createElement('div');
      matrix.className = 'colour-matrix';
      matrix.setAttribute('role', 'group');
      matrix.setAttribute('aria-label', `${labelText} colours`);

      const transparencyLabel = document.createElement('label');
      transparencyLabel.className = 'transparency-control';
      const transparency = document.createElement('input');
      transparency.type = 'number';
      transparency.min = '0';
      transparency.max = '100';
      transparency.step = '1';
      transparency.setAttribute('aria-label', `${labelText} transparency`);
      transparency.title = 'Transparency: 0% is fully opaque; 100% is fully transparent.';
      transparency.placeholder = '—';
      transparencyLabel.append(transparency, document.createTextNode('%'));

      const update = () => {
        const raw = readStyleProps(styleEl)[propName];
        const parsed = parseColour(raw);
        const known = colourStates?.get(propName);
        summary.title = parsed
          ? `${labelText}: ${rgbaToHex(parsed.r, parsed.g, parsed.b, parsed.a)} — open colour matrix`
          : `${labelText}: ${raw ? 'unrecognised colour ' + raw : 'not set'} — open colour matrix`;
        if (known && (!known.rgbKnown || !known.alphaKnown)) {
          summary.title = `${labelText}: ${known.rgbKnown && parsed ? rgbToCss(parsed) : 'mixed colours'}; ${known.alphaKnown ? 'shared transparency' : 'mixed or unset transparency'} — open colour matrix`;
        }
        sampleFill.style.backgroundColor = parsed && (!known || known.rgbKnown) ? rgbToCss(parsed) : 'transparent';
        transparency.value = parsed && (!known || known.alphaKnown) ? String(Math.round((1 - parsed.a) * 100)) : '';
        for (const swatch of matrix.children) {
          swatch.setAttribute('aria-pressed', String(Boolean(parsed && (!known || known.rgbKnown) && rgbToCss(parsed) === swatch.dataset.colour)));
        }
      };

      const save = (colour, component) => {
        setProperty(propName, rgbaToHex(colour.r, colour.g, colour.b, colour.a), component);
        update();
        refresh();
        renderSummary();
      };

      for (const colour of COLOUR_MATRIX) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'colour-swatch';
        swatch.dataset.colour = colour;
        swatch.style.backgroundColor = colour;
        swatch.title = colour;
        swatch.setAttribute('aria-label', `${labelText} ${colour}`);
        swatch.addEventListener('click', () => {
          const original = parseColour(readStyleProps(styleEl)[propName]);
          save({ ...parseColour(colour), a: original?.a ?? 1 }, 'rgb');
          palette.open = false;
          summary.focus();
        });
        matrix.appendChild(swatch);
      }

      palette.appendChild(matrix);
      palette.addEventListener('toggle', () => {
        if (palette.open) {
          document.querySelectorAll('.colour-palette[open]').forEach((other) => {
            if (other !== palette) other.open = false;
          });
        }
      });
      transparency.addEventListener('input', () => {
        if (transparency.value === '' || !transparency.validity.valid) {
          transparency.setAttribute('aria-invalid', 'true');
          transparency.reportValidity();
          return;
        }
        transparency.setAttribute('aria-invalid', 'false');
        const original = parseColour(readStyleProps(styleEl)[propName]) ||
          (propName === 'FontColour' ? styleFontRgb({}) : { r: 255, g: 255, b: 255 });
        save({ ...original, a: 1 - Number(transparency.value) / 100 }, 'alpha');
      });
      update();
      wrap.append(palette, transparencyLabel);
      return wrap;
    });
  };

  addColorRow('Background', 'BackColour');
  addColorRow('Tile', 'TileColour');
  addColorRow('Border', 'BorderColour');
  addColorRow('Text', 'FontColour');

  addRow('Font', () => {
    return buildFontControl(props.FontName || '', (family) => {
      setProperty('FontName', family);
      refresh();
    });
  });

  addRow('Font size', () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.placeholder = 'not set';
    input.value = props.FontSize || '';
    input.addEventListener('change', () => {
      const v = parseInt(input.value, 10);
      if (input.value !== '' && input.validity.valid && !Number.isNaN(v) && v >= 1) {
        setProperty('FontSize', v);
      } else {
        input.reportValidity();
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

async function buildModifiedBlob(context = state.activeContext) {
  const zip = context.zip;
  const serializer = new XMLSerializer();
  if (context.dirtyDocs.has(context.stylesDoc)) {
    zip.file(context.stylesPath, serializer.serializeToString(context.stylesDoc));
  }
  for (const [name, doc] of context.gridDocs) {
    if (context.dirtyDocs.has(doc)) {
      zip.file(name, serializer.serializeToString(doc));
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function buildModifiedUserBlob() {
  const output = state.outerZip;
  const serializer = new XMLSerializer();
  for (const context of state.contexts) {
    if (context.dirtyDocs.size === 0) continue;
    if (context.sourceType === 'archive') {
      const blob = await buildModifiedBlob(context);
      output.file(context.sourcePath, new Uint8Array(await blob.arrayBuffer()));
    } else {
      if (context.dirtyDocs.has(context.stylesDoc)) {
        output.file(
          context.sourcePath + context.stylesPath,
          serializer.serializeToString(context.stylesDoc)
        );
      }
      for (const [name, doc] of context.gridDocs) {
        if (context.dirtyDocs.has(doc)) {
          output.file(context.sourcePath + name, serializer.serializeToString(doc));
        }
      }
    }
  }
  return output.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function clearVerifyStatus() {
  el('verify-status').innerHTML = '';
}

async function verifyBlob(blob, filename) {
  const { GridsetValidator } = await import(VALIDATOR_URL);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new GridsetValidator().validate(bytes, filename, bytes.byteLength);
}

function renderVerifyStatus(result, box = el('verify-status')) {
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
    const blob = state.isUserFile
      ? await buildModifiedUserBlob()
      : await buildModifiedBlob();
    const outName = state.fileName.replace(/\.(gridset|grid3user)$/i, '') +
      (state.isUserFile ? '-edited.grid3user' : '-edited.gridset');

    btn.textContent = 'Verifying…';
    try {
      if (state.isUserFile) {
        const results = [];
        for (const context of state.contexts.filter((item) => item.dirtyDocs.size > 0)) {
          const edited = await buildModifiedBlob(context);
          results.push({ name: context.name, result: await verifyBlob(edited, `${context.name}.gridset`) });
        }
        renderUserVerifyStatus(results);
      } else {
        const result = await verifyBlob(blob, outName);
        renderVerifyStatus(result);
      }
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
    btn.textContent = state.isUserFile
      ? 'Download modified user file'
      : 'Download modified gridset';
    btn.disabled = state.changedStyles.size === 0;
  }
}

function renderUserVerifyStatus(results) {
  const box = el('verify-status');
  box.replaceChildren();
  for (const { name, result } of results) {
    const section = document.createElement('section');
    const title = document.createElement('strong');
    title.textContent = name;
    section.appendChild(title);
    const details = document.createElement('div');
    renderVerifyStatus(result, details);
    section.appendChild(details);
    box.appendChild(section);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function wire() {
  for (const id of ['include-default', 'include-inline']) {
    el(id).addEventListener('change', renderCommonStyle);
  }
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
  el('gridset-editor').addEventListener('change', (event) => {
    state.activeContext = state.contexts.find((context) => context.id === event.target.value);
    useActiveContext();
    renderAll();
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
      else if (action === 'fix-contrast') applyContrast();
    });
  });

  el('download-btn').addEventListener('click', download);
}

wire();

window.__gs = {
  state,
  buildModifiedBlob,
  buildModifiedUserBlob,
  verifyBlob,
};
