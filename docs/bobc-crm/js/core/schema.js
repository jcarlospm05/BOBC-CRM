export const DB_NAME = 'bobc-crm';
export const DB_VERSION = 2;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldType = /^(uuid|datetime|string|boolean|integer)\??$/;
const entityName = /^[a-z][a-z0-9_]*$/;

export async function loadSchema() {
 const urls = ['./data/schema.json', './data/schema-extension-v2.json'];
 const values = await Promise.all(urls.map(async url => {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw Error('No disponible: ' + url);
  return response.json();
 }));
 if (values.some((value, index) => !Array.isArray(value?.entities) || value.entities.length !== [51, 45][index])) {
  throw Error('La versión del esquema no coincide');
 }
 const all = values.flatMap(value => value.entities);
 for (const entity of all) {
  if (!isObject(entity) || typeof entity.entity !== 'string' || !entityName.test(entity.entity) || !isObject(entity.fields) ||
      (entity.references !== undefined && !isObject(entity.references)) || entity.fields.id !== 'uuid' ||
      entity.fields.created_at !== 'datetime' || entity.fields.updated_at !== 'datetime') {
   throw Error('Entidad inválida en el esquema');
  }
  for (const [field, type] of Object.entries(entity.fields)) {
   if (!entityName.test(field) || typeof type !== 'string' || !fieldType.test(type)) {
    throw Error('Tipo inválido: ' + entity.entity + '.' + field);
   }
  }
 }
 const schema = Object.fromEntries(all.map(entity => [entity.entity, entity]));
 if (Object.keys(schema).length !== 96) throw Error('Nombres de entidades duplicados');
 let referenceCount = 0;
 for (const entity of all) {
  for (const [field, target] of Object.entries(entity.references || {})) {
   referenceCount++;
   if (!Object.hasOwn(entity.fields, field) || !['string', 'string?'].includes(entity.fields[field]) ||
       typeof target !== 'string' || !/^[a-z][a-z0-9_]*\.id$/.test(target) ||
       !Object.hasOwn(schema, target.split('.')[0])) {
    throw Error('Referencia inválida: ' + entity.entity + '.' + field + ' → ' + target);
   }
  }
 }
 if (referenceCount !== 115) throw Error('El número de referencias del esquema no coincide');
 return schema;
}
