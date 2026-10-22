import { openGridset, parseXml, stripBom } from './gridset.js';

export async function openGridsetContext(name, file, sourceType, sourcePath = '', allXml = false) {
  const opened = await openGridset(file);
  const xmlDocs = new Map([[opened.stylesPath, opened.stylesDoc], ...opened.gridDocs]);
  if (allXml) {
    for (const entry of opened.zip.file(/\.xml$/i)) {
      if (!xmlDocs.has(entry.name)) {
        try {
          xmlDocs.set(entry.name, parseXml(stripBom(await entry.async('string'))));
        } catch (error) {
          throw new Error(`${name}: ${entry.name}: ${error.message}`);
        }
      }
    }
  }
  return {
    id: `${sourceType}:${sourcePath || name}`,
    name, sourceType, sourcePath, ...opened, xmlDocs, dirtyDocs: new Set(),
  };
}

export async function openGrid3User(file, allXml = false) {
  const zip = await JSZip.loadAsync(file);
  const contexts = [];
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries.filter((entry) => /\.gridset$/i.test(entry.name))) {
    contexts.push(await openGridsetContext(
      entry.name, await entry.async('uint8array'), 'archive', entry.name, allXml
    ));
  }
  const prefixes = new Set();
  for (const entry of entries) {
    const match = /^(.*?)(?:Settings0\/Styles\/styles\.xml)$/i.exec(entry.name);
    if (match) prefixes.add(match[1]);
  }
  for (const prefix of prefixes) {
    if (!entries.some((entry) => entry.name.startsWith(prefix) &&
      /^Grids\/.+\/grid\.xml$/i.test(entry.name.slice(prefix.length)))) continue;
    const gridsetZip = new JSZip();
    for (const entry of entries) {
      if (entry.name.startsWith(prefix)) {
        gridsetZip.file(entry.name.slice(prefix.length), await entry.async('uint8array'));
      }
    }
    contexts.push(await openGridsetContext(
      prefix.replace(/\/$/, '') || 'Gridset',
      await gridsetZip.generateAsync({ type: 'uint8array' }), 'directory', prefix, allXml
    ));
  }
  if (!contexts.length) throw new Error('No gridsets were found in this .grid3user file.');
  return { zip, contexts };
}

export async function openStyleFile(file, allXml = false) {
  if (!/\.(gridset|grid3user)$/i.test(file.name)) {
    throw new Error('Please choose a .gridset or .grid3user file (Grid 3).');
  }
  const isUserFile = /\.grid3user$/i.test(file.name);
  const opened = isUserFile
    ? await openGrid3User(file, allXml)
    : { zip: null, contexts: [await openGridsetContext(file.name, file, 'standalone', '', allXml)] };
  return { fileName: file.name, isUserFile, outerZip: opened.zip, contexts: opened.contexts };
}

export async function buildModifiedBlob(context) {
  const zip = context.zip.clone();
  const serializer = new XMLSerializer();
  const docs = context.xmlDocs || new Map([
    [context.stylesPath, context.stylesDoc], ...context.gridDocs,
  ]);
  for (const [name, doc] of docs) {
    if (context.dirtyDocs.has(doc)) zip.file(name, serializer.serializeToString(doc));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function buildModifiedUserBlob(outerZip, contexts) {
  const output = outerZip.clone();
  const serializer = new XMLSerializer();
  for (const context of contexts) {
    if (!context.dirtyDocs.size) continue;
    if (context.sourceType === 'archive') {
      const blob = await buildModifiedBlob(context);
      output.file(context.sourcePath, new Uint8Array(await blob.arrayBuffer()));
    } else {
      const docs = context.xmlDocs || new Map([
        [context.stylesPath, context.stylesDoc], ...context.gridDocs,
      ]);
      for (const [name, doc] of docs) {
        if (context.dirtyDocs.has(doc)) {
          output.file(context.sourcePath + name, serializer.serializeToString(doc));
        }
      }
    }
  }
  return output.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
