// js/persist-worker.js

/**
 * @fileoverview
 * Web Worker для асинхронного управления состоянием и его сохранения в IndexedDB.
 * Хранит собственную копию состояния, чтобы минимизировать передачу данных из основного потока.
 */

const DB_NAME = 'drawingBoardDB';
const STORE_NAME = 'boardState';
const DB_VERSION = 1;
const KEY = 'latestState';

// --- НАЧАЛО ИЗМЕНЕНИЙ: Воркер теперь хранит состояние ---
let workerState = null;
// --- КОНЕЦ ИЗМЕНЕНИЙ ---

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
 * Очищает и сохраняет полное состояние в IndexedDB.
 * @param {object} state - Полный объект состояния для сохранения.
 */
async function saveFullStateToDB(state) {
    if (!state) return;
    try {
        // Очистка данных от несериализуемых полей
        const cleanLayers = state.layers.map(layer => {
            const newLayer = { ...layer };
            delete newLayer.image;
            delete newLayer.pdfDoc;
            delete newLayer.renderedPages;
            return newLayer;
        });

        const stateToSave = {
            viewState: state.viewState,
            layers: cleanLayers,
        };

        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(stateToSave, KEY);

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });

    } catch (error) {
        console.error('Ошибка сохранения полного состояния в Worker:', error);
    }
}


/**
 * Основной обработчик сообщений от главного потока.
 * Теперь он различает типы сообщений: 'init' для полной загрузки и 'update' для патчей.
 */
self.onmessage = async (event) => {
    const { type, payload } = event.data;

    if (type === 'init') {
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Инициализация состояния в воркере ---
        workerState = payload;
        // При инициализации сразу сохраняем полное состояние
        await saveFullStateToDB(workerState);
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    } else if (type === 'update') {
        // --- НАЧАЛО ИЗМЕНЕНИЙ: Применение инкрементальных обновлений ---
        if (!workerState) {
            console.error('Worker не инициализирован, но получил команду на обновление.');
            return;
        }

        const { changes, viewState } = payload;
        
        // Обновляем viewState
        workerState.viewState = viewState;

        // Применяем изменения к слоям
        if (changes) {
            const layerMap = new Map(workerState.layers.map(l => [l.id, l]));
            
            // 1. Удаления
            if (changes.deleted) {
                changes.deleted.forEach(id => layerMap.delete(id));
            }
            // 2. Обновления
            if (changes.updated) {
                changes.updated.forEach(layer => layerMap.set(layer.id, layer));
            }
            // 3. Создания
            if (changes.created) {
                changes.created.forEach(layer => layerMap.set(layer.id, layer));
            }
            
            workerState.layers = Array.from(layerMap.values());
        }

        // После применения патча сохраняем полное актуальное состояние
        await saveFullStateToDB(workerState);
        // --- КОНЕЦ ИЗМЕНЕНИЙ ---
    }
};