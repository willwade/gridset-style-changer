import { compileCriteria, hasCellCriteria, parseCommandsXml } from './cell-commands.js';

export const SCHEMA_TYPE = 'gridset-cell-changer-schema';
export const SCHEMA_VERSION = 1;
const CRITERIA_LISTS = ['commandIds', 'contentTypes'];
const CRITERIA_PATTERNS = ['insertedText', 'caption', 'includeGrids', 'excludeGrids'];

export const BUILT_IN_SCHEMAS = [
  {
    type: SCHEMA_TYPE,
    version: SCHEMA_VERSION,
    name: 'Speak, prediction, chat history, space and punctuation cells',
    description: 'Selects cells that speak, type a space or punctuation, and prediction and chat history cells. Paste the commands to add.',
    changes: [{
      tool: 'add-commands',
      criteria: {
        commandIds: ['Action.Speak', 'Action.Space', 'Action.Punctuation'],
        contentTypes: ['AutoContent/Prediction', 'AutoContent/Chat.History'],
        insertedText: '^[\\p{P}\\p{S}\\s]+$',
      },
      commands: '',
      position: 'end',
      skipExisting: true,
    }],
  },
];

export function normaliseCriteria(criteria = {}) {
  const result = {};
  for (const key of CRITERIA_LISTS) {
    result[key] = Array.isArray(criteria[key]) ? criteria[key].map(String).filter(Boolean) : [];
  }
  for (const key of CRITERIA_PATTERNS) result[key] = typeof criteria[key] === 'string' ? criteria[key] : '';
  return result;
}

export function makeChange({ criteria, commands, position, skipExisting }) {
  return {
    tool: 'add-commands',
    criteria: normaliseCriteria(criteria),
    commands: String(commands || '').trim(),
    position: position === 'start' ? 'start' : 'end',
    skipExisting: skipExisting !== false,
  };
}

export function makeSchema(name, changes, description = '') {
  return {
    type: SCHEMA_TYPE,
    version: SCHEMA_VERSION,
    name: String(name || '').trim() || 'Untitled change schema',
    description: String(description || '').trim(),
    changes: changes.map(makeChange),
  };
}

/**
 * Validates and normalises a schema object (or JSON text). Commands may be blank for
 * selection-only presets; `ready` reports whether every change can be applied as is.
 */
export function readSchema(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      throw new Error(`This is not a valid change schema file (JSON error: ${error.message}).`);
    }
  }
  if (!data || typeof data !== 'object' || data.type !== SCHEMA_TYPE) {
    throw new Error('This is not a Gridset Cell Changer change schema.');
  }
  if (data.version > SCHEMA_VERSION) {
    throw new Error(`This change schema needs a newer version of the tool (schema version ${data.version}).`);
  }
  if (!Array.isArray(data.changes) || !data.changes.length) throw new Error('The change schema contains no changes.');
  const changes = data.changes.map((change, i) => {
    const label = `Change ${i + 1}`;
    if (change?.tool !== 'add-commands') throw new Error(`${label}: unsupported tool "${change?.tool}".`);
    const normalised = makeChange(change);
    let compiled;
    try {
      compiled = compileCriteria(normalised.criteria);
    } catch (error) {
      throw new Error(`${label}: ${error.message}`);
    }
    if (!hasCellCriteria(compiled)) throw new Error(`${label}: no cell criteria.`);
    if (normalised.commands) {
      try {
        parseCommandsXml(normalised.commands);
      } catch (error) {
        throw new Error(`${label}: ${error.message}`);
      }
    }
    return normalised;
  });
  const schema = makeSchema(data.name, changes, data.description);
  return { ...schema, ready: changes.every((change) => change.commands) };
}

export function combineSchemas(schemas) {
  if (!schemas.length) throw new Error('No change schemas to combine.');
  if (schemas.length === 1) return readSchema(schemas[0]);
  const read = schemas.map((schema) => readSchema(schema));
  const description = read
    .map((schema) => schema.description ? `${schema.name}: ${schema.description}` : '')
    .filter(Boolean).join('\n');
  return readSchema(makeSchema(
    read.map((schema) => schema.name).join(' + '),
    read.flatMap((schema) => schema.changes),
    description
  ));
}

export function schemaFileName(schema) {
  const slug = schema.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'change-schema';
  return `${slug}.cellschema.json`;
}

export function describeChange(change) {
  const c = change.criteria;
  const parts = [];
  if (c.commandIds.length) parts.push(`commands ${c.commandIds.join(', ')}`);
  if (c.contentTypes.length) parts.push(`content ${c.contentTypes.join(', ')}`);
  if (c.insertedText) parts.push(`inserted text /${c.insertedText}/`);
  if (c.caption) parts.push(`caption /${c.caption}/`);
  let where = parts.join(' or ');
  if (c.includeGrids) where += `; only grids /${c.includeGrids}/`;
  if (c.excludeGrids) where += `; except grids /${c.excludeGrids}/`;
  let ids = 'no commands yet';
  try {
    if (change.commands) ids = parseCommandsXml(change.commands).map((cmd) => cmd.getAttribute('ID')).join(', ');
  } catch {
    ids = 'invalid commands';
  }
  return `Add ${ids} (${change.position === 'start' ? 'before' : 'after'} existing) to cells with ${where}.`;
}
