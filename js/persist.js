// js/persist.js

/**
 * @fileoverview
 * Модуль для асинхронного сохранения состояния доски в IndexedDB через Web Worker.
 * Это позволяет избежать блокировки основного потока при работе с большими объемами данных.
 */

// --- НАЧАЛО ИЗМЕНЕНИЙ: Создаем единственный экземпляр Worker'а ---
let persistenceWorker = null;

// Инициализируем Worker при загрузке модуля.
if (window.Worker) {
    try {
        persistenceWorker = new Worker('./js/persist-worker.js');
        persistenceWorker.onerror = (e) => {
            console.error('Ошибка в Web Worker для сохранения:', e);
        };
    } catch (e) {
        console.error('Не удалось создать Web Worker. Сохранение будет происходить в основном потоке.', e);
    }
} else {
    console.warn('Web Workers не поддерживаются. Сохранение может вызывать "лаги".');
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

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

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// --- НАЧАЛО ИЗМЕНЕНИЙ: Обновляем функцию сохранения ---

/**
 * Отправляет объект состояния в Web Worker для сохранения в IndexedDB.
 * НЕ выполняет клонирование в основном потоке, чтобы избежать блокировок UI.
 * @param {object} state - Объект состояния для сохранения (viewState и layers).
 * @returns {void}
 */
export function saveStateToDB(state) {
  if (persistenceWorker) {
    // Просто отправляем данные "как есть". Вся тяжелая работа будет в Worker'е.
    persistenceWorker.postMessage(state);
  } else {
    // Fallback, если Worker не поддерживается или не создался.
    // Это может вызывать "лаги", но сохранит работоспособность.
    console.warn('Сохранение выполняется в основном потоке.');
    saveStateDirectly(state);
  }
}

/**
 * Fallback-функция для сохранения напрямую в IndexedDB, если Worker недоступен.
 * @param {object} state - Объект состояния.
 */
async function saveStateDirectly(state) {
    // В этом случае нам всё же придётся очистить данные в основном потоке.
    const cleanState = JSON.parse(JSON.stringify(state));
    let db;
    try {
      db = await openDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(cleanState, KEY);
    } catch (error) {
      console.error('Ошибка прямого сохранения в IndexedDB:', error);
    } finally {
      if (db) db.close();
    }
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---


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