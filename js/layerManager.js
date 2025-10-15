/**
 * Перемещает выбранные слои на один уровень вперед (выше).
 * @param {Array} layers - Полный массив слоев.
 * @param {Array} selectedLayers - Массив выбранных слоев.
 * @returns {Array} - Новый, отсортированный массив слоев.
 */
export function bringForward(layers, selectedLayers) {
    const selectedIds = new Set(selectedLayers.map(l => l.id));
    const newLayers = [...layers];

    // Идем с конца, чтобы не нарушать индексы при перемещении
    for (let i = newLayers.length - 2; i >= 0; i--) {
        const currentLayer = newLayers[i];
        const nextLayer = newLayers[i + 1];
        if (selectedIds.has(currentLayer.id) && !selectedIds.has(nextLayer.id)) {
            // Меняем местами
            [newLayers[i], newLayers[i + 1]] = [newLayers[i + 1], newLayers[i]];
        }
    }
    return newLayers;
}

/**
 * Перемещает выбранные слои на один уровень назад (ниже).
 * @param {Array} layers - Полный массив слоев.
 * @param {Array} selectedLayers - Массив выбранных слоев.
 * @returns {Array} - Новый, отсортированный массив слоев.
 */
export function sendBackward(layers, selectedLayers) {
    const selectedIds = new Set(selectedLayers.map(l => l.id));
    const newLayers = [...layers];

    // Идем с начала
    for (let i = 1; i < newLayers.length; i++) {
        const currentLayer = newLayers[i];
        const prevLayer = newLayers[i - 1];
        if (selectedIds.has(currentLayer.id) && !selectedIds.has(prevLayer.id)) {
            // Меняем местами
            [newLayers[i], newLayers[i - 1]] = [newLayers[i - 1], newLayers[i]];
        }
    }
    return newLayers;
}

/**
 * Перемещает выбранные слои на самый передний план.
 * @param {Array} layers - Полный массив слоев.
 * @param {Array} selectedLayers - Массив выбранных слоев.
 * @returns {Array} - Новый, отсортированный массив слоев.
 */
export function bringToFront(layers, selectedLayers) {
    const selectedIds = new Set(selectedLayers.map(l => l.id));
    const layersToMove = [];
    const otherLayers = [];

    layers.forEach(layer => {
        if (selectedIds.has(layer.id)) {
            layersToMove.push(layer);
        } else {
            otherLayers.push(layer);
        }
    });

    return [...otherLayers, ...layersToMove];
}

/**
 * Перемещает выбранные слои на самый задний план.
 * @param {Array} layers - Полный массив слоев.
 * @param {Array} selectedLayers - Массив выбранных слоев.
 * @returns {Array} - Новый, отсортированный массив слоев.
 */
export function sendToBack(layers, selectedLayers) {
    const selectedIds = new Set(selectedLayers.map(l => l.id));
    const layersToMove = [];
    const otherLayers = [];

    layers.forEach(layer => {
        if (selectedIds.has(layer.id)) {
            layersToMove.push(layer);
        } else {
            otherLayers.push(layer);
        }
    });

    return [...layersToMove, ...otherLayers];
}