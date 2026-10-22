import { openStyleFile, buildModifiedBlob, buildModifiedUserBlob } from './archives.js';
import {
  inventoryCells, summariseCells, findMatches, parseCommandsXml,
  addCommands, undoAddCommands,
} from './cell-commands.js';
import {
  BUILT_IN_SCHEMAS, makeChange, makeSchema, readSchema, combineSchemas, schemaFileName, describeChange,
} from './cell-schema.js';

const VALIDATOR_URL =
  'https://esm.sh/@willwade/aac-processors@0.3.7/dist/browser/validation/gridsetValidator.js';
const PREVIEW_LIMIT = 200;

const el = (id) => document.getElementById(id);
let fileState = null;
let targets = new Set();
let cells = [];
let selectedCommands = new Set();
let selectedContentTypes = new Set();
let history = [];
let loadedSchema = null;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function showError(error) {
  console.error('Cell changer:', error);
  el('cell-error').textContent = error.message || String(error);
  el('cell-error').hidden = false;
}

function clearError() {
  el('cell-error').hidden = true;
}

function targetContexts() {
  return fileState.contexts.filter((context) => targets.has(context.id));
}

function refreshInventory() {
  cells = targetContexts().flatMap(inventoryCells);
  const grids = targetContexts().reduce((n, context) => n + context.gridDocs.size, 0);
  el('file-stats').textContent = `${cells.length} cells with content in ${grids} grids.`;
  renderLists();
}

function criteria() {
  return {
    commandIds: [...selectedCommands],
    contentTypes: [...selectedContentTypes],
    insertedText: el('inserted-text').value,
    caption: el('caption-pattern').value,
    includeGrids: el('include-grids').value,
    excludeGrids: el('exclude-grids').value,
  };
}

function checkList(container, items, selected, filter = '') {
  container.replaceChildren();
  const known = new Set(items.map((item) => item.key));
  // Selected entries not present in this file stay visible so presets are transparent.
  const all = [...items, ...[...selected].filter((key) => !known.has(key)).map((key) => ({ key, count: 0 }))];
  const query = filter.trim().toLowerCase();
  for (const { key, count } of all) {
    if (query && !key.toLowerCase().includes(query) && !selected.has(key)) continue;
    const label = node('label', undefined, 'check-item');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(key);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(key);
      else selected.delete(key);
      renderPreview();
    });
    label.append(input, node('span', key || '(none)'), node('span', String(count), 'count-badge'));
    container.append(label);
  }
  if (!container.children.length) container.append(node('p', 'None found.', 'hint'));
}

function renderLists() {
  const summary = summariseCells(cells);
  checkList(el('command-list'), summary.commandIds, selectedCommands, el('command-filter').value);
  checkList(el('content-list'), summary.contentTypes, selectedContentTypes);
  renderPreview();
}

function parsedCommands() {
  const text = el('commands-xml').value;
  if (!text.trim()) return { commands: null, message: 'No commands entered yet.' };
  try {
    const commands = parseCommandsXml(text);
    return { commands, message: `Ready to add ${commands.length} command(s): ${commands.map((c) => c.getAttribute('ID')).join(', ')}.` };
  } catch (error) {
    return { commands: null, message: error.message, error: true };
  }
}

function currentMatches() {
  return findMatches(cells, criteria());
}

function renderPreview() {
  const preview = el('preview');
  const parsed = parsedCommands();
  el('commands-status').textContent = parsed.message;
  el('commands-status').classList.toggle('error-text', Boolean(parsed.error));
  let matches = [];
  try {
    matches = currentMatches();
  } catch (error) {
    preview.replaceChildren(node('p', error.message, 'error-text'));
    el('apply').disabled = true;
    return;
  }
  const grids = new Set(matches.map((match) => `${match.context.id}|${match.grid}`));
  const shared = new Set(matches.filter((match) => match.autoContentType)
    .map((match) => `${match.context.id}|${match.grid}|${match.autoContentType}`));
  const heading = matches.length
    ? `${matches.length} matching cell(s) in ${grids.size} grid(s).` +
      (shared.size ? ` Auto-content cells use ${shared.size} shared command set(s), one per grid and type.` : '')
    : 'No cells match yet. Choose at least one cell criterion.';
  const details = node('details');
  details.append(node('summary', `Matching cells (showing up to ${PREVIEW_LIMIT})`));
  const list = node('ul');
  const multi = fileState.contexts.length > 1;
  for (const match of matches.slice(0, PREVIEW_LIMIT)) {
    const where = `${multi ? match.context.name + ' › ' : ''}${match.grid} (${match.x}, ${match.y})`;
    const caption = match.caption ? ` “${match.caption}”` : '';
    const sharedNote = match.autoContentType ? ` [shared ${match.autoContentType} commands]` : '';
    list.append(node('li', `${where}${caption} — ${match.reasons.join(', ')}${sharedNote}`));
  }
  details.append(list);
  preview.replaceChildren(node('p', heading), ...(matches.length ? [details] : []));
  el('apply').disabled = !matches.length || !parsed.commands;
}

function renderHistory() {
  el('undo').disabled = !history.length;
  el('change-count').textContent = history.length ? `(${history.length})` : '';
  el('change-log').replaceChildren(...history.map((entry) => node('li', entry.summary)));
  el('download').disabled = !fileState.contexts.some((context) => context.dirtyDocs.size);
  el('schema-save-source').options[0].textContent = `Changes applied this session (${history.length})`;
  if (!history.length && el('schema-save-source').value === 'history') el('schema-save-source').value = 'form';
}

function renderTargets() {
  const box = el('gridset-targets');
  box.replaceChildren();
  el('user-gridsets').hidden = fileState.contexts.length < 2;
  for (const context of fileState.contexts) {
    const label = node('label', undefined, 'gridset-target');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = targets.has(context.id);
    input.addEventListener('change', () => {
      if (input.checked) targets.add(context.id);
      else targets.delete(context.id);
      refreshInventory();
    });
    label.append(input, node('span', context.name));
    box.append(label);
  }
}

async function loadFile(file) {
  clearError();
  try {
    fileState = await openStyleFile(file);
    targets = new Set(fileState.contexts.map((context) => context.id));
    history = [];
    el('file-name').textContent = file.name;
    el('verify-status').replaceChildren();
    el('apply-result').hidden = true;
    renderTargets();
    refreshInventory();
    renderHistory();
    el('upload-section').hidden = true;
    el('editor-section').hidden = false;
  } catch (error) {
    showError(error);
  }
}

function applyChange(change) {
  const commands = parseCommandsXml(change.commands);
  const matches = findMatches(cells, change.criteria);
  const record = addCommands(matches, commands, change);
  const ids = commands.map((command) => command.getAttribute('ID')).join(', ');
  record.change = change;
  record.summary = `Added ${ids} to ${record.cellsChanged} cell(s)` +
    (record.sharedChanged ? ` (including ${record.sharedChanged} shared auto-content command set(s))` : '') +
    (record.cellsSkipped ? `; ${record.cellsSkipped} already had them` : '') + '.';
  if (record.cellsChanged) history.push(record);
  refreshInventory();
  return record;
}

function showResult(text) {
  const result = el('apply-result');
  result.textContent = text;
  result.hidden = false;
  el('verify-status').replaceChildren();
  renderHistory();
}

function apply() {
  clearError();
  try {
    showResult(applyChange(formChange()).summary);
  } catch (error) {
    showError(error);
  }
}

function undo() {
  const record = history.pop();
  if (!record) return;
  undoAddCommands(record);
  refreshInventory();
  showResult(`Undone: ${record.summary}`);
}

function formChange() {
  return makeChange({
    criteria: criteria(),
    commands: el('commands-xml').value,
    position: el('position').value,
    skipExisting: el('skip-existing').checked,
  });
}

function fillForm(change) {
  selectedCommands = new Set(change.criteria.commandIds);
  selectedContentTypes = new Set(change.criteria.contentTypes);
  el('inserted-text').value = change.criteria.insertedText;
  el('caption-pattern').value = change.criteria.caption;
  el('include-grids').value = change.criteria.includeGrids;
  el('exclude-grids').value = change.criteria.excludeGrids;
  // Selection-only presets keep whatever commands the user has already pasted.
  if (change.commands) el('commands-xml').value = change.commands;
  el('position').value = change.position;
  el('skip-existing').checked = change.skipExisting;
  renderLists();
}

function useSchema(schema) {
  loadedSchema = schema;
  el('schema-name').textContent = schema.name;
  el('schema-description').textContent = schema.description;
  el('schema-description').hidden = !schema.description;
  el('schema-changes').replaceChildren(...schema.changes.map((change, i) => {
    const item = node('li', describeChange(change) + ' ');
    const edit = node('button', 'Load into form', 'btn');
    edit.addEventListener('click', () => fillForm(schema.changes[i]));
    item.append(edit);
    return item;
  }));
  el('schema-apply-all').hidden = !schema.ready;
  el('schema-panel').hidden = false;
  const loadedOption = el('schema-save-source').querySelector('[value="loaded"]');
  loadedOption.disabled = false;
  loadedOption.textContent = `Loaded schema(s): ${schema.name} (${schema.changes.length})`;
  if (schema.changes.length === 1) fillForm(schema.changes[0]);
}

function applySchema() {
  clearError();
  if (!loadedSchema?.ready) return;
  const summaries = [];
  try {
    for (const change of loadedSchema.changes) summaries.push(applyChange(change).summary);
  } catch (error) {
    showError(error);
  }
  showResult(`${loadedSchema.name}: ${summaries.join(' ')}`);
}

async function openSchemaFiles(files) {
  clearError();
  try {
    const schemas = [];
    for (const file of files) {
      try {
        schemas.push(readSchema(await file.text()));
      } catch (error) {
        throw new Error(`${file.name}: ${error.message}`);
      }
    }
    useSchema(combineSchemas(schemas));
  } catch (error) {
    showError(error);
  }
}

function saveSchema() {
  clearError();
  const status = el('schema-save-status');
  try {
    const source = el('schema-save-source').value;
    let changes = [formChange()];
    if (source === 'history') changes = history.map((record) => record.change);
    if (source === 'loaded') {
      if (!loadedSchema) throw new Error('No change schema is loaded.');
      changes = loadedSchema.changes;
    }
    if (!changes.length) throw new Error('No changes have been applied yet. Apply a change or save the current form settings instead.');
    const name = el('schema-save-name').value.trim() || (source === 'loaded' ? loadedSchema.name : '');
    const description = el('schema-save-description').value.trim() || (source === 'loaded' ? loadedSchema.description : '');
    const schema = makeSchema(name, changes, description);
    readSchema(schema);
    const blob = new Blob([JSON.stringify(schema, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = schemaFileName(schema);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent = `Saved "${schema.name}" with ${changes.length} change(s) as ${link.download}.`;
  } catch (error) {
    status.textContent = '';
    showError(error);
  }
}

function clearCriteria() {
  selectedCommands = new Set();
  selectedContentTypes = new Set();
  for (const id of ['inserted-text', 'caption-pattern', 'include-grids', 'exclude-grids']) el(id).value = '';
  renderLists();
}

async function validate(contexts) {
  const { GridsetValidator } = await import(VALIDATOR_URL);
  const messages = [];
  for (const context of contexts) {
    const bytes = new Uint8Array(await (await buildModifiedBlob(context)).arrayBuffer());
    const result = await new GridsetValidator().validate(bytes, `${context.name}.gridset`, bytes.length);
    messages.push({
      text: `${context.name}: structural validation ${result.valid ? 'passed' : 'reported errors'} (${result.warnings} warnings, ${result.errors} errors).`,
      className: result.valid ? 'v-ok' : 'v-bad',
    });
    for (const check of result.results || []) {
      if (check.error) messages.push({ text: `${check.description}: ${check.error}` });
      for (const warning of check.warnings || []) messages.push({ text: `${check.description}: ${warning}` });
    }
  }
  return messages;
}

async function download() {
  const button = el('download');
  button.disabled = true;
  const status = el('verify-status');
  try {
    const blob = fileState.isUserFile
      ? await buildModifiedUserBlob(fileState.outerZip, fileState.contexts)
      : await buildModifiedBlob(fileState.contexts[0]);
    const filename = fileState.fileName.replace(/\.(gridset|grid3user)$/i, '') +
      (fileState.isUserFile ? '-cells.grid3user' : '-cells.gridset');
    status.textContent = 'Verifying…';
    try {
      const messages = await validate(fileState.contexts.filter((context) => context.dirtyDocs.size));
      status.replaceChildren(...messages.map(({ text, className }) => node('p', text, className)));
    } catch (error) {
      console.error('Validator unavailable:', error);
      status.replaceChildren(node('p', `Could not run the validator (${error.message}). Downloading anyway.`, 'v-warn'));
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (error) {
    showError(error);
  } finally {
    renderHistory();
  }
}

el('command-filter').addEventListener('input', renderLists);
for (const id of ['inserted-text', 'caption-pattern', 'include-grids', 'exclude-grids', 'commands-xml']) {
  el(id).addEventListener('input', renderPreview);
}
el('clear-criteria').addEventListener('click', clearCriteria);
el('open-schema').addEventListener('click', (event) => {
  event.preventDefault();
  el('schema-input').click();
});
el('schema-input').addEventListener('change', () => {
  const files = Array.from(el('schema-input').files);
  el('schema-input').value = '';
  if (files.length) openSchemaFiles(files);
});
for (const [i, schema] of BUILT_IN_SCHEMAS.entries()) {
  const option = node('option', schema.name);
  option.value = String(i);
  el('schema-presets').append(option);
}
el('schema-presets').addEventListener('change', () => {
  const index = el('schema-presets').value;
  el('schema-presets').value = '';
  if (index !== '') useSchema(readSchema(BUILT_IN_SCHEMAS[Number(index)]));
});
el('schema-apply-all').addEventListener('click', applySchema);
el('schema-close').addEventListener('click', () => {
  loadedSchema = null;
  el('schema-panel').hidden = true;
  const loadedOption = el('schema-save-source').querySelector('[value="loaded"]');
  loadedOption.disabled = true;
  loadedOption.textContent = 'Loaded schema(s)';
  if (el('schema-save-source').value === 'loaded') el('schema-save-source').value = 'form';
});
el('schema-save').addEventListener('click', saveSchema);
el('apply').addEventListener('click', apply);
el('undo').addEventListener('click', undo);
el('download').addEventListener('click', download);
el('restart').addEventListener('click', () => {
  fileState = null;
  el('file-input').value = '';
  el('editor-section').hidden = true;
  el('upload-section').hidden = false;
});

const drop = el('drop-zone');
const input = el('file-input');
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    input.click();
  }
});
input.addEventListener('change', () => { if (input.files.length) loadFile(input.files[0]); });
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.toggle('dragover', type === 'dragenter' || type === 'dragover');
    if (type === 'drop' && event.dataTransfer.files.length) loadFile(event.dataTransfer.files[0]);
  });
}
el('upload-section').setAttribute('aria-busy', 'false');
