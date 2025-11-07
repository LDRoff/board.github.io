// --- START OF FILE js/persist.js ---

/**
 * @fileoverview
 * Модуль для абстракции работы с IndexedDB.
 * Используется для сохранения и загрузки состояния доски,
 * решая проблему с ограничением размера localStorage.
 */

const DB_NAME = 'drawingBoardDB';
const STORE_NAME = 'boardState';
const DB_VERSION = 1;
const KEY = 'latestState';

/**
 * Открывает соединение с IndexedDB.
 * @returns {Promise<IDBDatabase>} Промис, который разрешается объектом базы данных.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Не удалось открыть IndexedDB.'));
    request.onsuccess = () => resolve(request.result);

    // Эта функция вызывается только при создании новой БД или увеличении версии
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Сохраняет снимок состояния доски в IndexedDB.
 * @param {object} state - Объект состояния для сохранения.
 * @returns {Promise<void>}
 */
export async function saveStateToDB(state) {
  let db;
  try {
    db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(state, KEY);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.error('Ошибка сохранения в IndexedDB:', error);
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Загружает последний снимок состояния доски из IndexedDB.
 * @returns {Promise<object|null>} Промис, который разрешается объектом состояния или null.
 */
export async function loadStateFromDB() {
  let db;
  try {
    db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(KEY);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Ошибка загрузки из IndexedDB:', error);
    return null;
  } finally {
    if (db) {
      db.close();
    }
  }
}
// --- END OF FILE js/persist.js ---