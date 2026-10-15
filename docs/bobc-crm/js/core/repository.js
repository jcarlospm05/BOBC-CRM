import {readAll, readOne, requestResult, transactionFinished} from './idb.js';
import {POLYMORPHIC_REFERENCES, MEMBERSHIP, validatePartyRecord, validateRecordRelations} from './integrity.js';

// These string fields were incorrectly written as numbers by the original UI.
const LEGACY_NUMERIC_STRINGS = new Set(['quantity', 'sort_order', 'version_number', 'expected_quantity', 'counted_quantity']);

function validateFields(spec, input, {preserveUnknown = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Registro inválido');
  const record = {...input};
  for (const [field, value] of Object.entries(record)) {
    if (!Object.hasOwn(spec.fields, field)) {
      if (preserveUnknown) continue;
      throw new Error('Campo desconocido: ' + field);
    }
    if (value === undefined || value === null) continue;
    const type = spec.fields[field].replace(/\?$/, '');
    if (type === 'string' && LEGACY_NUMERIC_STRINGS.has(field) && typeof value === 'number' && Number.isFinite(value)) {
      record[field] = String(value);
      continue;
    }
    const valid = type === 'integer' ? Number.isSafeInteger(value) :
      type === 'boolean' ? typeof value === 'boolean' :
      type === 'datetime' ? typeof value === 'string' && Number.isFinite(Date.parse(value)) :
      (type === 'string' || type === 'uuid') && typeof value === 'string';
    if (!valid) throw new Error('Tipo inválido: ' + field + ' (' + type + ')');
  }
  if (record.id != null && (typeof record.id !== 'string' || !record.id.trim())) throw new Error('ID inválido');
  return record;
}

export class Repository {
  constructor(db, schema) { this.db = db; this.schema = schema; }
  check(table) {
    if (!Object.hasOwn(this.schema, table)) throw new Error('Entidad desconocida: ' + table);
  }
  async all(table) { this.check(table); return readAll(this.db, table); }
  async get(table, id) { this.check(table); return readOne(this.db, table, id); }
  async save(table, input) { return this.write(table, input, false); }
  async update(table, id, changes) { return this.write(table, {...changes, id}, true); }

  async write(table, input, mustExist) {
    this.check(table);
    const values = validateFields(this.schema[table], input);
    const id = values.id ?? crypto.randomUUID();
    // Dynamic field definitions can point at any schema entity. Lock all possible
    // targets so definition edits/deletes cannot race its reference validation.
    const dynamic = table === 'field_values' || table === 'field_definitions' || Object.hasOwn(POLYMORPHIC_REFERENCES, table);
    const dependents = Object.entries(MEMBERSHIP).filter(([entity, [field]]) =>
      this.schema[entity]?.references?.[field]?.split('.')[0] === table);
    const targets = dynamic ? Object.keys(this.schema) :
      Object.values(this.schema[table].references || {}).map(target => target.split('.')[0]);
    const stores = [...new Set([table, ...targets, ...dependents.map(([entity]) => entity)])];
    const tx = this.db.transaction(stores, 'readwrite'), done = transactionFinished(tx);
    try {
      const current = await requestResult(tx.objectStore(table).get(id));
      if (mustExist && !current) throw new Error('No encontrado');
      const now = new Date().toISOString();
      const record = validateFields(this.schema[table], {
        ...current, ...values, id, created_at: current?.created_at || values.created_at || now, updated_at: now
      }, {preserveUnknown: true});
      if (table === 'parties') validatePartyRecord(record, {requireCore: true});
      await validateRecordRelations(this.schema, table, record, (target, targetId) => requestResult(tx.objectStore(target).get(targetId)));
      if (current) {
        for (const [entity, [relatedField, ownField, parentField]] of dependents) {
          const rows = await requestResult(tx.objectStore(entity).getAll());
          if (rows.some(row => row[relatedField] === id && (entity === 'opportunities' || row[ownField] != null) && row[ownField] !== record[parentField])) {
            throw new Error('Cambio incompatible con registros vinculados: ' + entity + '.' + relatedField);
          }
        }
        if (table === 'field_definitions' && current.entity_key !== record.entity_key) {
          const rows = await requestResult(tx.objectStore('field_values').getAll());
          for (const row of rows.filter(value => value.definition_id === id)) {
            await validateRecordRelations(this.schema, 'field_values', row, (target, targetId) =>
              target === table && targetId === id ? record : requestResult(tx.objectStore(target).get(targetId)));
          }
        }
      }
      await requestResult(tx.objectStore(table).put(record));
      await done;
      return record;
    } catch (error) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }

  async delete(table, id) {
    this.check(table);
    if (typeof id !== 'string' || !id.trim()) throw new Error('ID inválido');
    const incoming = Object.entries(this.schema).flatMap(([entity, spec]) =>
      Object.entries(spec.references || {}).filter(([, target]) => target.split('.')[0] === table)
        .map(([field]) => ({entity, field})));
    const polymorphic = Object.entries(POLYMORPHIC_REFERENCES).filter(([entity]) => Object.hasOwn(this.schema, entity));
    const fieldValues = Object.hasOwn(this.schema, 'field_values') && Object.hasOwn(this.schema, 'field_definitions');
    const stores = [...new Set([table, ...incoming.map(ref => ref.entity), ...polymorphic.map(([entity]) => entity),
      ...(fieldValues ? ['field_values', 'field_definitions'] : [])])];
    const tx = this.db.transaction(stores, 'readwrite'), done = transactionFinished(tx);
    try {
      if (!await requestResult(tx.objectStore(table).get(id))) { await done; return false; }
      for (const {entity, field} of incoming) {
        const rows = await requestResult(tx.objectStore(entity).getAll());
        if (rows.some(row => row[field] === id && !(entity === table && row.id === id))) {
          throw new Error('Registro referenciado: ' + entity + '.' + field);
        }
      }
      for (const [entity, pair] of polymorphic) {
        const rows = await requestResult(tx.objectStore(entity).getAll());
        if (rows.some(row => row[pair.entityField] === table && row[pair.idField] === id && !(entity === table && row.id === id))) {
          throw new Error('Registro referenciado: ' + entity + '.' + pair.idField);
        }
      }
      if (fieldValues) {
        const definitions = await requestResult(tx.objectStore('field_definitions').getAll());
        const definitionIds = new Set(definitions.filter(row => row.entity_key === table).map(row => row.id));
        const rows = await requestResult(tx.objectStore('field_values').getAll());
        if (rows.some(row => row.record_id === id && definitionIds.has(row.definition_id) && !(table === 'field_values' && row.id === id))) {
          throw new Error('Registro referenciado: field_values.record_id');
        }
      }
      await requestResult(tx.objectStore(table).delete(id));
      await done;
      return true;
    } catch (error) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
}
