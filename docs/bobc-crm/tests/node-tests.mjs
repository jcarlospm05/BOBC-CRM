import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {loadSchema, DB_NAME, DB_VERSION} from '../js/core/schema.js';
import {validateBackup} from '../js/core/backup-validation.js';
import {validatePartyRecord, directPolymorphicReferences, POLYMORPHIC_REFERENCES, MEMBERSHIP} from '../js/core/integrity.js';
import {csvCell, relationshipsCsv} from '../js/core/csv.js';
import {createFileDownloader} from '../js/core/file-download.js';
import {parseFieldValue, MODULE_AREAS} from '../js/modules/module-manager.js';

// This runner tests application validation functions, without a browser or a
// database. HTTP is explicitly mocked with the actual JSON files on disk.
const sources = await Promise.all(['schema.json', 'schema-extension-v2.json'].map(async name =>
  JSON.parse(await readFile(new URL('../data/' + name, import.meta.url), 'utf8'))));
const originalFetch = globalThis.fetch;
const results = [];
const startedAt = new Date().toISOString();
const clone = value => structuredClone(value);
const selectedSource = url => String(url).includes('schema-extension-v2.json') ? 1 : 0;

function fileFetch({mutate, unavailable, malformed, rejected} = {}) {
  return async (url, options) => {
    const index = selectedSource(url);
    assert.equal(options?.cache, 'no-store');
    if (rejected === index) throw new Error('Mock file-backed fetch failure');
    const source = clone(sources[index]);
    if (mutate) mutate(source, index);
    return {ok: unavailable !== index, json: async () => {
      if (malformed === index) throw new SyntaxError('Mock malformed JSON');
      return source;
    }};
  };
}

async function withFetch(mock, action) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await action(); } finally { globalThis.fetch = previous; }
}

async function test(name, action) {
  const start = performance.now();
  try {
    await action();
    results.push({name, passed: true, durationMs: Math.round(performance.now() - start)});
  } catch (error) {
    results.push({name, passed: false, durationMs: Math.round(performance.now() - start), error: error.stack || String(error)});
  }
}

// These doubles verify the JS bridge contract only. They do not run a WebView,
// Android's Storage Access Framework, or a real filesystem write.
function downloadEnvironment({origin = 'https://appassets.androidplatform.net', onSave, readFailure, malformed} = {}) {
  const requests = [], links = [], created = [], revoked = [], timers = [];
  const listeners = new Map();
  let sequence = 0;
  const emit = detail => {
    for (const listener of [...(listeners.get('bobc-file-result') || [])]) listener({detail});
  };
  const environment = {
    location: {origin}, crypto: {randomUUID: () => 'qa-download-' + (++sequence)},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    BobcAndroid: {saveFile(...args) { requests.push(args); onSave?.(args, emit); }},
    FileReader: class {
      readAsDataURL(blob) {
        if (readFailure) { queueMicrotask(() => this['on' + readFailure]?.()); return; }
        blob.arrayBuffer().then(buffer => {
          this.result = malformed ? 'invalid-data-url' : 'data:' + blob.type + ';base64,' + Buffer.from(buffer).toString('base64');
          this.onload?.();
        }).catch(() => this.onerror?.());
      }
    },
    URL: {
      createObjectURL(blob) { created.push(blob); return 'blob:qa-download'; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, 'a');
        const link = {click() { this.clicked = true; }, remove() { this.removed = true; }};
        links.push(link); return link;
      },
      body: {appendChild(link) { link.appended = true; }},
    },
    setTimeout(callback, delay) { timers.push({callback, delay}); },
  };
  return {environment, requests, links, created, revoked, timers, emit,
    listenerCount: () => listeners.get('bobc-file-result')?.size || 0};
}

const modern = records => ({format: 'BOBC-CRM-BACKUP', backupVersion: 2, schemaVersion: 2, records});
const legacy = records => ({format: 'BOBC-CRM-BACKUP', schemaVersion: 1, records});
let schema, tables, originalTables;
function fixture(names = tables) {
  const ids = Object.fromEntries(names.map(table => [table, 'qa-' + table]));
  const records = Object.fromEntries(names.map(table => [table, []]));
  for (const table of names) {
    // Dates and optional operation fields deliberately remain absent. The
    // validator must not invent mandatory values that the datasheet forbids.
    const record = {id: ids[table]};
    for (const [field, target] of Object.entries(schema[table].references || {})) {
      const id = ids[target.split('.')[0]];
      if (id) record[field] = id;
    }
    if (table === 'parties') Object.assign(record, {display_name: 'Cliente QA', party_type: 'PERSON', lifecycle: 'LEAD'});
    records[table].push(record);
  }
  if (records.field_definitions) records.field_definitions[0].entity_key = 'parties';
  if (records.field_values) records.field_values[0].record_id = ids.parties;
  return records;
}

async function rejectedBackup(data, expected = Error) {
  const before = clone(data);
  await assert.rejects(() => validateBackup(schema, data), expected);
  assert.deepEqual(data, before, 'Validation mutated the rejected input');
}

try {
  globalThis.fetch = fileFetch();
  await test('schema/load-real-files-through-file-backed-fetch-mock', async () => {
    schema = await loadSchema();
    tables = Object.keys(schema);
    originalTables = sources[0].entities.map(entity => entity.entity);
    assert.equal(DB_NAME, 'bobc-crm');
    assert.equal(DB_VERSION, 2);
    assert.deepEqual(sources.map(source => source.entities.length), [51, 45]);
    assert.equal(tables.length, 96);
    assert.equal(new Set(tables).size, 96);
    assert.deepEqual(sources.map(source => source.entities.reduce((n, entity) => n + Object.keys(entity.references || {}).length, 0)), [48, 67]);
    for (const [table, spec] of Object.entries(schema)) {
      assert.equal(spec.entity, table);
      assert.equal(spec.fields.id, 'uuid');
      assert.equal(spec.fields.created_at, 'datetime');
      assert.equal(spec.fields.updated_at, 'datetime');
      for (const type of Object.values(spec.fields)) assert.match(type, /^(uuid|datetime|string|integer|boolean)\??$/);
      for (const [field, target] of Object.entries(spec.references || {})) {
        assert.ok(spec.fields[field]);
        const [destination, key] = target.split('.');
        assert.equal(key, 'id');
        assert.equal(schema[destination].fields[key], 'uuid');
      }
    }
  });

  const schemaMutations = [
    ['missing-entity-list', source => { delete source.entities; }],
    ['entity-list-not-array', source => { source.entities = {}; }],
    ['entity-count', source => { source.entities.pop(); }],
    ['duplicate-entity-name', source => { source.entities[1].entity = source.entities[0].entity; }],
    ['null-entity', source => { source.entities[0] = null; }],
    ['invalid-entity-name', source => { source.entities[0].entity = 'Bad-Name'; }],
    ['missing-fields', source => { delete source.entities[0].fields; }],
    ['array-fields', source => { source.entities[0].fields = []; }],
    ['id-type', source => { source.entities[0].fields.id = 'string'; }],
    ['created-at-type', source => { source.entities[0].fields.created_at = 'string'; }],
    ['updated-at-type', source => { source.entities[0].fields.updated_at = 'datetime?'; }],
    ['unknown-field-type', source => { source.entities[0].fields.name = 'money'; }],
    ['non-string-field-type', source => { source.entities[0].fields.name = null; }],
    ['invalid-field-name', source => { source.entities[0].fields['bad-name'] = 'string?'; }],
    ['array-references', source => { source.entities[0].references = []; }],
    ['null-references', source => { source.entities[0].references = null; }],
    ['missing-reference-field', source => { source.entities[1].references.invented = 'dashboards.id'; }],
    ['non-string-reference-field', source => { source.entities[1].fields.dashboard_id = 'integer?'; }],
    ['non-string-reference-target', source => { source.entities[1].references.dashboard_id = 1; }],
    ['invalid-reference-target-field', source => { source.entities[1].references.dashboard_id = 'dashboards.name'; }],
    ['unknown-reference-entity', source => { source.entities[1].references.dashboard_id = 'unknown_table.id'; }],
    ['missing-reference-count', source => { delete source.entities[1].references.dashboard_id; }],
    ['extra-reference-count', source => {
      source.entities[0].fields.qa_reference = 'string?';
      source.entities[0].references.qa_reference = 'dashboards.id';
    }],
  ];
  for (const [name, mutate] of schemaMutations) {
    await test('schema/reject-' + name, () => withFetch(fileFetch({mutate: (source, index) => {
      if (index === 0) mutate(source);
    }}), () => assert.rejects(loadSchema)));
  }
  for (const index of [0, 1]) for (const condition of ['unavailable', 'malformed', 'rejected']) {
    await test(`schema/reject-mocked-${condition}-source-${index}`, () =>
      withFetch(fileFetch({[condition]: index}), () => assert.rejects(loadSchema)));
  }

  if (schema) {
    for (const [name, factory, names] of [
      ['v2-96-entities', modern, tables],
      ['legacy-v1-51-entities', legacy, originalTables],
      ['transitional-v1-96-entities', legacy, tables],
    ]) await test('backup/accept-' + name, async () => {
      const data = factory(fixture(names)), before = clone(data);
      const output = await validateBackup(schema, data);
      assert.equal(Object.keys(output.records).length, 96);
      assert.deepEqual(output.records, {...Object.fromEntries(tables.map(table => [table, []])), ...data.records});
      assert.deepEqual(output.legacyMissing, tables.filter(table => !names.includes(table)));
      assert.deepEqual(data, before, 'Validation mutated valid input');
    });
    await test('backup/accept-empty-v2-all-tables', async () => {
      const data = modern(Object.fromEntries(tables.map(table => [table, []])));
      assert.deepEqual((await validateBackup(schema, data)).records, data.records);
    });

    const invalidBackups = [
      ['null', () => null],
      ['array', () => []],
      ['raw-malformed-json-string', () => '{'],
      ['wrong-format', () => ({...modern(fixture()), format: 'OTHER'})],
      ['missing-format', () => ({schemaVersion: 2, records: fixture()})],
      ['future-schema-version', () => ({...modern(fixture()), schemaVersion: 3})],
      ['string-schema-version', () => ({...modern(fixture()), schemaVersion: '2'})],
      ['unsupported-backup-version', () => ({...modern(fixture()), backupVersion: 3})],
      ['null-backup-version', () => ({...modern(fixture()), backupVersion: null})],
      ['missing-records', () => ({format: 'BOBC-CRM-BACKUP', schemaVersion: 2})],
      ['null-records', () => modern(null)],
      ['array-records', () => modern([])],
      ['unknown-table', () => modern({...fixture(), unexpected_table: []})],
      ['partial-v2', () => modern({parties: fixture().parties})],
      ['legacy51-marked-v2', () => modern(fixture(originalTables))],
      ['partial-v1', () => legacy({parties: fixture().parties})],
      ['legacy51-wrong-membership', () => {
        const records = fixture(originalTables); delete records.dashboards; records.projects = [];
        return legacy(records);
      }],
      ['non-array-table', () => modern({...fixture(), projects: {}})],
      ['null-table', () => modern({...fixture(), projects: null})],
      ['null-row', () => modern({...fixture(), projects: [null]})],
      ['array-row', () => modern({...fixture(), projects: [[]]})],
      ['string-row', () => modern({...fixture(), projects: ['row']})],
      ['missing-id', () => modern({...fixture(), projects: [{}]})],
      ['number-id', () => modern({...fixture(), projects: [{id: 123}]})],
      ['blank-id', () => modern({...fixture(), projects: [{id: '  '}]})],
      ['duplicate-id', () => {
        const records = fixture(); records.parties.push(clone(records.parties[0])); return modern(records);
      }],
    ];
    for (const [name, factory] of invalidBackups) await test('backup/reject-' + name, () => rejectedBackup(factory()));

    const invalidFields = [
      ['fractional-integer', 'expenses', 'amount_minor', 0.5],
      ['unsafe-integer', 'expenses', 'amount_minor', Number.MAX_SAFE_INTEGER + 1],
      ['negative-unsafe-integer', 'expenses', 'amount_minor', Number.MIN_SAFE_INTEGER - 1],
      ['string-integer', 'expenses', 'amount_minor', '10'],
      ['nan-integer', 'expenses', 'amount_minor', NaN],
      ['infinite-integer', 'expenses', 'amount_minor', Infinity],
      ['string-boolean', 'dashboards', 'active', 'false'],
      ['numeric-boolean', 'dashboards', 'active', 1],
      ['object-string', 'projects', 'name', {}],
      ['number-string', 'projects', 'name', 42],
      ['non-string-date', 'projects', 'created_at', 123],
    ];
    for (const [name, table, field, value] of invalidFields) await test('backup/reject-' + name, async () => {
      const records = fixture(); records[table][0][field] = value;
      await rejectedBackup(modern(records));
    });
    for (const amount of [Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]) {
      await test('backup/accept-safe-integer-' + amount, async () => {
        const records = fixture(); records.expenses[0].amount_minor = amount;
        assert.equal((await validateBackup(schema, modern(records))).records.expenses[0].amount_minor, amount);
      });
    }

    for (const [field, value] of [['display_name', ''], ['display_name', '  '],
      ['party_type', 'INVALID'], ['lifecycle', 'INVALID']]) {
      await test('backup/reject-party-' + field + '-' + JSON.stringify(value), async () => {
        const records = fixture(); records.parties[0][field] = value;
        await rejectedBackup(modern(records));
      });
    }
    for (const field of ['display_name', 'party_type', 'lifecycle']) {
      await test('backup/accept-historical-null-party-' + field, async () => {
        const records = fixture(); records.parties[0][field] = null;
        const before = clone(records);
        assert.deepEqual((await validateBackup(schema, modern(records))).records, before);
        assert.deepEqual(records, before, 'Historical null was changed during validation');
      });
    }
    await test('backup/preserve-partial-historical-party-without-inventing-fields', async () => {
      const records = fixture();
      records.parties[0] = {id: records.parties[0].id, display_name: 'Cliente histórico'};
      const before = clone(records);
      assert.deepEqual((await validateBackup(schema, legacy(records))).records, before);
      assert.deepEqual(records, before);
      assert.equal(Object.hasOwn(records.parties[0], 'party_type'), false);
      assert.equal(Object.hasOwn(records.parties[0], 'lifecycle'), false);
      records.parties[0].lifecycle = 'INVALID';
      await rejectedBackup(legacy(records), /Estado inválido/);
    });
    for (const partyType of ['PERSON', 'ORGANIZATION']) for (const lifecycle of ['LEAD', 'CUSTOMER', 'ARCHIVED']) {
      await test(`backup/accept-party-${partyType}-${lifecycle}`, async () => {
        const records = fixture(); Object.assign(records.parties[0], {party_type: partyType, lifecycle});
        await validateBackup(schema, modern(records));
      });
    }

    let checkedReferences = 0;
    for (const table of tables) for (const field of Object.keys(schema[table].references || {})) {
      await test(`backup/reject-static-fk-${table}.${field}`, async () => {
        const records = fixture(); records[table][0][field] = 'qa-nonexistent-target';
        await rejectedBackup(modern(records), /Referencia inválida/);
      });
      checkedReferences++;
    }
    await test('backup/all-115-declared-static-fks-exercised', () => assert.equal(checkedReferences, 115));
    for (const value of ['', '  ', 12]) await test('backup/reject-invalid-fk-value-' + JSON.stringify(value), async () => {
      const records = fixture(); records.projects[0].party_id = value;
      await rejectedBackup(modern(records));
    });

    for (const [table, [relatedField, ownField, targetField]] of Object.entries(MEMBERSHIP)) {
      await test(`backup/reject-membership-${table}.${relatedField}`, async () => {
        const records = fixture();
        const targetTable = schema[table].references[ownField].split('.')[0];
        records[targetTable].push({id: 'qa-other-parent'});
        records[table][0][ownField] = 'qa-other-parent';
        // Both references exist, but they belong to different parents.
        const relatedTable = schema[table].references[relatedField].split('.')[0];
        assert.notEqual(records[relatedTable][0][targetField], records[table][0][ownField]);
        await rejectedBackup(modern(records), /Referencia incompatible/);
      });
    }

    for (const [table, pair] of Object.entries(POLYMORPHIC_REFERENCES)) {
      await test('backup/accept-polymorphic-' + table, async () => {
        const records = fixture();
        Object.assign(records[table][0], {[pair.entityField]: 'projects', [pair.idField]: records.projects[0].id});
        await validateBackup(schema, modern(records));
      });
      for (const [name, entity, id] of [
        ['unknown-entity', 'unknown_table', 'qa-projects'],
        ['missing-target', 'projects', 'qa-nonexistent'],
        ['missing-id', 'projects', undefined],
        ['missing-entity', undefined, 'qa-projects'],
        ['blank-id', 'projects', '  '],
      ]) await test(`backup/reject-polymorphic-${table}-${name}`, async () => {
        const records = fixture();
        Object.assign(records[table][0], {[pair.entityField]: entity, [pair.idField]: id});
        await rejectedBackup(modern(records));
      });
    }
    for (const [name, mutate] of [
      ['missing-record', records => { records.field_values[0].record_id = 'qa-nonexistent'; }],
      ['unknown-definition-entity', records => { records.field_definitions[0].entity_key = 'unknown_table'; }],
      ['blank-record-id', records => { records.field_values[0].record_id = ' '; }],
      ['missing-definition', records => { delete records.field_values[0].definition_id; }],
    ]) await test('backup/reject-field-values-' + name, async () => {
      const records = fixture(); mutate(records); await rejectedBackup(modern(records));
    });

    await test('backup/preserve-legacy-numeric-fields-and-unknown-metadata', async () => {
      const records = fixture();
      const numericTextFields = new Set(['quantity', 'sort_order', 'version_number', 'expected_quantity', 'counted_quantity']);
      let count = 0;
      for (const table of tables) for (const [field, type] of Object.entries(schema[table].fields)) {
        if (numericTextFields.has(field) && type.startsWith('string')) { records[table][0][field] = 1.25; count++; }
      }
      assert.ok(count >= 5, 'Legacy numeric fixtures were not populated');
      records.parties[0].legacy_custom = {unchanged: true, nested: ['metadata', 3]};
      const data = legacy(records), before = clone(data);
      const output = await validateBackup(schema, data);
      assert.deepEqual(output.records, before.records);
      assert.deepEqual(data, before);
      assert.equal(output.records.parties[0], data.records.parties[0]);
    });
    for (const value of [NaN, Infinity, -Infinity]) await test('backup/reject-nonfinite-legacy-number-' + value, async () => {
      const records = fixture(); records.expense_items[0].quantity = value;
      await rejectedBackup(legacy(records));
    });
    await test('backup/audit-history-identifiers-are-preserved', async () => {
      const records = fixture();
      Object.assign(records.audit_events[0], {entity_key: 'deleted_table', record_id: 'historical-removed-record'});
      assert.deepEqual((await validateBackup(schema, modern(records))).records.audit_events, records.audit_events);
    });
    await test('integrity/party-core-and-partial-validation', () => {
      assert.doesNotThrow(() => validatePartyRecord({}));
      assert.throws(() => validatePartyRecord({}, {requireCore: true}), /Nombre obligatorio/);
      assert.throws(() => validatePartyRecord({display_name: 1}), /Nombre obligatorio/);
      assert.throws(() => validatePartyRecord({party_type: 'INVALID'}), /Tipo inválido/);
      assert.throws(() => validatePartyRecord({lifecycle: 'INVALID'}), /Estado inválido/);
      assert.doesNotThrow(() => validatePartyRecord(fixture().parties[0], {requireCore: true}));
    });
    await test('integrity/no-execution-of-polymorphic-entity-text', () => {
      assert.throws(() => directPolymorphicReferences(schema, 'activity_links', {
        target_entity: 'constructor', target_id: 'qa-projects',
      }), /Referencia polimórfica inválida/);
      assert.throws(() => directPolymorphicReferences(schema, 'activity_links', {
        target_entity: 'projects;process.exit(1)', target_id: 'qa-projects',
      }), /Referencia polimórfica inválida/);
    });
  }

  for (const [value, expected] of [
    ['plain', '"plain"'], ['He said "hola"', '"He said ""hola"""'], ['a,b', '"a,b"'],
    ['a\r\nb', '"a\r\nb"'], [null, '""'], [123, '"123"'],
    ['=SUM(A1)', '"\'=SUM(A1)"'], ['+1', '"\'+1"'], ['-1', '"\'-1"'], ['@SUM(A1)', '"\'@SUM(A1)"'],
    ['  =1', '"\'  =1"'], ['\uFEFF=1', '"\'\uFEFF=1"'], ['\tplain', '"\'\tplain"'],
    ['\rplain', '"\'\rplain"'], ['\nplain', '"\'\nplain"'],
  ]) await test('csv/escape-' + JSON.stringify(value), () => assert.equal(csvCell(value), expected));
  await test('csv/relationship-export-bom-header-columns-and-formula-safety', () => {
    assert.equal(relationshipsCsv([{display_name: '=1', party_type: 'PERSON', lifecycle: 'LEAD'}]),
      '\uFEFFNombre,Tipo,Estado\r\n"\'=1","PERSON","LEAD"');
    assert.equal(relationshipsCsv([]), '\uFEFFNombre,Tipo,Estado\r\n');
  });

  for (const [type, input, expected] of [
    ['boolean?', {type: 'select-one', value: ''}, undefined],
    ['boolean?', {type: 'select-one', value: 'true'}, true],
    ['boolean?', {type: 'select-one', value: 'false'}, false],
    ['boolean', {type: 'checkbox', checked: true}, true],
    ['boolean', {type: 'checkbox', checked: false}, false],
    ['integer?', {value: '  '}, undefined],
    ['integer', {value: '0'}, 0],
    ['integer?', {value: ' -23 '}, -23],
    ['integer?', {value: String(Number.MAX_SAFE_INTEGER)}, Number.MAX_SAFE_INTEGER],
    ['integer?', {value: String(Number.MIN_SAFE_INTEGER)}, Number.MIN_SAFE_INTEGER],
    ['string?', {value: '  hola  '}, 'hola'],
    ['string?', {value: '  '}, undefined],
    ['string?', {value: 'false'}, 'false'],
    ['uuid', {value: ' qa-id '}, 'qa-id'],
    ['datetime', {value: ' 2026-10-14T12:00:00.000Z '}, '2026-10-14T12:00:00.000Z'],
  ]) await test('module/parse-' + type + '-' + JSON.stringify(input), () => assert.equal(parseFieldValue(type, input), expected));
  for (const value of ['1.5', 'NaN', 'Infinity', String(Number.MAX_SAFE_INTEGER + 1), String(Number.MIN_SAFE_INTEGER - 1)]) {
    await test('module/reject-unsafe-integer-' + value, () => assert.throws(() => parseFieldValue('integer?', {value}), /entero/));
  }
  await test('module/area-map-eight-areas-37-distinct-form-entities', () => {
    assert.equal(Object.keys(MODULE_AREAS).length, 8);
    const names = Object.values(MODULE_AREAS).flat();
    assert.equal(names.length, 37);
    assert.equal(new Set(names).size, 37);
    assert.ok(names.every(name => Object.hasOwn(schema, name)));
  });

  for (const [mime, name, content] of [
    ['application/json', 'respaldo.json', '{"nombre":"José 🧶"}'],
    ['text/csv;charset=utf-8', 'relaciones.csv', '\uFEFFNombre\r\n"José 🧶"'],
  ]) await test('download/native-preserves-utf8-bytes-' + name, async () => {
    const transport = downloadEnvironment({onSave: ([, , , requestId], emit) => emit({requestId, success: true})});
    const blob = new Blob([content], {type: mime});
    const result = await createFileDownloader(transport.environment)(blob, name);
    assert.deepEqual(result, {native: true, saved: true});
    const [base64, filename, normalizedMime, requestId] = transport.requests[0];
    assert.deepEqual(Buffer.from(base64, 'base64'), Buffer.from(await blob.arrayBuffer()));
    assert.equal(filename, name);
    assert.equal(normalizedMime, mime.split(';')[0]);
    assert.equal(requestId, 'qa-download-1');
    assert.equal(transport.listenerCount(), 0);
    assert.equal(transport.links.length, 0);
  });
  await test('download/native-waits-for-matching-request-result', async () => {
    let saveStarted;
    const started = new Promise(resolve => { saveStarted = resolve; });
    const transport = downloadEnvironment({onSave: () => saveStarted()});
    const download = createFileDownloader(transport.environment);
    let completed = false;
    const operation = download(new Blob(['{}'], {type: 'application/json'}), 'backup.json').then(result => { completed = true; return result; });
    await started;
    transport.emit({requestId: 'unrelated-request', success: true});
    transport.emit(null);
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(transport.listenerCount(), 1);
    transport.emit({requestId: transport.requests[0][3], success: true});
    assert.deepEqual(await operation, {native: true, saved: true});
    assert.equal(transport.listenerCount(), 0);
  });
  await test('download/native-cancel-cleans-listener-and-allows-next-save', async () => {
    let attempt = 0;
    const transport = downloadEnvironment({onSave: ([, , , requestId], emit) => {
      emit(++attempt === 1 ? {requestId, success: false, cancelled: true} : {requestId, success: true});
    }});
    const download = createFileDownloader(transport.environment);
    const blob = new Blob(['{}'], {type: 'application/json'});
    assert.deepEqual(await download(blob, 'backup.json'), {native: true, saved: false, cancelled: true});
    assert.equal(transport.listenerCount(), 0);
    assert.deepEqual(await download(blob, 'backup.json'), {native: true, saved: true});
    assert.notEqual(transport.requests[0][3], transport.requests[1][3]);
  });
  await test('download/native-write-error-propagates-and-allows-next-save', async () => {
    let attempt = 0;
    const transport = downloadEnvironment({onSave: ([, , , requestId], emit) => {
      emit(++attempt === 1 ? {requestId, success: false, error: 'No hay espacio'} : {requestId, success: true});
    }});
    const download = createFileDownloader(transport.environment);
    const blob = new Blob(['{}'], {type: 'application/json'});
    await assert.rejects(() => download(blob, 'backup.json'), /No hay espacio/);
    assert.equal(transport.listenerCount(), 0);
    assert.equal((await download(blob, 'backup.json')).saved, true);
  });
  await test('download/native-rejects-second-save-without-disrupting-first', async () => {
    const transport = downloadEnvironment();
    const download = createFileDownloader(transport.environment);
    const blob = new Blob(['{}'], {type: 'application/json'});
    const first = download(blob, 'backup.json');
    await assert.rejects(() => download(blob, 'second.json'), /pendiente de guardar/);
    // FileReader uses a microtask after the native Blob conversion completes.
    while (transport.requests.length === 0) await new Promise(resolve => setImmediate(resolve));
    assert.equal(transport.requests.length, 1);
    transport.emit({requestId: transport.requests[0][3], success: true});
    assert.equal((await first).saved, true);
  });
  await test('download/native-bridge-throw-cleans-listener-and-pending-state', async () => {
    let attempt = 0;
    const transport = downloadEnvironment({onSave: ([, , , requestId], emit) => {
      if (++attempt === 1) throw new Error('Puente no disponible');
      emit({requestId, success: true});
    }});
    const download = createFileDownloader(transport.environment);
    const blob = new Blob(['{}'], {type: 'application/json'});
    await assert.rejects(() => download(blob, 'backup.json'), /Puente no disponible/);
    assert.equal(transport.listenerCount(), 0);
    assert.equal((await download(blob, 'backup.json')).saved, true);
  });
  for (const options of [{readFailure: 'error'}, {readFailure: 'abort'}, {malformed: true}]) {
    await test('download/native-rejects-reader-' + JSON.stringify(options), async () => {
      const transport = downloadEnvironment(options);
      const download = createFileDownloader(transport.environment);
      const blob = new Blob(['{}'], {type: 'application/json'});
      await assert.rejects(() => download(blob, 'backup.json'), /archivo/);
      await assert.rejects(() => download(blob, 'backup.json'), /archivo/);
      assert.equal(transport.requests.length, 0);
      assert.equal(transport.listenerCount(), 0);
    });
  }
  await test('download/native-rejects-over-32mib-before-reading', async () => {
    const transport = downloadEnvironment();
    await assert.rejects(() => createFileDownloader(transport.environment)(
      {size: 32 * 1024 * 1024 + 1, type: 'application/json'}, 'backup.json'), /32 MiB/);
    assert.equal(transport.requests.length, 0);
  });
  for (const [mime, name] of [['text/html', 'backup.html'], ['application/json', 'backup.csv'], ['text/csv', 'backup.json']]) {
    await test('download/native-rejects-unsupported-format-' + mime + '-' + name, async () => {
      const transport = downloadEnvironment();
      await assert.rejects(() => createFileDownloader(transport.environment)(new Blob(['{}'], {type: mime}), name), /JSON o CSV/);
      assert.equal(transport.requests.length, 0);
    });
  }
  for (const origin of ['https://example.com', 'http://appassets.androidplatform.net', 'https://appassets.androidplatform.net.evil.example']) {
    await test('download/browser-ignores-bridge-at-untrusted-origin-' + origin, async () => {
      const transport = downloadEnvironment({origin});
      const blob = new Blob(['{}'], {type: 'application/json'});
      assert.deepEqual(await createFileDownloader(transport.environment)(blob, 'backup.json'), {native: false, started: true, saved: false});
      assert.equal(transport.requests.length, 0);
      assert.deepEqual(transport.created, [blob]);
      assert.equal(transport.links[0].download, 'backup.json');
      assert.equal(transport.links[0].href, 'blob:qa-download');
      assert.equal(transport.links[0].clicked, true);
      assert.equal(transport.links[0].appended, true);
      assert.equal(transport.links[0].removed, true);
      assert.equal(transport.timers[0].delay, 3000);
      transport.timers[0].callback();
      assert.deepEqual(transport.revoked, ['blob:qa-download']);
    });
  }
  await test('download/browser-fallback-without-native-bridge', async () => {
    const transport = downloadEnvironment();
    delete transport.environment.BobcAndroid;
    const result = await createFileDownloader(transport.environment)(new Blob(['{}'], {type: 'application/json'}), 'backup.json');
    assert.equal(result.native, false);
    assert.equal(result.started, true);
    assert.equal(transport.links[0].clicked, true);
  });
} finally {
  globalThis.fetch = originalFetch;
}

const passed = results.filter(result => result.passed).length;
const report = {
  startedAt, completedAt: new Date().toISOString(), runtime: process.version,
  scope: 'Pure application validation functions with actual schema files and mocked JS file-download transport; no IndexedDB, browser, UI, Android SAF, network, or deployment tests',
  transport: 'file-backed mocked fetch; FileReader, DOM download and native save callback doubles; success/error/cancel responses simulated explicitly',
  counts: {executed: results.length, passed, failed: results.length - passed},
  results,
};
const jsonIndex = process.argv.indexOf('--json');
const output = jsonIndex === -1 ? '/tmp/bobc-crm-node-qa.json' : process.argv[jsonIndex + 1];
if (!output) throw new Error('Expected a path after --json');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({report: output, ...report.counts}));
for (const result of results.filter(result => !result.passed)) console.error(result.name + '\n' + result.error);
if (report.counts.failed) process.exitCode = 1;
