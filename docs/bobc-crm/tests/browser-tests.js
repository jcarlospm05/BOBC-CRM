import {DB_NAME, DB_VERSION, loadSchema} from '../js/core/schema.js';
import {openDatabase, requestResult, transactionFinished} from '../js/core/idb.js';
import {Repository} from '../js/core/repository.js';
import {exportBackup, restoreBackup} from '../js/core/backup.js';

if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
  throw Error('BOBC QA only runs on a disposable localhost origin; access denied');
}
// All databases live in Playwright's disposable localhost origin, never in Pages.
const stamp = '2026-10-14T12:00:00.000Z';
const assert = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => assert(canonical(actual) === canonical(expected), message);
function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(v => JSON.parse(canonical(v))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])));
  return JSON.stringify(value);
}
const schemas = await Promise.all(['./data/schema.json', './data/schema-extension-v2.json'].map(async p => (await fetch(p)).json()));
const schema = await loadSchema();
const base = Object.fromEntries(schemas[0].entities.map(e => [e.entity, e]));
const tables = Object.keys(schema);
const extensions = Object.keys(schema).filter(t => !base[t]);
let held;

function emptyRecords(names = tables) { return Object.fromEntries(names.map(t => [t, []])); }
function fixture(names = tables) {
  const ids = Object.fromEntries(names.map((t, n) => [t, `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`]));
  const records = emptyRecords(names);
  for (const t of names) {
    const r = {id: ids[t], created_at: stamp, updated_at: stamp};
    for (const [key, target] of Object.entries(schema[t].references || {})) {
      if (ids[target.split('.')[0]]) r[key] = ids[target.split('.')[0]];
    }
    if (t === 'parties') Object.assign(r, {display_name: 'Cliente de prueba', party_type: 'PERSON', lifecycle: 'LEAD', status: 'ACTIVE'});
    if (t === 'dashboards') r.name = 'snapshot-old';
    if (t === 'module_suppliers') r.label = 'snapshot-old';
    records[t].push(r);
  }
  // Polymorphic field_values requires the definition's declared entity.
  if (records.field_definitions) records.field_definitions[0].entity_key = 'parties';
  if (records.field_values) records.field_values[0].record_id = ids.parties;
  return records;
}
const modern = records => ({format: 'BOBC-CRM-BACKUP', backupVersion: 2, schemaVersion: 2, createdAt: stamp, records});
const legacy = records => ({format: 'BOBC-CRM-BACKUP', schemaVersion: 1, createdAt: stamp, records});

async function erase() {
  if (held) { held.close(); held = null; }
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = resolve;
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error('QA database still has an open connection'));
  });
}
async function useDatabase(callback) {
  const db = await openDatabase(schema);
  try { return await callback(db, new Repository(db, schema)); } finally { db.close(); }
}
async function write(db, records, clear = true) {
  const tx = db.transaction(Object.keys(records), 'readwrite');
  const done = transactionFinished(tx);
  for (const [t, rows] of Object.entries(records)) {
    const store = tx.objectStore(t);
    if (clear) store.clear();
    rows.forEach(r => store.put(r));
  }
  await done;
}
async function snapshot(db) {
  const tx = db.transaction(tables, 'readonly');
  const done = transactionFinished(tx);
  const entries = await Promise.all(tables.map(async t => [t, await requestResult(tx.objectStore(t).getAll())]));
  await done;
  return Object.fromEntries(entries.map(([t, rows]) => [t, rows.sort((a, b) => a.id.localeCompare(b.id))]));
}
async function mustReject(operation, message) {
  let rejected = false;
  try { await operation(); } catch { rejected = true; }
  assert(rejected, message);
}
async function expectPreserved(db, operation, message) {
  const before = await snapshot(db);
  await mustReject(operation, message);
  equal(await snapshot(db), before, `${message}: database changed on failure`);
}

async function seedV1() {
  await erase();
  held = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(base)) {
        const store = r.result.createObjectStore(name, {keyPath: 'id'});
        for (const key of new Set([...Object.keys(spec.references || {}), 'created_at', 'updated_at'])) store.createIndex(key, key);
        // An unrelated pre-existing index must also survive the upgrade.
        store.createIndex('qa_legacy_index', 'id');
      }
    };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
  });
  await write(held, fixture(Object.keys(base)));
  return {version: held.version, stores: held.objectStoreNames.length};
}

const cases = [
  ['schema/counts-types-references', async () => {
    assert(DB_NAME === 'bobc-crm' && DB_VERSION === 2, 'Database identity/version changed');
    equal(schemas.map(s => s.entities.length), [51, 45], 'Unexpected entity counts');
    equal(schemas.map(s => s.entities.reduce((n, e) => n + Object.keys(e.references || {}).length, 0)), [48, 67], 'Unexpected FK counts');
    assert(tables.length === 96 && new Set(tables).size === 96, 'Unique store count');
    for (const [t, e] of Object.entries(schema)) {
      assert(e.fields.id === 'uuid', `${t}: missing UUID ID field`);
      for (const type of Object.values(e.fields)) assert(/^(uuid|datetime|string|integer|boolean)\??$/.test(type), `${t}: unknown field type ${type}`);
      for (const [key, target] of Object.entries(e.references || {})) {
        const [destination, field] = target.split('.');
        assert(e.fields[key] && schema[destination]?.fields[field] && field === 'id', `${t}.${key}: dangling schema reference`);
      }
    }
  }],
  ['indexeddb/fresh-96-stores-and-indices', async () => {
    await erase();
    await useDatabase(async db => {
      assert(db.version === 2 && db.objectStoreNames.length === 96, 'Fresh database is not v2/96');
      const tx = db.transaction(tables, 'readonly');
      const done = transactionFinished(tx);
      for (const t of tables) {
        const store = tx.objectStore(t);
        assert(store.keyPath === 'id', `${t}: wrong keyPath`);
        for (const key of [...Object.keys(schema[t].references || {}), 'created_at', 'updated_at']) assert(store.indexNames.contains(key), `${t}: missing index ${key}`);
      }
      // close() waits for active transactions; finish this probe before the next erase().
      await done;
    });
  }],
  ['schema/rejects-mutated-reference-and-field-type', async () => {
    const originalFetch = window.fetch;
    for (const change of [
      source => { source.entities[1].references.dashboard_id = 'dashboards.missing'; },
      source => { source.entities[0].fields.name = 'money'; },
    ]) {
      window.fetch = async url => {
        const source = structuredClone(schemas[String(url).includes('extension') ? 1 : 0]);
        if (!String(url).includes('extension')) change(source);
        return {ok: true, json: async () => source};
      };
      try { await mustReject(() => loadSchema(), 'Mutated invalid schema must reject'); }
      finally { window.fetch = originalFetch; }
    }
  }],
  ['indexeddb/actual-v1-v2-preserves-51-stores-records-indices', async () => {
    await seedV1(); held.close(); held = null;
    await useDatabase(async db => {
      const after = await snapshot(db);
      const expected = fixture(Object.keys(base));
      const tx = db.transaction(Object.keys(base), 'readonly');
      const done = transactionFinished(tx);
      for (const t of Object.keys(base)) {
        equal(after[t], expected[t], `${t}: legacy records changed`);
        assert(tx.objectStore(t).indexNames.contains('qa_legacy_index'), `${t}: old index removed`);
      }
      await done;
      for (const t of extensions) equal(after[t], [], `${t}: extension not empty after migration`);
      assert(db.objectStoreNames.length === 96, 'Upgrade did not add 45 stores');
    });
  }],
  ['repository/static-fk-and-atomic-rejection', async () => {
    await erase();
    await useDatabase(async (db, repo) => {
      const party = await repo.save('parties', {display_name: 'FK client', party_type: 'ORGANIZATION', lifecycle: 'CUSTOMER'});
      const project = await repo.save('projects', {name: 'Proyecto', party_id: party.id});
      assert((await repo.get('projects', project.id)).party_id === party.id, 'Valid FK was not stored');
      await expectPreserved(db, () => repo.save('projects', {...project, party_id: 'missing-party'}), 'Invalid FK must reject update');
      await expectPreserved(db, () => repo.save('expenses', {amount_minor: 1.25}), 'Fractional currency minor unit must reject');
      await expectPreserved(db, () => repo.save('expenses', {amount_minor: Number.MAX_SAFE_INTEGER + 1}), 'Unsafe integer must reject');
      await expectPreserved(db, () => repo.save('parties', {display_name: '', party_type: 'PERSON', lifecycle: 'LEAD'}), 'Empty Party name must reject');
      await expectPreserved(db, () => repo.save('projects', {name: 'Wrong type', party_id: 123}), 'Non-string FK must reject');
      await expectPreserved(db, () => repo.save('projects', {name: 42}), 'Wrong string field type must reject');
    });
  }],
  ['repository/cross-record-and-polymorphic-references', async () => {
    await erase();
    await useDatabase(async (db, repo) => {
      const pipeline = await repo.save('pipelines', {name: 'Uno'});
      const other = await repo.save('pipelines', {name: 'Dos'});
      const stage = await repo.save('pipeline_stages', {pipeline_id: pipeline.id, name: 'Etapa'});
      await expectPreserved(db, () => repo.save('opportunities', {pipeline_id: other.id, stage_id: stage.id}), 'Mismatched pipeline/stage must reject');
      const project = await repo.save('projects', {name: 'Uno'});
      const another = await repo.save('projects', {name: 'Dos'});
      const phase = await repo.save('project_phases', {project_id: project.id, name: 'Fase'});
      await expectPreserved(db, () => repo.save('project_tasks', {project_id: another.id, phase_id: phase.id, name: 'Tarea'}), 'Mismatched project/phase must reject');
      const activity = await repo.save('activity_items', {subject: 'Llamada'});
      await repo.save('activity_links', {activity_id: activity.id, target_entity: 'projects', target_id: project.id});
      await expectPreserved(db, () => repo.save('activity_links', {activity_id: activity.id, target_entity: 'projects', target_id: 'invented'}), 'Invalid polymorphic FK must reject');
      await expectPreserved(db, () => repo.save('activity_links', {activity_id: activity.id, target_entity: 'unknown', target_id: project.id}), 'Unknown polymorphic table must reject');
      await expectPreserved(db, () => repo.save('activity_links', {activity_id: activity.id, target_entity: 'projects'}), 'Incomplete polymorphic pair must reject');
    });
  }],
  ['repository/all-115-static-fk-rejections-preserve-records', async () => {
    await erase();
    await useDatabase(async (db, repo) => {
      const records = fixture(); await write(db, records);
      let checked = 0;
      for (const t of tables) for (const key of Object.keys(schema[t].references || {})) {
        await mustReject(() => repo.save(t, {...records[t][0], [key]: 'invented-target'}), `${t}.${key} accepted missing destination`);
        equal(await repo.get(t, records[t][0].id), records[t][0], `${t}.${key}: failed save changed row`);
        checked++;
      }
      assert(checked === 115, 'Not all declared FK fields tested');
      equal(await snapshot(db), records, 'Failed FK writes changed unrelated records');
    });
  }],
  ['repository/update-and-lead-conversion-preserve-legacy-metadata', async () => {
    await erase();
    await useDatabase(async (db, repo) => {
      const row = {...fixture().parties[0], legacy_custom: {value: 'preserved'}};
      delete row.owner_id; delete row.source_id;
      await write(db, {parties: [row]});
      const {PartyService} = await import('../js/modules/relationships/party-service.js');
      await new PartyService(repo).convertLead(row.id);
      const converted = await repo.get('parties', row.id);
      equal(converted.legacy_custom, row.legacy_custom, 'Conversion dropped legacy metadata');
      assert(converted.lifecycle === 'CUSTOMER' && converted.created_at === row.created_at, 'Conversion changed identity/timestamp');
      await repo.update('parties', row.id, {notes: 'Updated note'});
      const updated = await repo.get('parties', row.id);
      equal(updated.legacy_custom, row.legacy_custom, 'Partial update dropped metadata');
      assert(updated.display_name === row.display_name && updated.notes === 'Updated note', 'Partial update lost unchanged field');
      await expectPreserved(db, () => repo.save('projects', {name: 'Unknown new field', custom: 'bad'}), 'Unknown new input must reject');
    });
  }],
  ['repository/safe-delete-static-and-polymorphic', async () => {
    await erase();
    await useDatabase(async (db, repo) => {
      assert(typeof repo.delete === 'function', 'Repository.delete API missing');
      const party = await repo.save('parties', {display_name: 'Protected', party_type: 'PERSON', lifecycle: 'LEAD'});
      const project = await repo.save('projects', {party_id: party.id, name: 'Linked'});
      await expectPreserved(db, () => repo.delete('parties', party.id), 'Referenced Party must not delete');
      const activity = await repo.save('activity_items', {subject: 'Audit'});
      const link = await repo.save('activity_links', {activity_id: activity.id, target_entity: 'projects', target_id: project.id});
      await expectPreserved(db, () => repo.delete('projects', project.id), 'Polymorphic target must not delete');
      await repo.delete('activity_links', link.id);
      await repo.delete('projects', project.id);
      await repo.delete('parties', party.id);
      assert(!(await repo.get('projects', project.id)) && !(await repo.get('parties', party.id)), 'Detached record was not deleted');
    });
  }],
  ['backup/v2-round-trip-all-96-records', async () => {
    await erase();
    let exported;
    const records = fixture();
    await useDatabase(async db => {
      await write(db, records);
      exported = JSON.parse(await (await exportBackup(db, schema)).text());
      assert(exported.format === 'BOBC-CRM-BACKUP' && exported.schemaVersion === 2 && exported.backupVersion === 2, 'Modern backup metadata missing');
      assert(exported.validation?.passed === true, 'Valid snapshot marked invalid');
      equal(exported.records, records, 'Export altered record content');
    });
    await erase();
    await useDatabase(async db => {
      await restoreBackup(db, schema, JSON.stringify(exported));
      equal(await snapshot(db), records, 'Clean import differs from export');
    });
  }],
  ['backup/emergency-corrupt-snapshot-preserved-restore-still-rejects', async () => {
    await erase();
    await useDatabase(async db => {
      const corrupt = fixture(); corrupt.projects[0].party_id = 'historical-missing-party';
      await write(db, corrupt);
      let notice;
      const exported = JSON.parse(await (await exportBackup(db, schema, value => { notice = value; })).text());
      equal(exported.records, corrupt, 'Emergency export discarded historical record bytes');
      assert(exported.validation?.passed === false && typeof exported.validation.error === 'string', 'Corrupt snapshot lacks warning metadata');
      assert(notice?.passed === false, 'Export caller did not receive validation warning');
      const valid = fixture(); await write(db, valid);
      await expectPreserved(db, () => restoreBackup(db, schema, JSON.stringify(exported)), 'Emergency backup with broken refs must not restore');
      exported.validation = {passed: true};
      await expectPreserved(db, () => restoreBackup(db, schema, JSON.stringify(exported)), 'Forged validation metadata must not bypass validation');
      const original = db.transaction.bind(db);
      db.transaction = function (...args) {
        const tx = original(...args), objectStore = tx.objectStore.bind(tx);
        tx.objectStore = function (name) {
          const store = objectStore(name);
          if (name === 'projects') store.getAll = () => { throw new DOMException('Injected read failure', 'InvalidStateError'); };
          return store;
        };
        return tx;
      };
      try { await mustReject(() => exportBackup(db, schema), 'Storage read errors must reject export'); }
      finally { db.transaction = original; }
      equal(await snapshot(db), valid, 'Export read failure altered records');
    });
  }],
  ['backup/single-consistent-snapshot-during-concurrent-write', async () => {
    await erase();
    await useDatabase(async db => {
      const records = fixture(); await write(db, records);
      const original = db.transaction.bind(db);
      let armed = true, writeDone;
      db.transaction = function (...args) {
        const tx = original(...args);
        if (armed && (args[1] || 'readonly') === 'readonly') {
          armed = false;
          tx.addEventListener('complete', () => {
            const updates = {dashboards: [{...records.dashboards[0], name: 'snapshot-new'}], module_suppliers: [{...records.module_suppliers[0], label: 'snapshot-new'}]};
            writeDone = write(db, updates);
          }, {once: true});
        }
        return tx;
      };
      let output;
      try { output = JSON.parse(await (await exportBackup(db, schema)).text()); } finally { db.transaction = original; }
      if (writeDone) await writeDone;
      equal(output.records.dashboards[0].name, output.records.module_suppliers[0].label, 'Export mixed old/new transaction states');
      assert(output.records.dashboards[0].name === 'snapshot-old', 'Snapshot should predate queued writer');
    });
  }],
  ['backup/legacy51-v1-into-empty-v2', async () => {
    await erase();
    const records = fixture(Object.keys(base));
    await useDatabase(async db => {
      await restoreBackup(db, schema, JSON.stringify(legacy(records)));
      const expected = {...emptyRecords(), ...records};
      equal(await snapshot(db), expected, 'Original 51-store backup not preserved');
    });
  }],
  ['backup/transitional96-schemaVersion1-accepted', async () => {
    await erase();
    const records = fixture();
    await useDatabase(async db => {
      await restoreBackup(db, schema, JSON.stringify(legacy(records)));
      equal(await snapshot(db), records, 'v0.4 old exporter 96-store backup incompatible');
    });
  }],
  ['backup/legacy-numeric-string-fields-preserved-exactly', async () => {
    await erase();
    const records = fixture();
    records.project_phases[0].sort_order = 0;
    records.expense_items[0].quantity = 1.25;
    records.stock_count_lines[0].expected_quantity = 3.5;
    records.stock_count_lines[0].counted_quantity = 3;
    records.budget_versions[0].version_number = 2;
    await useDatabase(async db => {
      await restoreBackup(db, schema, JSON.stringify(legacy(records)));
      const output = JSON.parse(await (await exportBackup(db, schema)).text());
      equal(output.records, records, 'Legacy numeric fields changed during import/export');
    });
  }],
  ['backup/legacy51-cannot-discard-existing-extension-data', async () => {
    await erase();
    await useDatabase(async db => {
      await write(db, fixture());
      await expectPreserved(db, () => restoreBackup(db, schema, JSON.stringify(legacy(fixture(Object.keys(base))))), 'Legacy51 must not discard extension records');
    });
  }],
  ['backup/invalid-partial-corrupt-duplicate-malformed-unknown-preserved', async () => {
    await erase();
    await useDatabase(async db => {
      const records = fixture(); await write(db, records);
      const variants = [
        ['invalid JSON', '{'],
        ['wrong format', {...modern(records), format: 'OTHER'}],
        ['future version', {...modern(records), schemaVersion: 3}],
        ['unsupported backup version', {...modern(records), backupVersion: 999}],
        ['partial tables', modern({parties: records.parties})],
        ['non-array table', modern({...records, projects: {}})],
        ['null table', modern({...records, projects: null})],
        ['duplicate ID', modern({...records, parties: [records.parties[0], records.parties[0]]})],
        ['missing ID', modern({...records, projects: [{}]})],
        ['non-string ID', modern({...records, projects: [{id: 123}]})],
        ['null row', modern({...records, projects: [null]})],
        ['array row', modern({...records, projects: [[]]})],
        ['unknown table', modern({...records, unexpected_table: []})],
        ['broken FK', modern({...records, projects: [{id: 'broken', party_id: 'absent'}]})],
        ['fractional money', modern({...records, expenses: [{...records.expenses[0], amount_minor: 0.25}]})],
        ['wrong string type', modern({...records, projects: [{...records.projects[0], name: {unsafe: true}}]})],
        ['invalid Party', modern({...records, parties: [{...records.parties[0], lifecycle: 'MADE-UP'}]})],
      ];
      for (const [name, data] of variants) await expectPreserved(db, () => restoreBackup(db, schema, typeof data === 'string' ? data : JSON.stringify(data)), `${name} must reject`);
    });
  }],
  ['backup/mid-write-failure-rolls-back-clear-and-put', async () => {
    await erase();
    await useDatabase(async db => {
      await write(db, fixture());
      const replacement = fixture(); replacement.parties[0].display_name = 'Must roll back';
      const original = db.transaction.bind(db);
      let injected = false;
      db.transaction = function (...args) {
        const tx = original(...args);
        if (args[1] === 'readwrite' && !injected) {
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = function (name) {
            const store = objectStore(name);
            if (name === 'projects') {
              store.put = () => { injected = true; throw new DOMException('Injected late failure', 'DataCloneError'); };
            }
            return store;
          };
        }
        return tx;
      };
      try {
        await expectPreserved(db, () => restoreBackup(db, schema, JSON.stringify(modern(replacement))), 'Late write error must roll back restore');
        assert(injected, 'Failure injection did not reach restore writes');
      } finally { db.transaction = original; }
    });
  }],
  ['indexeddb/readwrite-transaction-abort-rolls-back', async () => {
    await erase();
    await useDatabase(async db => {
      await write(db, fixture());
      const before = await snapshot(db);
      const tx = db.transaction(['parties', 'projects'], 'readwrite');
      const done = transactionFinished(tx);
      tx.objectStore('parties').clear();
      tx.objectStore('projects').put({id: 'rolled-back', name: 'Never committed'});
      tx.abort();
      await mustReject(() => done, 'Abort must reject transaction promise');
      equal(await snapshot(db), before, 'Aborted transaction altered stored data');
    });
  }],
  ['indexeddb/close-reopen-persistence', async () => {
    await erase();
    const records = fixture();
    await useDatabase(db => write(db, records));
    await useDatabase(async db => equal(await snapshot(db), records, 'Records lost after connection reopen'));
  }],
];

async function runCore() {
  const results = [];
  for (const [name, run] of cases) {
    const started = performance.now();
    try { await run(); results.push({name, passed: true, durationMs: Math.round(performance.now() - started)}); }
    catch (error) { results.push({name, passed: false, error: error.stack || String(error), durationMs: Math.round(performance.now() - started)}); }
    console.info('BOBC_QA ' + JSON.stringify(results.at(-1)));
  }
  await erase();
  return results;
}

window.qa = {
  runCore, seedV1, erase,
  closeHeld: () => { if (held) { held.close(); held = null; } },
  async blockedUpgrade() {
    await mustReject(() => openDatabase(schema), 'Blocked upgrade must report failure');
    return true;
  },
  async verifyPostBlocked() {
    // Delete proves the rejected upgrade did not leave a late successful connection.
    await erase();
    return useDatabase(db => ({version: db.version, stores: db.objectStoreNames.length}));
  },
  async verifyInterruptedUpgrade() {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error('Interrupted upgrade left a blocking connection'));
    });
    const state = {version: db.version, stores: db.objectStoreNames.length};
    const tx = db.transaction(Object.keys(base), 'readonly');
    const done = transactionFinished(tx);
    const before = fixture(Object.keys(base));
    await Promise.all(Object.keys(base).map(async t => equal(await requestResult(tx.objectStore(t).getAll()), before[t], `${t}: blocked upgrade changed legacy rows`)));
    await done;
    db.close();
    return state;
  },
  async holdManaged() { await erase(); held = await openDatabase(schema); return held.version; },
  async bumpVersion() {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 3);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(Error('Managed connection did not close on versionchange'));
    });
    const version = db.version; db.close(); return version;
  },
  heldClosed() {
    try { held.transaction('parties'); return false; } catch (e) { return e.name === 'InvalidStateError'; }
  },
};
