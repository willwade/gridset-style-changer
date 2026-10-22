import { openStyleFile, buildModifiedBlob, buildModifiedUserBlob } from './archives.js';
import {
  analyseStyles, applyConsolidation, captureStyleBaseline, verifyStyleBaseline,
} from './consolidation.js';

const el = (id) => document.getElementById(id);
const steps = [
  {
    title: '1. Baseline and roles',
    description: 'Review usage and names. Decide which styles represent the same purpose before merging anything. Keyboard, prediction, history, vocabulary categories and navigation may need independent editing even when they look alike.',
    warning: 'No automatic role inference or visual redesign. Default, conventional special-purpose names and keys mentioned elsewhere in XML are protected from removal.',
  },
  {
    title: '2. Restore inheritance',
    description: 'First review exact inherited-value matches. Separately review text formatting on static empty cells and local overrides on cells geometrically contained by a spanning cell. All groups start unchecked.',
    warning: 'Exact matches preserve effective values but remove future pins. Empty/covered-cell cleanup changes effective properties: text may appear later, and overlapping cells may not actually be hidden in Grid 3. Backgrounds and borders on empty cells are not assumed irrelevant. Review locations and confirm visibility before choosing those groups.',
  },
  {
    title: '3. Name repeated variants',
    description: 'These cells repeat the same base and local formatting. Give meaningful recurring variations a role-based name, such as "Prediction - small text". Each selected group becomes one new named style.',
    warning: 'Variants flatten explicit base properties without introducing named-to-named inheritance. They remain independent of later edits to the old named base; missing values still inherit Default. Only promote deliberate variants. Restore inheritance first to avoid unnecessary variants.',
  },
  {
    title: '4. Review equivalent styles',
    description: 'These styles resolve to the same stored property values through Default and explicit bases. Choose a retained style only when the whole group should share future edits; otherwise leave the group separate.',
    warning: 'Names can encode different roles. Merging links future edits and may remove explicit pins even when current values match. No built-in defaults, theme fonts or similar colours are guessed.',
  },
  {
    title: '5. Prune unused definitions',
    description: 'Review styles with no explicit references in any gridset XML. Default, conventional special-purpose names and other key mentions are protected and cannot be removed here.',
    warning: 'No explicit references is not proof of no implicit use in Grid 3. Delete only definitions you recognise as obsolete. Protected definitions are shown for information.',
  },
  {
    title: '6. Verify and export',
    description: 'Review your decisions, then save the result. All gridsets are checked against their original baselines, including cells without an explicit Style. Unreviewed gridsets remain unchanged.',
    warning: 'Property equivalence is not a rendering guarantee. Check transparency, grid backgrounds, ThemeFont, workspaces and auto-content in Grid 3 before distributing.',
  },
];
let fileState = null;
let activeId = null;
let step = 0;
let baselines = new Map();
let history = [];
let log = [];
let selections = [];
let busy = false;
const analyses = new WeakMap();

function analysisFor(context) {
  if (!analyses.has(context)) analyses.set(context, analyseStyles(context));
  return analyses.get(context);
}

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function errorMessage(error) {
  console.error('Consolidation:', error);
  el('consolidation-error').textContent = error.message || String(error);
  el('consolidation-error').hidden = false;
}

function clearError() {
  el('consolidation-error').hidden = true;
}

function active() {
  return fileState.contexts.find((context) => context.id === activeId);
}

async function structuralChecks(contexts) {
  const { GridsetValidator } = await import(
    'https://esm.sh/@willwade/aac-processors@0.3.7/dist/browser/validation/gridsetValidator.js'
  );
  const messages = [];
  for (const context of contexts) {
    const bytes = new Uint8Array(await (await buildModifiedBlob(context)).arrayBuffer());
    const result = await new GridsetValidator().validate(bytes, 'reviewed.gridset', bytes.length);
    messages.push(`${context.name}: structural validation ${result.valid ? 'passed' : 'reported errors'} (${result.warnings} warnings, ${result.errors} errors).`);
    for (const check of result.results || []) {
      if (check.error) messages.push(`${check.description}: ${check.error}`);
      for (const warning of check.warnings || []) messages.push(`${check.description}: ${warning}`);
    }
  }
  return messages;
}

function propertyText(props) {
  return Object.entries(props).map(([key, value]) => `${key}: ${value}`).join('; ');
}

function usageDetails(items) {
  const details = node('details');
  details.append(node('summary', `Affected locations (${items.length}; showing up to 20)`));
  const list = node('ul');
  for (const item of items.slice(0, 20)) list.append(node('li', item.location));
  details.append(list);
  return details;
}

function updateApply() {
  el('apply').disabled = busy || !selections.some(({ input }) => input.checked);
}

function selectAllGroup(text) {
  const element = node('label', undefined, 'consolidation-select-all');
  const input = document.createElement('input');
  input.type = 'checkbox';
  element.append(input, node('span', text));
  const group = { element, input, members: [], firstCard: null };
  group.sync = () => {
    const checked = group.members.filter((member) => member.checked).length;
    input.checked = checked > 0 && checked === group.members.length;
    input.indeterminate = checked > 0 && checked < group.members.length;
  };
  input.addEventListener('change', () => {
    for (const member of group.members) member.checked = input.checked;
    input.indeterminate = false;
    updateApply();
  });
  return group;
}

function choice(title, description, action, extra = null, details = null, group = null) {
  const card = node('article', undefined, 'fix-card consolidation-choice');
  const label = node('label', undefined, 'consolidation-choice-label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  label.append(input, node('strong', title));
  card.append(label, node('p', description, 'hint'));
  if (extra) card.append(extra);
  if (details) card.append(details);
  const selection = { input, action, title };
  selections.push(selection);
  if (group) {
    group.members.push(input);
    if (group.members.length === 1) group.firstCard = card;
    // Earlier cards are already in the DOM; only offer the control for real lists.
    if (group.members.length === 2) group.firstCard.before(group.element);
  }
  input.addEventListener('change', () => {
    group?.sync();
    updateApply();
  });
  return card;
}

function inventory(analysis) {
  const details = node('details');
  details.append(node('summary', `Named-style inventory (${analysis.styles.length})`));
  const wrap = node('div', undefined, 'table-scroll');
  const table = node('table', undefined, 'consolidation-table');
  const heading = node('tr');
  for (const text of ['Key / role name', 'Explicit references', 'Protection']) heading.append(node('th', text));
  const head = node('thead');
  head.append(heading);
  table.append(head);
  const body = node('tbody');
  for (const style of analysis.styles) {
    const row = node('tr');
    const label = node('td');
    label.append(node('strong', style.name), node('div', style.key, 'cards-hint'));
    const props = node('details');
    props.append(node('summary', 'Stored properties'), node('p', propertyText(style.props)));
    label.append(props);
    row.append(label, node('td', style.references), node('td', style.protected ? 'Protected' : 'Reviewable'));
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  details.append(wrap);
  return details;
}

function render() {
  clearError();
  selections = [];
  const context = active();
  const analysis = analysisFor(context);
  const blocked = analysis.issues.length > 0;
  el('stats').replaceChildren();
  for (const [label, value] of [
    ['Grids', analysis.stats.grids], ['Cells', analysis.stats.cells],
    ['Named styles', analysis.stats.named], ['Locally styled cells', analysis.stats.overrideCells],
    ['Local properties', analysis.stats.assignments], ['Matching inherited properties', analysis.stats.redundantAssignments],
  ]) el('stats').append(node('span', `${label}: ${value.toLocaleString()}`));
  el('steps').replaceChildren();
  steps.forEach(({ title }, index) => {
    const item = node('li');
    const button = node('button', title, 'btn');
    button.type = 'button';
    if (index === step) button.setAttribute('aria-current', 'step');
    button.disabled = busy;
    button.addEventListener('click', () => navigate(index));
    item.append(button);
    el('steps').append(item);
  });
  el('step-title').textContent = steps[step].title;
  el('step-description').textContent = steps[step].description;
  el('step-warning').textContent = steps[step].warning;
  const content = el('step-content');
  content.replaceChildren();
  if (blocked) {
    content.append(node('p', 'This gridset cannot be consolidated safely:', 'error'));
    const list = node('ul');
    for (const issue of analysis.issues) list.append(node('li', issue));
    content.append(list);
  } else if (step === 0) {
    content.append(node('p', 'Start with a baseline, restore redundant inheritance, name genuine variants, merge only shared roles, then prune last. You can skip any step or revisit it. All choices start unchecked.'));
    content.append(inventory(analysis));
  } else if (step === 1) {
    content.append(node('h3', 'Exact matches: restore inheritance'));
    const exactGroup = selectAllGroup('Select all exact matches');
    for (const entry of analysis.redundant) {
      content.append(choice(`${entry.items.length} cells based on ${entry.base}`,
        `Restore inheritance for ${propertyText(entry.props)}`,
        () => ({ type: 'restore', id: entry.id }), null, usageDetails(entry.items), exactGroup));
    }
    content.append(node('h3', 'Appearance-dependent cleanup: explicit review required'));
    content.append(node('p', 'Only local overrides are removed; named base references, cells, commands and content remain. Default-based overrides are included. A bare reference to Default is not a pointless override.'));
    const reviewGroup = selectAllGroup('Select all appearance-dependent cleanup (acknowledges the risks of every group below)');
    for (const entry of analysis.irrelevant) {
      const empty = entry.reason === 'empty-text';
      content.append(choice(
        `${empty ? 'Static empty: text formatting' : 'Potentially covered: local formatting'} - ${entry.items.length} cells based on ${entry.base}`,
        `${propertyText(entry.props)}. ${empty
          ? 'No recognised content or commands were found. Confirm these cells will stay empty; background, tile, border and shape overrides are retained.'
          : 'The whole cell rectangle lies inside another spanning cell with a different origin. This does not prove rendering order, opacity or invisibility. Confirm in Grid 3; formatting may matter if uncovered.'} Checking this group acknowledges these risks.`,
        () => ({ type: 'irrelevant', id: entry.id, confirm: true }), null,
        usageDetails(entry.items.map((item) => ({
          ...item, location: `${item.location}${item.coveredBy ? `; contained by ${item.coveredBy}` : ''}`,
        }))), reviewGroup
      ));
    }
  } else if (step === 2) {
    const group = selectAllGroup('Select all variants');
    analysis.variants.forEach((entry, index) => {
      const label = node('label', 'New role / variant name');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = `${entry.suggestedName} ${index + 1}`;
      label.append(input);
      content.append(choice(`${entry.items.length} cells based on ${entry.base}`,
        propertyText(entry.props),
        () => ({ type: 'variant', id: entry.id, name: input.value }), label, usageDetails(entry.items), group));
    });
  } else if (step === 3) {
    const group = selectAllGroup('Select all merge groups');
    for (const entry of analysis.duplicates) {
      const label = node('label', 'Retain as canonical style');
      const select = document.createElement('select');
      for (const style of entry.items) {
        const option = node('option', `${style.name} [${style.key}] - ${style.references} references`);
        option.value = style.key;
        select.append(option);
      }
      if (entry.items.some((style) => style.key === 'Default')) {
        select.value = 'Default';
        select.disabled = true;
      }
      label.append(select);
      const details = node('details');
      details.append(node('summary', 'Compare definitions and explicit pins'));
      for (const style of entry.items) details.append(node('p', `${style.name}: ${propertyText(style.props)}`));
      content.append(choice(entry.items.map((style) => style.name).join(' / '),
        'Merge this entire group only if its roles should share future editing.',
        () => ({ type: 'merge', id: entry.id, target: select.value }), label, details, group));
    }
  } else if (step === 4) {
    const group = selectAllGroup('Select all unprotected unused styles');
    for (const style of analysis.unused) {
      if (style.protected) {
        content.append(node('p', `Protected, not selected for pruning: ${style.name} [${style.key}]`, 'cards-hint'));
      } else {
        content.append(choice(`${style.name} [${style.key}]`,
          'No explicit references found. Confirm that this definition is obsolete, including any implicit use.',
          () => ({ type: 'prune', key: style.key }), null, null, group));
      }
    }
  } else {
    content.append(node('p', `${log.length} decisions applied across this file. Review the session log below. Undo is available until you start another file.`));
    content.append(inventory(analysis));
  }
  if (step > 0 && step < 5 && !selections.length && !blocked) {
    content.append(node('p', 'No selectable suggestions at this step. Keep the remaining styles and continue.'));
  }
  el('apply').hidden = step === 0 || step === 5 || blocked;
  el('apply').disabled = true;
  el('back').disabled = step === 0 || busy;
  el('next').hidden = step === 5;
  el('next').disabled = busy;
  el('undo').disabled = busy || !history.length;
  el('context-picker').disabled = busy;
  el('restart').disabled = busy;
  el('export-section').hidden = step !== 5;
  el('download').disabled = busy || fileState.contexts.some((context) => analysisFor(context).issues.length);
  el('decision-count').textContent = `(${log.length})`;
  el('decision-log').replaceChildren(...log.map((entry) => node('li', entry)));
  el('export-status').replaceChildren();
}

function navigate(index) {
  if (selections.some(({ input }) => input.checked) &&
    !window.confirm('Leave this step without applying the checked choices?')) return;
  step = index;
  render();
  el('step-title').focus();
}

async function loadFile(file) {
  if (busy) return;
  busy = true;
  clearError();
  el('consolidation-status').textContent = 'Opening archive and checking all gridset XML...';
  try {
    const opened = await openStyleFile(file, true);
    const captured = new Map();
    for (const context of opened.contexts) {
      if (!analysisFor(context).issues.length) captured.set(context.id, captureStyleBaseline(context));
    }
    fileState = opened;
    baselines = captured;
    activeId = opened.contexts[0].id;
    history = [];
    log = [];
    step = 0;
    el('context-picker').replaceChildren(...opened.contexts.map((context) => {
      const option = node('option', context.name);
      option.value = context.id;
      return option;
    }));
    el('file-name').textContent = file.name;
    el('upload-section').hidden = true;
    el('wizard').hidden = false;
    el('consolidation-status').textContent = 'Original baseline captured. No changes have been made.';
  } catch (error) {
    errorMessage(error);
    el('consolidation-status').textContent = 'File could not be opened.';
  } finally {
    busy = false;
    if (fileState) render();
  }
}

el('apply').addEventListener('click', async () => {
  if (busy) return;
  clearError();
  const chosen = selections.filter(({ input }) => input.checked).map(({ title, action }) => ({
    title, action: action(),
  }));
  busy = true;
  render();
  el('consolidation-status').textContent = 'Applying decisions and checking every grid. Large gridsets may take a moment...';
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    const context = active();
    const next = applyConsolidation(context, chosen.map(({ action }) => action));
    verifyStyleBaseline(next, baselines.get(context.id));
    history.push({ id: context.id, context, logLength: log.length });
    fileState.contexts[fileState.contexts.indexOf(context)] = next;
    log.push(...chosen.map(({ title, action }) => {
      const decision = action.name ? `; new variant: ${action.name}` :
        action.target ? `; retained key: ${action.target}` :
          action.type === 'restore' ? `; properties: ${action.id}` : '';
      return `${context.name}: ${steps[step].title} - ${title}${decision}`;
    }));
    busy = false;
    render();
    el('consolidation-status').textContent = `Applied ${chosen.length} decisions. Non-style content is unchanged; effective-property checks passed, allowing only explicitly approved empty/covered-cell property changes.`;
  } catch (error) {
    busy = false;
    render();
    errorMessage(error);
    el('consolidation-status').textContent = 'No changes applied. Review the error and try again.';
  }
});

el('undo').addEventListener('click', () => {
  const previous = history.pop();
  fileState.contexts[fileState.contexts.findIndex((context) => context.id === previous.id)] = previous.context;
  log.length = previous.logLength;
  activeId = previous.id;
  el('context-picker').value = activeId;
  render();
  el('consolidation-status').textContent = 'Last application undone.';
});
el('context-picker').addEventListener('change', (event) => {
  if (selections.some(({ input }) => input.checked) &&
    !window.confirm('Switch gridset without applying the checked choices?')) {
    event.target.value = activeId;
    return;
  }
  activeId = event.target.value;
  step = 0;
  render();
});
el('back').addEventListener('click', () => navigate(step - 1));
el('next').addEventListener('click', () => navigate(step + 1));
el('restart').addEventListener('click', () => {
  if (!window.confirm('Discard this session and choose another file?')) return;
  fileState = null;
  baselines.clear();
  history = [];
  log = [];
  el('file-input').value = '';
  el('wizard').hidden = true;
  el('upload-section').hidden = false;
  el('consolidation-status').textContent = '';
  clearError();
});

el('download').addEventListener('click', async () => {
  busy = true;
  render();
  el('export-status').textContent = 'Checking all effective cell properties and serialised output...';
  try {
    for (const context of fileState.contexts) verifyStyleBaseline(context, baselines.get(context.id));
    const blob = fileState.isUserFile
      ? await buildModifiedUserBlob(fileState.outerZip, fileState.contexts)
      : await buildModifiedBlob(active());
    const filename = fileState.fileName.replace(/\.(gridset|grid3user)$/i, '') +
      (fileState.isUserFile ? '-consolidated.grid3user' : '-consolidated.gridset');
    const reopened = await openStyleFile(new File([blob], filename), true);
    for (let i = 0; i < reopened.contexts.length; i++) {
      const original = fileState.contexts[i];
      verifyStyleBaseline(reopened.contexts[i], baselines.get(original.id), original.styleApprovals);
    }
    const messages = [];
    let validationTimer;
    el('export-status').textContent = 'Exported effective-property and content checks passed. Running additional structural validation (up to 30 seconds)...';
    try {
      messages.push(...await Promise.race([
        structuralChecks(reopened.contexts),
        new Promise((resolve, reject) => {
          validationTimer = setTimeout(() => reject(new Error('Structural validation timed out after 30 seconds')), 30000);
        }),
      ]));
    } catch (error) {
      console.error('Structural validation unavailable:', error);
      messages.push(`Structural validator could not run: ${error.message}. Effective-property and content checks passed; validation is incomplete.`);
    } finally {
      clearTimeout(validationTimer);
    }
    el('export-status').replaceChildren(
      node('p', 'Effective-property and non-style content checks passed for every gridset, including exported XML. Only explicitly approved empty/covered-cell property changes are allowed; verify those cells visually in Grid 3.', 'v-ok'),
      ...messages.map((message) => node('p', message))
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (error) {
    errorMessage(error);
    el('export-status').textContent = 'Verification failed. No file was downloaded.';
  } finally {
    busy = false;
    el('download').disabled = false;
    el('context-picker').disabled = false;
    el('restart').disabled = false;
    el('undo').disabled = !history.length;
    el('back').disabled = step === 0;
    for (const button of el('steps').querySelectorAll('button')) button.disabled = false;
  }
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
