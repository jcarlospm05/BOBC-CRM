import {DB_VERSION} from './schema.js';
import {requestResult, transactionFinished} from './idb.js';
import {validateBackup} from './backup-validation.js';
export {downloadBlob} from './file-download.js';

// One transaction prevents a concurrent tab from producing a mixed snapshot.
export async function exportBackup(db, schema, onValidation = () => {}) {
  const tables = Object.keys(schema);
  const tx = db.transaction(tables, 'readonly');
  const done = transactionFinished(tx);
  const requests = tables.map(table => requestResult(tx.objectStore(table).getAll()));
  const [rows] = await Promise.all([Promise.all(requests), done]);
  const records = Object.fromEntries(tables.map((table, i) => [table, rows[i]]));
  const data = {
    format: 'BOBC-CRM-BACKUP', backupVersion: 2, schemaVersion: DB_VERSION,
    createdAt: new Date().toISOString(), records
  };
  // Keep an emergency copy even if historical data fails today's stricter rules.
  try {
    await validateBackup(schema, data);
    data.validation = {passed: true};
  } catch (error) {
    data.validation = {passed: false, error: error.message};
  }
  onValidation(data.validation);
  return new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
}

export async function restoreBackup(db, schema, text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Archivo JSON inválido'); }
  // Finish validation before starting any destructive request.
  const {records, legacyMissing} = await validateBackup(schema, data);
  const tables = Object.keys(schema);
  const tx = db.transaction(tables, 'readwrite');
  const done = transactionFinished(tx);
  try {
    // A v1 backup contains no v2 records. Refuse to discard those silently.
    const counts = await Promise.all(legacyMissing.map(table =>
      requestResult(tx.objectStore(table).count())));
    if (counts.some(count => count > 0)) {
      throw new Error('El respaldo v1 no incluye los módulos v2 que contienen datos. Exporta un respaldo v2 y restaura el v1 en una base vacía.');
    }
    for (const table of tables) {
      const store = tx.objectStore(table);
      store.clear();
      for (const record of records[table]) store.put(record);
    }
    await done;
  } catch (error) {
    try { tx.abort(); } catch { /* Already aborted or completed. */ }
    await done.catch(() => {});
    throw error;
  }
}
