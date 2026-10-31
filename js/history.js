// js/history.js

import { saveStateToDB } from './persist.js?v=1.2.2';
import { cloneLayersForAction } from './utils.js?v=1.2.2';

let history = [];
let historyIndex = -1;
let canvasStateRef = null;
let initialLayersState = [];

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
            rulers: canvasStateRef ? (canvasStateRef.rulers || []) : [],
            stickerLinks: canvasStateRef && canvasStateRef.viewState ? (canvasStateRef.viewState.stickerLinks || []) : [],
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
  if (change.isDiff) {
    (change.created || []).forEach(layer => {
      pendingChanges.created.set(layer.id, layer);
      pendingChanges.deleted.delete(layer.id);
      pendingChanges.updated.delete(layer.id);
    });
    (change.deleted || []).forEach(layer => {
      pendingChanges.deleted.add(layer.id);
      pendingChanges.created.delete(layer.id);
      pendingChanges.updated.delete(layer.id);
    });
    (change.updated || []).forEach(layer => {
      if (!pendingChanges.created.has(layer.id)) {
        pendingChanges.updated.set(layer.id, layer);
      }
    });
    return;
  }

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
      if (canvasStateRef && canvasStateRef.layers) {
        canvasStateRef.layers.forEach(layer => {
          if (!pendingChanges.created.has(layer.id)) {
            pendingChanges.updated.set(layer.id, layer);
          }
        });
      }
      break;
  }
}

export function addHistoryEntry(change) {
  if (historyIndex < history.length - 1) {
    history.splice(historyIndex + 1);
  }
  if (history.length > 200) {
    history.shift();
    // После сдвига индексы уменьшаются на единицу: без этого
    // history[historyIndex] уходит за границу и падает на 201-й записи.
    if (historyIndex >= 0) historyIndex--;
  }

  if (Array.isArray(change)) {
    const prevLayers = (historyIndex >= 0) ? history[historyIndex].fullLayersAfter : initialLayersState;
    const prevMap = new Map(prevLayers.map(l => [l.id, l]));
    const newMap = new Map(change.map(l => [l.id, l]));
    
    const created = [];
    const updated = [];
    const deleted = [];
    
    for (const [id, layer] of newMap) {
        if (!prevMap.has(id)) {
            created.push(layer);
        } else {
            const prev = prevMap.get(id);
            if (JSON.stringify(prev) !== JSON.stringify(layer)) {
                updated.push(layer);
            }
        }
    }
    for (const [id, layer] of prevMap) {
        if (!newMap.has(id)) {
            deleted.push(layer);
        }
    }

    change = {
      type: 'update',
      isDiff: true,
      created,
      updated,
      deleted,
      before: deleted,
      after: [...created, ...updated]
    };
  }

  // Save the full layers state before and after this change
  change.fullLayersAfter = cloneLayersForAction(canvasStateRef.layers);
  change.fullLayersBefore = (historyIndex >= 0) ? history[historyIndex].fullLayersAfter : initialLayersState;

  history.push(change);
  historyIndex = history.length - 1;

  addChangeToPending(change);
  _scheduleDBUpdate();
}

export function scheduleDirectDBUpdate() {
  _scheduleDBUpdate();
}

export function flushDBUpdate() {
  if (_dbSaveTimer) {
    clearTimeout(_dbSaveTimer);
    _dbSaveTimer = null;
    
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
          rulers: canvasStateRef ? (canvasStateRef.rulers || []) : [],
          stickerLinks: canvasStateRef && canvasStateRef.viewState ? (canvasStateRef.viewState.stickerLinks || []) : [],
        },
      };

      saveStateToDB({ type: 'update', payload });

      pendingChanges = {
        updated: new Map(),
        created: new Map(),
        deleted: new Set(),
      };
    } catch (e) {
      console.error('Не удалось отправить обновления при выгрузке:', e);
    }
  }
}

window.addEventListener('beforeunload', flushDBUpdate);

export function undo(currentLayers) {
  if (!canUndo()) return { layers: null, selectedIds: [] };

  const change = history[historyIndex];
  historyIndex--;

  const newLayers = cloneLayersForAction(change.fullLayersBefore);

  // --- TILE MANAGER UPDATE ---
  if (canvasStateRef && canvasStateRef.tileManager) {
    canvasStateRef.tileManager.clear();
  }
  // ---------------------------

  const reverseChange = change.isDiff ? {
    isDiff: true,
    created: cloneLayersForAction(change.deleted),
    deleted: cloneLayersForAction(change.created),
    updated: cloneLayersForAction(change.updated).map(layer => {
      return change.fullLayersBefore.find(l => l.id === layer.id) || layer;
    })
  } : {
    type: change.type === 'creation' ? 'deletion' : (change.type === 'deletion' ? 'creation' : change.type),
    before: change.after,
    after: change.before
  };
  addChangeToPending(reverseChange);
  _scheduleDBUpdate();

  const selectedIds = (change.before || []).map(l => l.id);
  return { layers: newLayers, selectedIds };
}

export function redo(currentLayers) {
  if (!canRedo()) return { layers: null, selectedIds: [] };

  historyIndex++;
  const change = history[historyIndex];

  const newLayers = cloneLayersForAction(change.fullLayersAfter);

  // --- TILE MANAGER UPDATE ---
  if (canvasStateRef && canvasStateRef.tileManager) {
    canvasStateRef.tileManager.clear();
  }
  // ---------------------------

  addChangeToPending(change);
  _scheduleDBUpdate();

  return { layers: newLayers, selectedIds: [] };
}

export function canUndo() { return historyIndex >= 0; }
export function canRedo() { return historyIndex < history.length - 1; }

export function resetHistory() {
  history.length = 0;
  historyIndex = -1;
  initialLayersState = [];
  pendingChanges = { updated: new Map(), created: new Map(), deleted: new Set() };
}

export function initHistory(cs, initialLayers = []) {
  setCanvasStateRef(cs);
  resetHistory();
  initialLayersState = cloneLayersForAction(initialLayers);

  const initialState = {
    viewState: {
      panX: cs ? cs.panX : 0,
      panY: cs ? cs.panY : 0,
      zoom: cs ? cs.zoom : 1,
      rulers: cs ? (cs.rulers || []) : [],
      stickerLinks: cs && cs.viewState ? (cs.viewState.stickerLinks || []) : [],
    },
    layers: initialLayers,
  };
  saveStateToDB({ type: 'init', payload: initialState });
}