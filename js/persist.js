// --- START OF FILE js/persist.js ---

// js/persist.js

/**
 * @fileoverview
 * Модуль для асинхронного сохранения состояния доски в IndexedDB через Web Worker.
 * Это позволяет избежать блокировки основного потока при работе с большими объемами данных.
 */

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

// --- НАЧАЛО ИЗМЕНЕНИЙ: Улучшенная функция очистки ---

/**
 * Очищает один слой от несериализуемых данных (DOM-элементов).
 */
function cleanLayer(layer) {
    const newLayer = { ...layer };
    // Удаляем ссылки на DOM-элементы, которые нельзя передать в Worker
    delete newLayer.image;
    delete newLayer.pdfDoc;
    delete newLayer.renderedPages;
    delete newLayer.cachedImage; // Важно для Text Layer (Rich Text)
    delete newLayer.isGeneratingImage;
    return newLayer;
}

/**
 * Рекурсивно очищает состояние или патч изменений перед отправкой в Worker.
 * Обрабатывает и полный state.layers, и state.changes (updated/created).
 */
function cleanStateForWorker(state) {
    if (!state) return state;
    
    const cleanState = { ...state };
    
    // 1. Сценарий полной инициализации (имеет массив layers)
    if (cleanState.layers && Array.isArray(cleanState.layers)) {
        cleanState.layers = cleanState.layers.map(cleanLayer);
    }
    
    // 2. Сценарий инкрементального обновления (имеет объект changes)
    if (cleanState.changes) {
        cleanState.changes = { ...cleanState.changes };
        
        if (cleanState.changes.updated && Array.isArray(cleanState.changes.updated)) {
            cleanState.changes.updated = cleanState.changes.updated.map(cleanLayer);
        }
        
        if (cleanState.changes.created && Array.isArray(cleanState.changes.created)) {
            cleanState.changes.created = cleanState.changes.created.map(cleanLayer);
        }
        
        // changes.deleted обычно содержит ID, очистка не требуется
    }
    
    return cleanState;
}
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

/**
 * Отправляет объект состояния в Web Worker для сохранения в IndexedDB.
 * @param {object} state - Объект состояния или сообщение обновления.
 */
export function saveStateToDB(state) {
  if (persistenceWorker) {
    // Определяем, что именно мы отправляем (полный инит или патч)
    // state может быть вида { type: 'init', payload: ... } или { type: 'update', payload: ... }
    
    let message;
    
    if (state.type && state.payload) {
        // Очищаем payload внутри сообщения
        const cleanPayload = cleanStateForWorker(state.payload);
        message = { type: state.type, payload: cleanPayload };
    } else {
        // Fallback, если структура другая (напрямую передан state)
        message = cleanStateForWorker(state);
    }
    
    try {
        persistenceWorker.postMessage(message);
    } catch (e) {
        console.error("Ошибка отправки в Worker (DataCloneError fixed):", e);
    }
  } else {
    // Fallback для основного потока
    console.warn('Сохранение выполняется в основном потоке.');
    saveStateDirectly(state);
  }
}

async function saveStateDirectly(state) {
    const payload = state.type === 'update' || state.type === 'init' ? state.payload : state;
    const cleanState = JSON.parse(JSON.stringify(cleanStateForWorker(payload)));
    
    let db;
    try {
      db = await openDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      // При прямом сохранении мы всегда сохраняем полный слепок, 
      // так как у нас нет логики мерджа патчей в основном потоке (она в воркере).
      // Но если воркер упал, это лучше чем ничего, хотя инкрементальные апдейты тут не сработают как надо.
      // В идеале fallback должен тоже уметь мерджить, но для простоты просто сохраняем то что есть,
      // если это полный state.
      if (cleanState.layers) {
          store.put(cleanState, KEY);
      }
    } catch (error) {
      console.error('Ошибка прямого сохранения в IndexedDB:', error);
    } finally {
      if (db) db.close();
    }
}

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