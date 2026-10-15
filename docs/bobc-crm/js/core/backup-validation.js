import {validatePartyRecord, validateRecordRelations} from './integrity.js';

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (object, key) => Object.hasOwn(object, key);
const legacyNumericText = new Set(['quantity', 'sort_order', 'version_number', 'expected_quantity', 'counted_quantity']);

async function legacyTables() {
  const url = new URL('../../data/schema.json', import.meta.url);
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error('No se pudo verificar el esquema original del respaldo');
  const {entities} = await response.json();
  return entities.map(entity => entity.entity);
}

function checkRecord(table, spec, record) {
  if (!plainObject(record) || typeof record.id !== 'string' || !record.id.trim()) {
    throw new Error('Registro sin ID de texto válido: ' + table);
  }
  // Optional operation fields stay optional. Existing legacy values are preserved.
  for (const [field, type] of Object.entries(spec.fields)) {
    const value = record[field];
    if (value != null && type.startsWith('integer') && !Number.isSafeInteger(value)) {
      throw new Error('Importe o entero inválido: ' + table + '.' + field);
    }
    if (value != null && type.startsWith('boolean') && typeof value !== 'boolean') {
      throw new Error('Booleano inválido: ' + table + '.' + field);
    }
    if (value != null && ['uuid', 'datetime'].includes(type) && typeof value !== 'string') {
      throw new Error('Texto inválido: ' + table + '.' + field);
    }
    if (value != null && type.startsWith('string') && typeof value !== 'string' &&
        !(legacyNumericText.has(field) && typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('Texto inválido: ' + table + '.' + field);
    }
  }
  // Restore missing historical fields without inventing operation requirements.
  if (table === 'parties') validatePartyRecord(record);
}

export async function validateBackup(schema, data) {
  if (!plainObject(data) || data.format !== 'BOBC-CRM-BACKUP' ||
      ![1, 2].includes(data.schemaVersion) ||
      (data.backupVersion !== undefined && data.backupVersion !== 2) ||
      !plainObject(data.records)) throw new Error('Respaldo incompatible');
  const tables = Object.keys(schema);
  const supplied = Object.keys(data.records);
  if (supplied.some(table => !owns(schema, table))) throw new Error('Entidad desconocida en el respaldo');
  const missing = tables.filter(table => !owns(data.records, table));
  if (missing.length) {
    const original = await legacyTables();
    if (data.schemaVersion !== 1 || supplied.length !== original.length ||
        original.some(table => !Array.isArray(data.records[table]))) {
      throw new Error('Respaldo incompleto');
    }
  }
  const records = Object.fromEntries(tables.map(table => [table, owns(data.records, table) ? data.records[table] : []]));
  const maps = {};
  for (const table of tables) {
    if (!Array.isArray(records[table])) throw new Error('Tabla inválida: ' + table);
    maps[table] = new Map();
    for (const record of records[table]) {
      checkRecord(table, schema[table], record);
      if (maps[table].has(record.id)) throw new Error('IDs duplicados: ' + table);
      maps[table].set(record.id, record);
    }
  }
  for (const table of tables) for (const record of records[table]) {
    await validateRecordRelations(schema, table, record, (target, id) => maps[target]?.get(id));
  }
  return {records, legacyMissing: missing};
}
