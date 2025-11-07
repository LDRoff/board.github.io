// --- START OF FILE js/persist-worker.js ---

/**
 * @fileoverview
 * Этот код выполняется в отдельном потоке (Web Worker).
 * Его задача - получать УЖЕ ОЧИЩЕННЫЕ данные от основного потока
 * и сохранять их в IndexedDB, не блокируя пользовательский интерфейс.
 */

const DB_NAME = 'drawingBoardDB';
const STORE_NAME = 'boardState';
const DB_VERSION = 1;
const KEY = 'latestState';

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = self.indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(new Error('Не удалось открыть IndexedDB в Worker.'));
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
    return dbPromise;
}

/**
 * Основной обработчик сообщений от главного потока.
 */
self.onmessage = async (event) => {
    // --- НАЧАЛО ИЗМЕНЕНИЙ: Получаем чистый объект, готовый к сохранению ---
    const stateToSave = event.data;
    if (!stateToSave || !stateToSave.layers) return;

    try {
        // Задача Worker'а теперь предельно проста - только сохранить.
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(stateToSave, KEY);

        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });

    } catch (error) {
        console.error('Ошибка сохранения в Worker:', error);
    }
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
};
// --- END OF FILE js/persist-worker.js ---