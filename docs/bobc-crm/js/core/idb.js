import {DB_NAME, DB_VERSION} from './schema.js';

export const requestResult = req => new Promise((resolve, reject) => {
 req.onsuccess = () => resolve(req.result);
 req.onerror = () => reject(req.error);
});

export const transactionFinished = tx => new Promise((resolve, reject) => {
 tx.oncomplete = () => resolve();
 tx.onabort = () => reject(tx.error || Error('Transacción cancelada'));
 tx.onerror = () => reject(tx.error || Error('Transacción fallida'));
});

export function openDatabase(entities) {
 return new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  let rejected = false;
  const fail = error => {
   rejected = true;
   reject(error);
  };

  request.onupgradeneeded = () => {
   const db = request.result, tx = request.transaction;
   // A blocked request remains pending after rejection; cancel its eventual upgrade.
   if (rejected) {
    tx.abort();
    return;
   }
   try {
    for (const [name, entity] of Object.entries(entities)) {
     const store = db.objectStoreNames.contains(name)
      ? tx.objectStore(name)
      : db.createObjectStore(name, {keyPath: 'id'});
     const indices = new Set([...Object.keys(entity.references || {}), 'created_at', 'updated_at']);
     for (const key of indices) {
      if (key !== 'id' && !store.indexNames.contains(key)) store.createIndex(key, key);
     }
    }
   } catch (error) {
    tx.abort();
    fail(error);
   }
  };
  request.onblocked = () => fail(Error('Cierra otras pestañas del CRM y vuelve a intentar'));
  request.onerror = () => fail(request.error);
  request.onsuccess = () => {
   const db = request.result;
   if (rejected) {
    db.close();
    return;
   }
   db.onversionchange = () => db.close();
   resolve(db);
  };
 });
}

export const readOne = (db, table, id) => requestResult(db.transaction(table, 'readonly').objectStore(table).get(id));
export const readAll = (db, table) => requestResult(db.transaction(table, 'readonly').objectStore(table).getAll());
