// Polymorphic type values are schema entity names, never executable expressions.
// audit_events keeps historical identifiers even after a record is removed.
export const POLYMORPHIC_REFERENCES = {
  activity_links: {entityField: 'target_entity', idField: 'target_id'},
  sales_documents: {entityField: 'source_type', idField: 'source_id'},
  inventory_movements: {entityField: 'reference_type', idField: 'reference_id'}
};

const hasEntity = (schema, entity) => Object.hasOwn(schema, entity);
const provided = value => value !== undefined && value !== null;

export function validatePartyRecord(record, {requireCore = false} = {}) {
  if ((requireCore || provided(record.display_name)) &&
      (typeof record.display_name !== 'string' || !record.display_name.trim())) throw new Error('Nombre obligatorio');
  if ((requireCore || provided(record.party_type)) &&
      !['PERSON', 'ORGANIZATION'].includes(record.party_type)) throw new Error('Tipo inválido');
  if ((requireCore || provided(record.lifecycle)) &&
      !['LEAD', 'CUSTOMER', 'ARCHIVED'].includes(record.lifecycle)) throw new Error('Estado inválido');
}

export function directPolymorphicReferences(schema, table, record) {
  const pair = POLYMORPHIC_REFERENCES[table];
  if (!pair) return [];
  const entity = record[pair.entityField], id = record[pair.idField];
  if (!provided(entity) && !provided(id)) return [];
  if (typeof entity !== 'string' || !hasEntity(schema, entity) ||
      typeof id !== 'string' || !id.trim()) {
    throw new Error('Referencia polimórfica inválida: ' + table + '.' + pair.idField);
  }
  return [{field: pair.idField, targetEntity: entity, targetId: id}];
}

export const MEMBERSHIP = {
  opportunities: ['stage_id', 'pipeline_id', 'pipeline_id'],
  project_tasks: ['phase_id', 'project_id', 'project_id'],
  project_deliverables: ['milestone_id', 'project_id', 'project_id'],
  receivable_payments: ['installment_id', 'receivable_id', 'receivable_id'],
  inventory_movements: ['lot_id', 'inventory_item_id', 'inventory_item_id']
};

// getRecord may read an IndexedDB transaction or an in-memory backup map.
export async function validateRecordRelations(schema, table, record, getRecord) {
  const references = Object.entries(schema[table].references || {})
    .filter(([field]) => provided(record[field]))
    .map(([field, target]) => ({field, targetEntity: target.split('.')[0], targetId: record[field]}));
  references.push(...directPolymorphicReferences(schema, table, record));
  const related = new Map();
  for (const ref of references) {
    if (typeof ref.targetId !== 'string' || !ref.targetId.trim()) {
      throw new Error('Referencia inválida: ' + table + '.' + ref.field);
    }
    const target = await getRecord(ref.targetEntity, ref.targetId);
    if (!target) throw new Error('Referencia inválida: ' + table + '.' + ref.field);
    related.set(ref.field, target);
  }
  if (table === 'field_values' && provided(record.record_id)) {
    const definition = related.get('definition_id');
    const targetEntity = definition?.entity_key;
    if (typeof record.record_id !== 'string' || !record.record_id.trim() ||
        typeof targetEntity !== 'string' || !hasEntity(schema, targetEntity) ||
        !await getRecord(targetEntity, record.record_id)) {
      throw new Error('Referencia polimórfica inválida: field_values.record_id');
    }
    references.push({field: 'record_id', targetEntity, targetId: record.record_id});
  }
  const membership = MEMBERSHIP[table];
  if (membership) {
    const [relatedField, ownField, relatedFieldToMatch] = membership;
    const parent = related.get(relatedField);
    if (parent && (table === 'opportunities' || provided(record[ownField])) &&
        parent[relatedFieldToMatch] !== record[ownField]) {
      throw new Error('Referencia incompatible: ' + table + '.' + relatedField + ' / ' + ownField);
    }
  }
  return references;
}
