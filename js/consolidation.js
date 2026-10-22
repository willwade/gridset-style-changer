// DOM-only engine: no UI, downloads, storage, network or Grid 3 preset defaults.
const META = new Set(['Name', 'BasedOnStyle']);
const signature = (props) => JSON.stringify(Object.entries(props).sort(([a], [b]) => a.localeCompare(b)));
const children = (node, name) => Array.from(node.children).filter((child) => child.localName === name);
const propsOf = (style) => Object.fromEntries(Array.from(style.children, (child) => [child.localName, child.textContent]));
const valuesOf = (props) => Object.fromEntries(Object.entries(props).filter(([key]) => !META.has(key)));
const namedStyles = (context) => Array.from(context.stylesDoc.getElementsByTagName('Style'));
const gridStyles = (doc) => Array.from(doc.getElementsByTagName('Style'));

export function isProtectedStyle(key) {
  return /^(default|workspace|auto content|auto content cell.*|vocab cell|keyboard key)$/i.test(key) ||
    /category style$/i.test(key);
}

function setProp(style, name, value) {
  let child = children(style, name)[0];
  if (!child) {
    child = style.ownerDocument.createElementNS(style.namespaceURI, name);
    style.appendChild(child);
  }
  child.textContent = value;
}

function group(map, key, create, item) {
  if (!map.has(key)) map.set(key, create());
  map.get(key).items.push(item);
}

const TEXT_PROPS = new Set(['FontName', 'FontSize', 'FontColour']);

function isStaticEmpty(cell) {
  const content = children(cell, 'Content')[0];
  if (!content || children(cell, 'Content').length !== 1 ||
    Array.from(cell.children).some((child) => child !== content)) return false;
  const allowed = new Set(['Content', 'CaptionAndImage', 'Caption', 'Image', 'AudioDescription', 'Commands', 'ContentType']);
  for (const element of [content, ...content.getElementsByTagName('*')]) {
    if (element.closest('Style')) continue;
    if (!allowed.has(element.localName)) return false;
    if (element.localName === 'ContentType') {
      if (!['', 'Normal'].includes(element.textContent.trim())) return false;
    } else if (Array.from(element.childNodes).some((child) =>
      child.nodeType === 3 && child.textContent.trim())) return false;
    if (Array.from(element.attributes).some((attr) =>
      !(attr.namespaceURI === 'http://www.w3.org/2001/XMLSchema-instance' &&
        attr.localName === 'nil' && ['true', '1'].includes(attr.value)))) return false;
  }
  return true;
}

function cellRect(cell) {
  const read = (name, fallback, min) => {
    const raw = cell.getAttribute(name);
    if (raw !== null && !/^\d+$/.test(raw)) return null;
    const value = raw === null ? fallback : Number(raw);
    return Number.isSafeInteger(value) && value >= min ? value : null;
  };
  const x = read('X', 0, 0), y = read('Y', 0, 0);
  const width = read('ColumnSpan', 1, 1), height = read('RowSpan', 1, 1);
  return [x, y, width, height].includes(null) ? null : { x, y, width, height };
}

function coveredCells(doc) {
  const cells = Array.from(doc.getElementsByTagName('Cell'));
  const spans = cells.map((cell) => ({ cell, rect: cellRect(cell) }))
    .filter(({ rect }) => rect && (rect.width > 1 || rect.height > 1));
  const covered = new Map();
  for (const cell of cells) {
    const r = cellRect(cell);
    if (!r) continue;
    const cover = spans.find(({ cell: other, rect: s }) =>
      other !== cell && (s.x !== r.x || s.y !== r.y) &&
      s.x <= r.x && s.y <= r.y && s.x + s.width >= r.x + r.width &&
      s.y + s.height >= r.y + r.height);
    if (cover) covered.set(cell, `spanning cell at X=${cover.rect.x}, Y=${cover.rect.y}, ${cover.rect.width} x ${cover.rect.height}`);
  }
  return covered;
}

function indexContext(context) {
  const named = new Map();
  const issues = [];
  const refs = new Map();
  const opaque = new Set();
  const records = [];
  for (const style of namedStyles(context)) {
    const key = style.getAttribute('Key');
    if (!key || named.has(key)) issues.push(`Missing or duplicate style key: ${key || '(empty)'}.`);
    else named.set(key, { key, style, props: propsOf(style) });
  }
  const allStyles = [...namedStyles(context)];
  for (const [path, doc] of context.gridDocs) {
    const covered = coveredCells(doc);
    for (const [styleIndex, style] of gridStyles(doc).entries()) {
      const props = propsOf(style);
      const cell = style.closest('Cell');
      if (!cell || style.parentElement?.localName !== 'Content') {
        issues.push(`${path}: unsupported Style location outside cell Content; keep this file unchanged.`);
      }
      records.push({
        style, props, path, styleIndex, cell,
        empty: cell ? isStaticEmpty(cell) : false,
        coveredBy: covered.get(cell),
        location: `${path}${cell ? ` (X=${cell.getAttribute('X')}, Y=${cell.getAttribute('Y')})` : ''}`,
        base: props.BasedOnStyle || 'Default',
      });
      allStyles.push(style);
    }
  }
  for (const style of allStyles) {
    const names = new Set();
    if (Array.from(style.childNodes).some((child) => child.nodeType === 3 && child.textContent.trim())) {
      issues.push('Unsupported text directly inside Style; automatic consolidation is blocked.');
    }
    for (const attr of style.attributes) {
      if (attr.name !== 'Key' && !attr.name.startsWith('xmlns')) {
        issues.push(`Unsupported style attribute ${attr.name}; keep this file unchanged.`);
      }
    }
    for (const child of style.children) {
      if (names.has(child.localName) || child.children.length || child.attributes.length ||
        child.namespaceURI !== style.namespaceURI) {
        issues.push(`Structured, attributed or repeated style property ${child.localName}; automatic consolidation is blocked.`);
      }
      names.add(child.localName);
    }
  }
  for (const [path, doc] of context.xmlDocs) {
    for (const element of doc.getElementsByTagName('*')) {
      if (element.localName === 'BasedOnStyle') {
        const key = element.textContent;
        if (!named.has(key)) issues.push(`${path}: missing BasedOnStyle "${key}".`);
        if (!refs.has(key)) refs.set(key, []);
        refs.get(key).push(element);
        if (doc !== context.stylesDoc && !context.gridDocs.has(path)) opaque.add(key);
      } else if (!element.children.length && element.localName !== 'Name' &&
        named.has(element.textContent)) {
        opaque.add(element.textContent);
      }
      for (const attr of element.attributes) {
        if (!(element.localName === 'Style' && attr.name === 'Key') && named.has(attr.value)) {
          opaque.add(attr.value);
        }
      }
    }
  }
  const cache = new Map();
  function resolve(key, trail = new Set()) {
    if (cache.has(key)) return cache.get(key);
    if (!named.has(key)) {
      if (key === 'Default') return {};
      throw new Error(`Missing style "${key}".`);
    }
    if (trail.has(key)) throw new Error(`Circular BasedOnStyle reference at "${key}".`);
    const next = new Set(trail).add(key);
    const props = named.get(key).props;
    const base = props.BasedOnStyle || (key === 'Default' ? null : 'Default');
    const result = { ...(base ? resolve(base, next) : {}), ...valuesOf(props) };
    cache.set(key, result);
    return result;
  }
  for (const key of named.keys()) {
    try { resolve(key); } catch (error) { issues.push(error.message); }
  }
  return { named, refs, opaque, records, resolve, issues: [...new Set(issues)] };
}

export function analyseStyles(context) {
  const index = indexContext(context);
  const { named, refs, opaque, records, resolve, issues } = index;
  const redundant = new Map();
  const variants = new Map();
  const duplicates = new Map();
  const irrelevant = new Map();
  let assignments = 0;
  let overrideCells = 0;
  const styles = Array.from(named.values(), ({ key, props }) => ({
    key, name: props.Name || key, references: (refs.get(key) || []).length,
    protected: isProtectedStyle(key) || opaque.has(key), props,
  }));
  if (!issues.length) {
    for (const record of records) {
      const local = valuesOf(record.props);
      const entries = Object.entries(local);
      const base = resolve(record.base);
      assignments += entries.length;
      if (!entries.length) continue;
      overrideCells++;
      const matching = Object.fromEntries(entries.filter(([key, value]) =>
        Object.hasOwn(base, key) && base[key] === value));
      if (Object.keys(matching).length) {
        const id = signature({ BasedOnStyle: record.base, ...matching });
        group(redundant, id, () => ({ id, base: record.base, props: matching, items: [] }), record);
      }
      const reason = record.coveredBy ? 'covered' : record.empty ? 'empty-text' : null;
      const removable = Object.fromEntries(entries.filter(([key]) =>
        !Object.hasOwn(matching, key) &&
        (reason === 'covered' || (reason === 'empty-text' && TEXT_PROPS.has(key)))));
      if (Object.keys(removable).length) {
        const id = signature({ reason, BasedOnStyle: record.base, ...removable });
        group(irrelevant, id, () => ({
          id, reason, base: record.base, props: removable, items: [],
        }), record);
      }
      const id = signature(record.props);
      group(variants, id, () => ({
        id, base: record.base, props: local, items: [],
        suggestedName: `${named.get(record.base)?.props.Name || record.base} - variant`,
      }), record);
    }
    for (const style of styles) {
      if (style.protected && style.key !== 'Default') continue;
      const id = signature(resolve(style.key));
      group(duplicates, id, () => ({ id, items: [] }), style);
    }
  }
  const unused = styles.filter((style) => !style.references && style.key !== 'Default');
  return {
    issues, styles, redundant: [...redundant.values()], irrelevant: [...irrelevant.values()],
    variants: [...variants.values()].filter((entry) => entry.items.length >= 2)
      .sort((a, b) => b.items.length - a.items.length),
    duplicates: [...duplicates.values()].filter((entry) => entry.items.length >= 2),
    unused,
    stats: {
      grids: context.gridDocs.size,
      cells: [...context.gridDocs.values()].reduce((n, doc) => n + doc.getElementsByTagName('Cell').length, 0),
      named: named.size, inline: records.length, overrideCells, assignments,
      redundantAssignments: [...redundant.values()].reduce((n, entry) => n + entry.items.length * Object.keys(entry.props).length, 0),
      unreferenced: unused.length,
    },
  };
}

function nonStyleXml(doc) {
  const clone = doc.cloneNode(true);
  for (const style of Array.from(clone.getElementsByTagName('Style'))) style.remove();
  return new XMLSerializer().serializeToString(clone);
}

export function captureStyleBaseline(context) {
  const index = indexContext(context);
  if (index.issues.length) throw new Error(index.issues.join('\n'));
  const grids = new Map();
  for (const [path, doc] of context.gridDocs) {
    const effective = gridStyles(doc).map((style) => {
      const props = propsOf(style);
      return signature({ ...index.resolve(props.BasedOnStyle || 'Default'), ...valuesOf(props) });
    });
    // Cells without a Style still depend on Default.
    const withoutStyle = Array.from(doc.getElementsByTagName('Cell')).filter((cell) =>
      !cell.getElementsByTagName('Style').length).length;
    grids.set(path, {
      effective, withoutStyle, cells: doc.getElementsByTagName('Cell').length,
      defaultProps: signature(index.resolve('Default')), content: nonStyleXml(doc),
    });
  }
  return {
    grids,
    named: new Map([...index.named.keys()].map((key) => [key, signature(index.resolve(key))])),
    otherXml: new Map([...context.xmlDocs].filter(([path, doc]) =>
      doc !== context.stylesDoc && !context.gridDocs.has(path)
    ).map(([path, doc]) => [path, new XMLSerializer().serializeToString(doc)])),
  };
}

export function verifyStyleBaseline(context, baseline, approvals = context.styleApprovals || new Map()) {
  const current = captureStyleBaseline(context);
  if (current.grids.size !== baseline.grids.size) throw new Error('Grid count changed.');
  for (const [path, before] of baseline.grids) {
    const after = current.grids.get(path);
    const effectiveMatch = after && before.effective.length === after.effective.length &&
      before.effective.every((value, i) => {
        const expected = new Map(JSON.parse(value));
        for (const [key, entry] of approvals.get(JSON.stringify([path, i])) || []) {
          if (entry.present) expected.set(key, entry.value);
          else expected.delete(key);
        }
        return signature(Object.fromEntries(expected)) === after.effective[i];
      });
    if (!effectiveMatch ||
      before.withoutStyle !== after.withoutStyle ||
      (before.withoutStyle && before.defaultProps !== after.defaultProps)) {
      throw new Error(`${path}: effective cell properties changed. Export blocked.`);
    }
    if (before.content !== after.content) throw new Error(`${path}: non-style content changed. Export blocked.`);
  }
  for (const [key, value] of baseline.named) {
    if (current.named.has(key) && current.named.get(key) !== value) {
      throw new Error(`Surviving named style "${key}" changed. Export blocked.`);
    }
  }
  for (const [path, xml] of baseline.otherXml) {
    if (current.otherXml.get(path) !== xml) throw new Error(`${path}: unrelated XML changed. Export blocked.`);
  }
  return {
    grids: current.grids.size,
    cells: [...current.grids.values()].reduce((count, grid) => count + grid.cells, 0),
  };
}

function cloneContext(context) {
  const xmlDocs = new Map([...context.xmlDocs].map(([path, doc]) => [path, doc.cloneNode(true)]));
  return {
    ...context, xmlDocs,
    styleApprovals: new Map([...(context.styleApprovals || [])].map(([key, values]) =>
      [key, new Map(values)])),
    stylesDoc: xmlDocs.get(context.stylesPath),
    gridDocs: new Map([...context.gridDocs.keys()].map((path) => [path, xmlDocs.get(path)])),
    dirtyDocs: new Set([...context.xmlDocs].filter(([, doc]) => context.dirtyDocs.has(doc))
      .map(([path]) => xmlDocs.get(path))),
  };
}

function requireEntry(entries, id) {
  const entry = entries.find((entry) => entry.id === id);
  if (!entry) throw new Error('This suggestion is no longer current. Review the refreshed analysis.');
  return entry;
}

export function applyConsolidation(context, actions) {
  if (!actions.length) throw new Error('Choose at least one change.');
  const baseline = captureStyleBaseline(context);
  const next = cloneContext(context);
  let analysis;
  let index;
  let previousType;
  const applied = new Set();
  const batchApprovals = new Map();
  for (const action of actions) {
    const token = `${action.type}:${action.id || action.key}`;
    if (applied.has(token)) throw new Error('The same suggestion cannot be applied twice.');
    applied.add(token);
    // Same-type property groups are disjoint; avoid rescanning every grid per choice.
    if (!analysis || action.type !== previousType || !['restore', 'variant', 'irrelevant'].includes(action.type)) {
      analysis = analyseStyles(next);
      index = indexContext(next);
    }
    previousType = action.type;
    if (analysis.issues.length) throw new Error(analysis.issues.join('\n'));
    const mark = (style) => next.dirtyDocs.add(style.ownerDocument);
    if (action.type === 'irrelevant') {
      if (action.confirm !== true) throw new Error('Explicit acknowledgement is required for appearance-dependent cleanup.');
      const entry = requireEntry(analysis.irrelevant, action.id);
      for (const record of entry.items) {
        const inherited = index.resolve(record.base);
        const recordKey = JSON.stringify([record.path, record.styleIndex]);
        if (!next.styleApprovals.has(recordKey)) next.styleApprovals.set(recordKey, new Map());
        if (!batchApprovals.has(recordKey)) batchApprovals.set(recordKey, new Map());
        for (const key of Object.keys(entry.props)) {
          const child = children(record.style, key)[0];
          if (!child) throw new Error('This cleanup suggestion is no longer current.');
          const expected = { present: Object.hasOwn(inherited, key), value: inherited[key] };
          next.styleApprovals.get(recordKey).set(key, expected);
          batchApprovals.get(recordKey).set(key, expected);
          child.remove();
        }
        mark(record.style);
      }
    } else if (action.type === 'restore') {
      const entry = requireEntry(analysis.redundant, action.id);
      for (const { style } of entry.items) {
        for (const key of Object.keys(entry.props)) children(style, key)[0].remove();
        mark(style);
      }
    } else if (action.type === 'variant') {
      const entry = requireEntry(analysis.variants, action.id);
      const name = action.name?.trim();
      if (!name) throw new Error('Enter a meaningful name for the variant.');
      const existing = namedStyles(next);
      if (existing.some((style) => style.getAttribute('Key') === name || propsOf(style).Name === name)) {
        throw new Error(`A style named "${name}" already exists. Choose a different name.`);
      }
      let counter = 1;
      const keys = new Set(existing.map((style) => style.getAttribute('Key')));
      while (keys.has(`Consolidated ${counter}`)) counter++;
      const key = `Consolidated ${counter}`;
      const container = next.stylesDoc.getElementsByTagName('Styles')[0];
      if (!container) throw new Error('Missing Styles container.');
      const created = next.stylesDoc.createElementNS(container.namespaceURI, 'Style');
      created.setAttribute('Key', key);
      setProp(created, 'Name', name);
      // Flatten explicit bases only; missing values must continue to inherit Default.
      function explicitBase(base) {
        if (base === 'Default') return {};
        const props = index.named.get(base).props;
        return { ...(props.BasedOnStyle ? explicitBase(props.BasedOnStyle) : {}), ...valuesOf(props) };
      }
      for (const [property, value] of Object.entries({ ...explicitBase(entry.base), ...entry.props })) {
        setProp(created, property, value);
      }
      container.appendChild(created);
      mark(created);
      for (const { style } of entry.items) {
        for (const child of Array.from(style.children)) {
          if (child.localName !== 'Name' && child.localName !== 'BasedOnStyle') child.remove();
        }
        setProp(style, 'BasedOnStyle', key);
        mark(style);
      }
    } else if (action.type === 'merge') {
      const entry = requireEntry(analysis.duplicates, action.id);
      if (!entry.items.some((style) => style.key === action.target)) throw new Error('Invalid retained style.');
      if (entry.items.some((style) => style.key === 'Default') && action.target !== 'Default') {
        throw new Error('Default must be retained.');
      }
      const removed = new Set(entry.items.filter((style) => style.key !== action.target).map((style) => style.key));
      for (const key of removed) {
        if (isProtectedStyle(key) || index.opaque.has(key)) throw new Error(`"${key}" is protected.`);
        const target = index.named.get(action.target);
        if (removed.has(target.props.BasedOnStyle)) throw new Error('Cannot merge a retained style with its explicit base.');
        for (const ref of index.refs.get(key) || []) {
          ref.textContent = action.target;
          mark(ref);
        }
        const style = index.named.get(key).style;
        mark(style);
        style.remove();
      }
    } else if (action.type === 'prune') {
      const style = analysis.unused.find((style) => style.key === action.key && !style.protected);
      if (!style) throw new Error('This style is referenced or protected and cannot be pruned.');
      const element = index.named.get(style.key).style;
      mark(element);
      element.remove();
    } else {
      throw new Error(`Unknown consolidation action: ${action.type}`);
    }
  }
  verifyStyleBaseline(next, baseline, batchApprovals);
  return next;
}
