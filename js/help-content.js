// --- START OF FILE js/help-content.js ---

const helpContent = {
    "general-panel": `
        <h3>Добро пожаловать!</h3>
        <p>Это краткое руководство поможет вам освоить все возможности интерактивной доски. Используйте меню слева для навигации по разделам.</p>
    `,
    "hotkeys-panel": `
        <h3>Горячие клавиши</h3>
        <h4>Основные комбинации</h4>
        <ul>
            <li><span class="keys"><kbd>Ctrl</kbd> + <kbd>Z</kbd></span><span>Отменить последнее действие</span></li>
            <li><span class="keys"><kbd>Ctrl</kbd> + <kbd>Y</kbd></span><span>Повторить отменённое действие</span></li>
            <li><span class="keys"><kbd>Ctrl</kbd> + <kbd>C</kbd></span><span>Копировать выделенные объекты</span></li>
            <li><span class="keys"><kbd>Ctrl</kbd> + <kbd>X</kbd></span><span>Вырезать выделенные объекты</span></li>
            <li><span class="keys"><kbd>Ctrl</kbd> + <kbd>V</kbd></span><span>Вставить объекты или скриншот</span></li>
            <li><span class="keys"><kbd>Delete</kbd> / <kbd>Backspace</kbd></span><span>Удалить выделенные объекты</span></li>
            <li><span class="keys"><kbd>Esc</kbd></span><span>Сбросить текущее действие или выделение</span></li>
        </ul>
        <h4>Инструменты</h4>
        <ul>
            <li><span class="keys"><kbd>V</kbd></span><span>Инструмент "Выделить"</span></li>
            <li><span class="keys"><kbd>B</kbd></span><span>Переключение между Кистью и Умной кистью</span></li>
            <li><span class="keys"><kbd>E</kbd></span><span>Ластик</span></li>
            <li><span class="keys"><kbd>T</kbd></span><span>Текст</span></li>
            <li><span class="keys"><kbd>S</kbd></span><span>Переключение 2D фигур по кругу</span></li>
            <li><span class="keys"><kbd>D</kbd></span><span>Переключение 3D фигур по кругу</span></li>
            <li><span class="keys"><kbd>I</kbd></span><span>Добавить изображение</span></li>
        </ul>
    `,
    "navigation-panel": `
        <h3>Навигация по доске</h3>
        <h4>Масштаб (Приближение/Отдаление)</h4>
        <p>Вы можете изменять масштаб доски несколькими способами:</p>
        <ul>
            <li><span class="keys"><b>Колесико мыши</b></span><span>Плавное масштабирование.</span></li>
            <li><span class="keys">Кнопки <kbd>+</kbd> и <kbd>-</kbd></span><span>Масштабирование по шагам.</span></li>
        </ul>
        <h4>Перемещение по доске (Панорамирование)</h4>
        <p>Для свободного перемещения по холсту:</p>
        <ul>
            <li><span class="keys"><b>Средняя кнопка мыши</b></span><span>Зажмите колесико и двигайте мышь.</span></li>
            <li><span class="keys">Инструмент "Рука" (<kbd>H</kbd>)</span><span>Выберите на панели, зажмите левую кнопку и двигайте.</span></li>
        </ul>
    `,
    "objects-panel": `
        <h3>Работа с объектами</h3>
        <h4>Выделение</h4>
        <ul>
            <li><span class="keys"><b>Клик</b></span><span>Одиночное выделение объекта.</span></li>
            <li><span class="keys"><kbd>Shift</kbd> + <b>Клик</b></span><span>Добавить или убрать объект из группы выделенных.</span></li>
            <li><span class="keys"><kbd>Ctrl</kbd> + <b>Клик</b></span><span>Исключить объект из выделения рамкой.</span></li>
            <li><span class="keys"><b>Рамка</b></span><span>Зажмите ЛКМ на пустом месте и растяните рамку.</span></li>
        </ul>
        <h4>Трансформация</h4>
        <p>После выделения объекта (или группы) вокруг него появится рамка:</p>
        <ul>
            <li><span class="keys"><b>Перемещение</b></span><span>Захватите объект мышкой и перетащите.</span></li>
            <li><span class="keys"><b>Масштабирование</b></span><span>Потяните за любой из восьми квадратных маркеров.</span></li>
            <li><span class="keys"><b>Вращение</b></span><span>Потяните за верхний круглый маркер.</span></li>
        </ul>
        <h4>Редактирование текста</h4>
        <ul>
            <li><span class="keys"><b>Двойной клик</b></span><span>В режиме "Выделить" (<kbd>V</kbd>).</span></li>
            <li><span class="keys"><b>Одиночный клик</b></span><span>В режиме "Текст" (<kbd>T</kbd>).</span></li>
        </ul>
    `,
    "tools-panel": `
        <h3>Инструменты</h3>
        <ul>
            <li><span class="keys"><b>Кисть</b></span><span>Рисует обычные линии.</span></li>
            <li><span class="keys"><b>Умная кисть</b></span><span>Превращает нарисованную от руки фигуру в идеальную (линию, круг, прямоугольник).<br><b>Совет:</b> чтобы нарисовать прямую линию, задержите курсор на полсекунды в конце.</span></li>
            <li><span class="keys"><b>Текст</b></span><span>Позволяет создавать и редактировать текстовые блоки.</span></li>
            <li><span class="keys"><b>Ластик</b></span><span>Удаляет целый объект по клику на него.</span></li>
            <li><span class="keys"><b>Фигуры (2D/3D)</b></span><span>Позволяют рисовать стандартизированные геометрические фигуры.</span></li>
        </ul>
    `,
    "advanced-panel": `
        <h3>Продвинутые техники</h3>
        <h4>Клавиши-модификаторы</h4>
        <p>Удерживайте эти клавиши во время рисования или трансформации:</p>
        <ul>
            <li><span class="keys"><kbd>Shift</kbd></span><span><b>Рисование линии:</b> делает её строго прямой.<br><b>Масштабирование:</b> сохраняет пропорции.<br><b>Вращение:</b> вращает с шагом в 15 градусов.</span></li>
            <li><span class="keys"><kbd>Alt</kbd></span><span><b>Рисование и перемещение:</b> включает "умную" привязку к сетке и к другим объектам.</span></li>
        </ul>
        <h4>Вставка изображений</h4>
        <p>Вы можете добавить изображение на доску двумя способами:</p>
        <ul>
            <li><span class="keys">Кнопка (<kbd>I</kbd>)</span><span>Выбрать файл с компьютера.</span></li>
            <li><span class="keys"><kbd>Ctrl</kbd> + <kbd>V</kbd></span><span>Вставить скопированный скриншот или картинку.</span></li>
        </ul>
    `
};

export default helpContent;
// --- END OF FILE js/help-content.js ---