const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
// Grid 3 writes these Content children before <Commands>; everything else comes after it.
const BEFORE_COMMANDS = new Set(['ContentType', 'ContentSubType', 'ContentSubSubType', 'Parameters']);
const TEXT_COMMANDS = new Set(['Action.Letter', 'Action.Punctuation', 'Action.InsertText', 'Action.Space']);

function childrenNamed(parent, name) {
  return parent ? Array.from(parent.children).filter((child) => child.localName === name) : [];
}

function firstChild(parent, name) {
  return childrenNamed(parent, name)[0] || null;
}

export function gridName(path) {
  return /^Grids\/(.+)\/grid\.xml$/i.exec(path)?.[1] || path;
}

function commandText(command) {
  const id = command.getAttribute('ID');
  if (id === 'Action.Space') return ' ';
  const params = childrenNamed(command, 'Parameter');
  const param = params.find((p) => ['letter', 'text'].includes(p.getAttribute('Key'))) || null;
  if (!param) return '';
  // InsertText stores rich text as <p><s><r>text</r></s></p>; only <r> runs are inserted.
  const runs = param.getElementsByTagName('r');
  return runs.length ? Array.from(runs, (r) => r.textContent).join('') : param.textContent;
}

export function contentTypeKey(type, subType) {
  return subType ? `${type || ''}/${subType}` : type || '';
}

function autoContentCollection(doc, type) {
  const container = firstChild(doc.documentElement, 'AutoContentCommands');
  return childrenNamed(container, 'AutoContentCommandCollection')
    .find((collection) => collection.getAttribute('AutoContentType') === type) || null;
}

export function inventoryCells(context) {
  const cells = [];
  for (const [path, doc] of context.gridDocs) {
    const cellsEl = firstChild(doc.documentElement, 'Cells');
    for (const cell of childrenNamed(cellsEl, 'Cell')) {
      const content = firstChild(cell, 'Content');
      if (!content) continue;
      const type = firstChild(content, 'ContentType')?.textContent;
      const subType = firstChild(content, 'ContentSubType')?.textContent;
      // Grid 3 ignores <Commands> inside auto-content cells; they run the grid's shared
      // AutoContentCommandCollection for their type instead.
      const autoContentType = type === 'AutoContent' && subType ? subType : null;
      const source = autoContentType
        ? autoContentCollection(doc, autoContentType)
        : content;
      const commands = childrenNamed(firstChild(source, 'Commands'), 'Command');
      cells.push({
        context, path, doc, cell, content, autoContentType,
        grid: gridName(path),
        x: Number(cell.getAttribute('X') || 0),
        y: Number(cell.getAttribute('Y') || 0),
        caption: firstChild(firstChild(content, 'CaptionAndImage'), 'Caption')?.textContent || '',
        commandIds: commands.map((command) => command.getAttribute('ID') || ''),
        contentType: contentTypeKey(type, subType),
        insertedTexts: commands
          .filter((command) => TEXT_COMMANDS.has(command.getAttribute('ID')))
          .map(commandText)
          .filter((text) => text !== ''),
      });
    }
  }
  return cells;
}

export function summariseCells(cells) {
  const commandIds = new Map();
  const contentTypes = new Map();
  for (const cell of cells) {
    for (const id of new Set(cell.commandIds)) commandIds.set(id, (commandIds.get(id) || 0) + 1);
    if (cell.contentType) contentTypes.set(cell.contentType, (contentTypes.get(cell.contentType) || 0) + 1);
  }
  const sorted = (map) => Array.from(map, ([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { commandIds: sorted(commandIds), contentTypes: sorted(contentTypes) };
}

export function compilePattern(source, label) {
  if (!source || !source.trim()) return null;
  try {
    return new RegExp(source, 'iu');
  } catch (error) {
    throw new Error(`${label} is not a valid regular expression: ${error.message}`);
  }
}

/**
 * criteria: { commandIds, contentTypes, insertedText, caption, includeGrids, excludeGrids }
 * A cell matches when it meets ANY chosen cell criterion and passes the grid filters.
 */
export function compileCriteria(criteria) {
  return {
    commandIds: new Set(criteria.commandIds || []),
    contentTypes: new Set(criteria.contentTypes || []),
    insertedText: compilePattern(criteria.insertedText, 'Inserted text pattern'),
    caption: compilePattern(criteria.caption, 'Caption pattern'),
    includeGrids: compilePattern(criteria.includeGrids, 'Include grids pattern'),
    excludeGrids: compilePattern(criteria.excludeGrids, 'Exclude grids pattern'),
  };
}

export function hasCellCriteria(compiled) {
  return Boolean(compiled.commandIds.size || compiled.contentTypes.size ||
    compiled.insertedText || compiled.caption);
}

export function matchReasons(cell, compiled) {
  if (compiled.includeGrids && !compiled.includeGrids.test(cell.grid)) return [];
  if (compiled.excludeGrids && compiled.excludeGrids.test(cell.grid)) return [];
  const reasons = [];
  for (const id of new Set(cell.commandIds)) {
    if (compiled.commandIds.has(id)) reasons.push(`command ${id}`);
  }
  if (compiled.contentTypes.has(cell.contentType)) reasons.push(`content ${cell.contentType}`);
  if (compiled.insertedText) {
    const text = cell.insertedTexts.find((value) => compiled.insertedText.test(value));
    if (text !== undefined) reasons.push(`inserts ${JSON.stringify(text)}`);
  }
  if (compiled.caption && compiled.caption.test(cell.caption)) reasons.push('caption');
  return reasons;
}

export function findMatches(cells, criteria) {
  const compiled = compileCriteria(criteria);
  if (!hasCellCriteria(compiled)) return [];
  const matches = [];
  for (const cell of cells) {
    const reasons = matchReasons(cell, compiled);
    if (reasons.length) matches.push({ ...cell, reasons });
  }
  return matches;
}

export function parseCommandsXml(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>/, '').trim();
  if (!source) throw new Error('Paste one or more <Command> elements to add.');
  const wrapped = /^<Commands[\s>]/.test(source)
    ? source.replace(/^<Commands(?![^>]*xmlns:xsi)/, `<Commands xmlns:xsi="${XSI_NS}"`)
    : `<Commands xmlns:xsi="${XSI_NS}">${source}</Commands>`;
  const doc = new DOMParser().parseFromString(wrapped, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  if (error) throw new Error(`The commands XML is not well-formed: ${error.textContent.trim().split('\n')[0]}`);
  const commands = Array.from(doc.documentElement.children);
  if (!commands.length) throw new Error('No <Command> elements were found.');
  for (const command of commands) {
    if (command.localName !== 'Command') {
      throw new Error(`Only <Command> elements can be added (found <${command.localName}>).`);
    }
    if (!command.getAttribute('ID')) throw new Error('Every <Command> needs an ID attribute.');
  }
  return commands;
}

function commandSignature(command) {
  const params = childrenNamed(command, 'Parameter')
    .map((param) => [param.getAttribute('Key') || '', param.textContent.trim()])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([command.getAttribute('ID'), params]);
}

function ensureCommandsElement(content, created) {
  const existing = firstChild(content, 'Commands');
  if (existing) {
    if (existing.getAttributeNS(XSI_NS, 'nil') === 'true') existing.removeAttributeNS(XSI_NS, 'nil');
    return existing;
  }
  const element = content.ownerDocument.createElementNS(content.namespaceURI, 'Commands');
  const before = Array.from(content.children).find((child) => !BEFORE_COMMANDS.has(child.localName));
  content.insertBefore(element, before || null);
  created.push(element);
  return element;
}

function createChild(parent, name, before = null) {
  const element = parent.ownerDocument.createElementNS(parent.namespaceURI, name);
  parent.insertBefore(element, before);
  return element;
}

// Mirrors what Grid 3 writes for each auto-content type used in a grid.
function ensureAutoContentCommands(doc, type, created) {
  const root = doc.documentElement;
  let container = firstChild(root, 'AutoContentCommands');
  if (!container) {
    container = createChild(root, 'AutoContentCommands', firstChild(root, 'Cells'));
    created.push(container);
  }
  let collection = autoContentCollection(doc, type);
  if (!collection) {
    collection = createChild(container, 'AutoContentCommandCollection');
    collection.setAttribute('AutoContentType', type);
    const activate = createChild(createChild(collection, 'Commands'), 'Command');
    activate.setAttribute('ID', 'AutoContent.Activate');
    const param = createChild(activate, 'Parameter');
    param.setAttribute('Key', 'autocontenttype');
    param.textContent = type;
    if (!created.includes(container)) created.push(collection);
  }
  return ensureCommandsElement(collection, created);
}

function commandTargets(matches) {
  const targets = new Map();
  for (const match of matches) {
    const key = match.autoContentType ? `${match.context.id}\n${match.path}\n${match.autoContentType}` : match.cell;
    if (!targets.has(key)) targets.set(key, { match, cells: 0, shared: Boolean(match.autoContentType) });
    targets.get(key).cells++;
  }
  return [...targets.values()];
}

function existingCommands(match) {
  const source = match.autoContentType ? autoContentCollection(match.doc, match.autoContentType) : match.content;
  return childrenNamed(firstChild(source, 'Commands'), 'Command');
}

/**
 * Adds copies of `commands` to every matched cell. Auto-content cells share their grid's
 * command collection for that type, which is changed once per grid.
 * options: { position: 'end' | 'start', skipExisting: boolean }
 * Returns an undo record; pass it to undoAddCommands to revert.
 */
export function addCommands(matches, commands, options = {}) {
  const position = options.position === 'start' ? 'start' : 'end';
  const skipExisting = options.skipExisting !== false;
  const signatures = commands.map(commandSignature);
  const record = {
    inserted: [], createdContainers: [], newlyDirty: [],
    cellsChanged: 0, cellsSkipped: 0, sharedChanged: 0,
  };
  for (const { match, cells, shared } of commandTargets(matches)) {
    const existing = new Set(existingCommands(match).map(commandSignature));
    const toAdd = commands.filter((_, i) => !(skipExisting && existing.has(signatures[i])));
    if (!toAdd.length) {
      record.cellsSkipped += cells;
      continue;
    }
    const element = shared
      ? ensureAutoContentCommands(match.doc, match.autoContentType, record.createdContainers)
      : ensureCommandsElement(match.content, record.createdContainers);
    const anchor = position === 'start' ? element.firstChild : null;
    for (const command of toAdd) {
      const node = match.doc.importNode(command, true);
      element.insertBefore(node, anchor);
      record.inserted.push(node);
    }
    record.cellsChanged += cells;
    if (shared) record.sharedChanged++;
    const dirty = match.context.dirtyDocs;
    if (!dirty.has(match.doc)) {
      dirty.add(match.doc);
      record.newlyDirty.push({ dirty, doc: match.doc });
    }
  }
  return record;
}

export function undoAddCommands(record) {
  for (const node of record.inserted) node.remove();
  for (const element of [...record.createdContainers].reverse()) element.remove();
  for (const { dirty, doc } of record.newlyDirty) dirty.delete(doc);
}
