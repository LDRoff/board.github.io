// js/history.js

import { saveStateToDB } from './persist.js';
import { cloneLayersForAction } from './utils.js';

let history = [];
let historyIndex = -1;
let canvasStateRef = null;

let pendingChanges = {
    updated: new Map(),
    created: new Map(),
    deleted: new Set(),
};

export function setCanvasStateRef(ref) { canvasStateRef = ref; }

const _ric = (typeof window !== 'undefined' && window.requestIdleCallback)
  ? window.requestIdleCallback
  : (cb) => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 0);

let _dbSaveTimer = null;

function _scheduleDBUpdate() {
  if (_dbSaveTimer) clearTimeout(_dbSaveTimer);

  _dbSaveTimer = setTimeout(() => {
    _ric(() => {
      try {
        const payload = {
          changes: {
            updated: Array.from(pendingChanges.updated.values()),
            created: Array.from(pendingChanges.created.values()),
            deleted: Array.from(pendingChanges.deleted),
          },
          viewState: {
            panX: canvasStateRef ? canvasStateRef.panX : 0,
            panY: canvasStateRef ? canvasStateRef.panY : 0,
            zoom: canvasStateRef ? canvasStateRef.zoom : 1,
          },
        };
        
        saveStateToDB({ type: 'update', payload });
        
        pendingChanges = {
            updated: new Map(),
            created: new Map(),
            deleted: new Set(),
        };
      } catch (e) {
        console.error('Не удалось запланировать отправку обновлений:', e);
      }
    });
  }, 1000);
}

function addChangeToPending(change) {
    switch (change.type) {
        case 'creation':
            (change.after || []).forEach(layer => {
                pendingChanges.created.set(layer.id, layer);
                pendingChanges.deleted.delete(layer.id);
                pendingChanges.updated.delete(layer.id);
            });
            break;
        case 'deletion':
            (change.before || []).forEach(layer => {
                pendingChanges.deleted.add(layer.id);
                pendingChanges.created.delete(layer.id);
                pendingChanges.updated.delete(layer.id);
            });
            break;
        case 'update':
            (change.after || []).forEach(layer => {
                if (!pendingChanges.created.has(layer.id)) {
                    pendingChanges.updated.set(layer.id, layer);
                }
            });
            break;
        case 'reorder':
            canvasStateRef.layers.forEach(layer => {
                if (!pendingChanges.created.has(layer.id)) {
                    pendingChanges.updated.set(layer.id, layer);
                }
            });
            break;
      }
}

export function addHistoryEntry(change) {
  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  if (history.length > 200) {
    history.shift();
  }
  history.push(change);
  historyIndex = history.length - 1;
  
  addChangeToPending(change);
  _scheduleDBUpdate();
}

export function scheduleDirectDBUpdate() {
    _scheduleDBUpdate();
}

export function undo(currentLayers) {
    if (!canUndo()) return { layers: null, selectedIds: [] };

    const change = history[historyIndex];
    historyIndex--;

    const { newLayers, selectedIds } = applyChange(currentLayers, change, true);
    
    const reverseChange = {
        type: change.type === 'creation' ? 'deletion' : (change.type === 'deletion' ? 'creation' : change.type),
        before: change.after,
        after: change.before
    };
    addChangeToPending(reverseChange);
    _scheduleDBUpdate();

    return { layers: newLayers, selectedIds };
}

export function redo(currentLayers) {
    if (!canRedo()) return { layers: null, selectedIds: [] };
    
    historyIndex++;
    const change = history[historyIndex];

    // --- НАЧАЛО ИЗМЕНЕНИЙ ---
    // Применяем изменение, но игнорируем возвращаемый selectedIds.
    // Redo не должно приводить к выделению объектов.
    const { newLayers } = applyChange(currentLayers, change, false);

    addChangeToPending(change);
    _scheduleDBUpdate();
    
    // Возвращаем пустой массив для selectedIds, чтобы ничего не выделялось.
    return { layers: newLayers, selectedIds: [] };
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---
}

function applyChange(layers, change, isUndo) {
    const sourceState = isUndo ? change.before : change.after;
    const targetState = isUndo ? change.after : change.before;

    if (change.type === 'reorder') {
        const selectedIds = (isUndo ? change.before : change.after).map(l => l.id);
        return { newLayers: cloneLayersForAction(isUndo ? change.before : change.after), selectedIds };
    }
    
    const targetIds = new Set((targetState || []).map(l => l.id));
    let newLayers = layers.filter(l => !targetIds.has(l.id));
    newLayers.push(...cloneLayersForAction(sourceState || []));

    const selectedIds = (sourceState || []).map(l => l.id);
    return { newLayers, selectedIds };
}

export function canUndo() { return historyIndex >= 0; }
export function canRedo() { return historyIndex < history.length - 1; }

export function resetHistory() {
  history.length = 0;
  historyIndex = -1;
  pendingChanges = { updated: new Map(), created: new Map(), deleted: new Set() };
}

export function initHistory(cs, initialLayers = []) {
  setCanvasStateRef(cs);
  resetHistory();
  
  const initialState = {
    viewState: {
      panX: cs ? cs.panX : 0,
      panY: cs ? cs.panY : 0,
      zoom: cs ? cs.zoom : 1,
    },
    layers: initialLayers,
  };
  saveStateToDB({ type: 'init', payload: initialState });
}