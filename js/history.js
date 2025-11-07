import { saveStateToDB } from './persist.js';
import { cloneLayersForAction } from './utils.js';

let history = [];
let historyIndex = -1;
let canvasStateRef = null;

export function setCanvasStateRef(ref) { canvasStateRef = ref; }

const _ric = (typeof window !== 'undefined' && window.requestIdleCallback)
  ? window.requestIdleCallback
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 0);

let _dbSaveTimer = null;

/**
 * Внутренняя функция, которая планирует обновление состояния в IndexedDB.
 * Вызывается как при действиях пользователя, так и при изменении вида (зум/пан).
 * @param {Array} layers - Полный массив слоев для сохранения.
 */
function _scheduleDBUpdate(layers) {
  if (_dbSaveTimer) clearTimeout(_dbSaveTimer);

  _dbSaveTimer = setTimeout(() => {
    _ric(() => {
      try {
        const dataToSave = {
          viewState: {
            panX: canvasStateRef ? canvasStateRef.panX : 0,
            panY: canvasStateRef ? canvasStateRef.panY : 0,
            zoom: canvasStateRef ? canvasStateRef.zoom : 1,
          },
          layers: cloneLayersForAction(layers),
        };
        saveStateToDB(dataToSave);
      } catch (e) {
        console.error('Не удалось запланировать сохранение состояния доски:', e);
      }
    });
  }, 1000);
}

/**
 * Добавляет новую запись об изменении в историю и планирует сохранение в БД.
 * @param {object} change - Объект, описывающий изменение.
 * @param {Array} currentLayers - Текущее полное состояние слоев.
 */
export function addHistoryEntry(change, currentLayers) {
  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  if (history.length > 200) {
    history.shift();
  }
  history.push(change);
  historyIndex = history.length - 1;
  
  _scheduleDBUpdate(currentLayers);
}

/**
 * Экспортируемая функция для сохранения только ViewState без изменения истории.
 * @param {Array} currentLayers - Текущее полное состояние слоев.
 */
export function scheduleDirectDBUpdate(currentLayers) {
    _scheduleDBUpdate(currentLayers);
}

/**
 * Применяет отмену последнего действия.
 * @param {Array} currentLayers - Текущий массив слоев.
 * @returns {{layers: Array|null, selectedIds: Array}} Новый массив слоев и ID выделенных объектов.
 */
export function undo(currentLayers) {
    if (!canUndo()) return { layers: null, selectedIds: [] };

    const change = history[historyIndex];
    historyIndex--;

    const { newLayers, selectedIds } = applyChange(currentLayers, change, true); // true для undo

    _scheduleDBUpdate(newLayers);
    return { layers: newLayers, selectedIds };
}

/**
 * Применяет повтор отмененного действия.
 * @param {Array} currentLayers - Текущий массив слоев.
 * @returns {{layers: Array|null, selectedIds: Array}} Новый массив слоев и ID выделенных объектов.
 */
export function redo(currentLayers) {
    if (!canRedo()) return { layers: null, selectedIds: [] };
    
    historyIndex++;
    const change = history[historyIndex];

    const { newLayers, selectedIds } = applyChange(currentLayers, change, false); // false для redo

    _scheduleDBUpdate(newLayers);
    return { layers: newLayers, selectedIds };
}

/**
 * Упрощенная и более надежная функция для применения изменений (undo/redo).
 * @param {Array} layers - Массив слоев, к которому применяются изменения.
 * @param {object} change - Объект изменения из истории.
 * @param {boolean} isUndo - Флаг, указывающий, является ли операция отменой.
 * @returns {{newLayers: Array, selectedIds: Array}} Новый массив слоев и ID объектов для выделения.
 */
function applyChange(layers, change, isUndo) {
    const sourceState = isUndo ? change.before : change.after;
    const targetState = isUndo ? change.after : change.before;

    if (change.type === 'reorder') {
        const selectedIds = (isUndo ? change.before : change.after).map(l => l.id);
        return { newLayers: cloneLayersForAction(isUndo ? change.before : change.after), selectedIds };
    }
    
    // Гарантируем, что targetState является массивом, даже если он был undefined в "мусорном" объекте
    const targetIds = new Set((targetState || []).map(l => l.id));

    // 1. Отфильтровываем слои, которые были изменены или удалены
    let newLayers = layers.filter(l => !targetIds.has(l.id));

    // 2. Добавляем слои в их новом/восстановленном состоянии
    newLayers.push(...cloneLayersForAction(sourceState || []));

    const selectedIds = (sourceState || []).map(l => l.id);
    return { newLayers, selectedIds };
}

export function canUndo() { return historyIndex >= 0; }
export function canRedo() { return historyIndex < history.length - 1; }

export function resetHistory() {
  history.length = 0;
  historyIndex = -1;
}

export function initHistory(cs, initialLayers = []) {
  setCanvasStateRef(cs);
  resetHistory();
  _scheduleDBUpdate(initialLayers);
}