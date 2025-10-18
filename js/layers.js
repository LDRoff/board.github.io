let layers = [];
let currentLayerIndex = 0;

function addLayer() {
  layers.push({
    elements: [],
    visible: true
  });
  currentLayerIndex = layers.length - 1;
  console.log('Новый слой добавлен');
}

// Создадим первый слой
addLayer();