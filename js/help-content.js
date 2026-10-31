// --- START OF FILE js/help-content.js ---

const helpContent = {
    "tab-intro": `
        <h3>Добро пожаловать в repitorium.ru!</h3>
        <p>Интерактивная векторная доска — это современное премиальное пространство для совместной работы, рисования, построения точных геометрических чертежей и аннотирования документов на бесконечном холсте.</p>
        
        <div class="device-specific" data-device="desktop" style="margin-top: 10px; padding: 12px; background: rgba(0, 122, 255, 0.08); border-radius: 8px; border-left: 4px solid #007aff;">
            <strong>Режим: Компьютер (Мышь + Клавиатура) 💻</strong><br>
            Инструкции ниже оптимизированы для работы с мышью, трекпадом и горячими клавишами. Если вы на планшете/телефоне, выберите переключатель «Сенсор / Планшет» вверху справки.
        </div>
        <div class="device-specific" data-device="touch" style="margin-top: 10px; padding: 12px; background: rgba(34, 197, 94, 0.08); border-radius: 8px; border-left: 4px solid #22c55e; display: none;">
            <strong>Режим: Сенсор / Планшет (Стилус / Палец) 📱</strong><br>
            Инструкции ниже переключены на управление жестами, тач-касания и работу стилусом.
        </div>

        <h4>Ключевые преимущества доски:</h4>
        <div class="help-card-grid">
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-profile.webp" alt="Бесконечность">
                    <h4>Бесконечный холст</h4>
                </div>
                <p>Пространство не ограничено рамками. Перемещайтесь в любом направлении и масштабируйте схемы без потери качества (вся графика векторная).</p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-save.webp" alt="Автосохранение">
                    <h4>Надежное автосохранение</h4>
                </div>
                <p>Все изменения записываются в базу данных браузера (IndexedDB) автоматически. Закрытие вкладки или сбой не приведут к потере ваших наработок.</p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-style.webp" alt="Интерфейс">
                    <h4>Стекломорфный 3D дизайн</h4>
                </div>
                <p>Интерфейс выполнен в стиле Glassmorphism с поддержкой светлой/темной тем холста, плавных 3D-кнопок и микроанимаций.</p>
            </div>
        </div>

        <div style="margin-top: 20px; padding: 15px; background: var(--bg-element); border-radius: 8px; border: 1px solid var(--border-color);">
            <strong>Быстрый старт:</strong> Выберите инструмент <strong>Кисть</strong> <img src="icons_bord/icon-brush.webp" class="help-inline-icon"> на панели слева, чтобы начать рисовать, или нажмите на иконку <strong>Скрепки</strong> <img src="icons_bord/icon-skrepka.webp" class="help-inline-icon">, чтобы загрузить PDF-файл, изображение, линейку или транспортир.
        </div>
    `,
    "tab-hotkeys": `
        <h3>Клавиатурные сокращения</h3>
        <p>Используйте горячие клавиши для моментального переключения инструментов и управления холстом.</p>
        
        <div class="device-specific" data-device="touch" style="margin-bottom: 15px; padding: 10px; background: rgba(234, 179, 8, 0.1); border-radius: 8px; border-left: 4px solid #eab308;">
            <strong>Обратите внимание:</strong> Горячие клавиши на мобильных устройствах доступны только при подключенной аппаратной клавиатуре (по Bluetooth или USB).
        </div>

        <h4>Основные действия и история</h4>
        <div class="hotkey-grid">
            <div class="kbd-group"><kbd>Ctrl</kbd> + <kbd>Z</kbd></div><div class="hotkey-desc">Отменить последнее действие (Undo)</div>
            <div class="kbd-group"><kbd>Ctrl</kbd> + <kbd>Y</kbd></div><div class="hotkey-desc">Повторить отменённое действие (Redo)</div>
            <div class="kbd-group"><kbd>Ctrl</kbd> + <kbd>C</kbd></div><div class="hotkey-desc">Копировать выделенные объекты в буфер обмена</div>
            <div class="kbd-group"><kbd>Ctrl</kbd> + <kbd>X</kbd></div><div class="hotkey-desc">Вырезать выделенные объекты</div>
            <div class="kbd-group"><kbd>Ctrl</kbd> + <kbd>V</kbd></div><div class="hotkey-desc">Вставить объекты или картинку из внешнего буфера обмена</div>
            <div class="kbd-group"><kbd>Delete</kbd> / <kbd>Backspace</kbd></div><div class="hotkey-desc">Удалить выделенные объекты с холста</div>
            <div class="kbd-group"><kbd>Esc</kbd></div><div class="hotkey-desc">Сбросить текущее выделение или отменить построение фигуры</div>
        </div>

        <h4>Быстрый вызов инструментов</h4>
        <div class="hotkey-grid">
            <div class="kbd-group"><kbd>V</kbd></div><div class="hotkey-desc">Инструмент "Выделение" <img src="icons_bord/icon-cursor.webp" class="help-inline-icon"> (активирует стрелку-курсор)</div>
            <div class="kbd-group"><kbd>P</kbd></div><div class="hotkey-desc">Инструмент "Кисть" <img src="icons_bord/icon-brush.webp" class="help-inline-icon"> (свободное перо)</div>
            <div class="kbd-group"><kbd>B</kbd></div><div class="hotkey-desc">Включить/выключить "Умную кисть" <img src="icons_bord/icon-smartbrush.webp" class="help-inline-icon"></div>
            <div class="kbd-group"><kbd>E</kbd></div><div class="hotkey-desc">Инструмент "Ластик" <img src="icons_bord/icon-lastick.webp" class="help-inline-icon"></div>
            <div class="kbd-group"><kbd>T</kbd></div><div class="hotkey-desc">Инструмент "Текст" <img src="icons_bord/icon-text.webp" class="help-inline-icon"> (создание текстовых блоков)</div>
            <div class="kbd-group"><kbd>H</kbd></div><div class="hotkey-desc">Инструмент "Рука" <img src="icons_bord/icon-hand.webp" class="help-inline-icon"> (панорамирование доски)</div>
            <div class="kbd-group"><kbd>L</kbd></div><div class="hotkey-desc">Инструмент "Лазерная указка" <img src="icons_bord/icon-laser.webp" class="help-inline-icon"> (для презентаций)</div>
            <div class="kbd-group"><kbd>S</kbd></div><div class="hotkey-desc">Переключать 2D фигуры <img src="icons_bord/icon-2D.webp" class="help-inline-icon"> по кругу</div>
            <div class="kbd-group"><kbd>D</kbd></div><div class="hotkey-desc">Переключать 3D фигуры <img src="icons_bord/icon-3D.webp" class="help-inline-icon"> по кругу</div>
        </div>

        <h4>Клавиши-модификаторы (Desktop)</h4>
        <div class="hotkey-grid">
            <div class="kbd-group"><kbd>Shift</kbd></div><div class="hotkey-desc"><strong>При рисовании:</strong> делает линии строго горизонтальными/вертикальными или под 45 градусов. <strong>При масштабировании:</strong> сохраняет исходные пропорции (инвертирует свободный режим). <strong>При вращении:</strong> магнитит к углам кратным 15 градусам.</div>
            <div class="kbd-group"><kbd>Alt</kbd></div><div class="hotkey-desc">Удерживайте во время рисования или перемещения, чтобы временно инвертировать режим привязки к сетке и объектам.</div>
            <div class="kbd-group"><kbd>Space</kbd> + ЛКМ</div><div class="hotkey-desc">Зажмите Пробел и тяните мышкой для быстрого перемещения по доске</div>
        </div>
    `,
    "tab-nav": `
        <h3>Навигация по холсту</h3>
        <p>Бесконечный холст позволяет легко ориентироваться в больших схемах. Используйте следующие способы навигации в зависимости от вашего устройства:</p>
        
        <h4>Управление масштабом (Zoom)</h4>
        
        <div class="device-specific" data-device="desktop">
            <ul>
                <li><strong>Колесико мыши:</strong> Прокручивайте вверх для приближения, вниз — для отдаления. Зум автоматически центрируется на позиции вашего курсора.</li>
                <li><strong>Интерфейсные кнопки:</strong> Кнопки с иконками <img src="icons_bord/icon-plus.webp" class="help-inline-icon"> и <img src="icons_bord/icon-minus.webp" class="help-inline-icon"> в правом нижнем углу холста позволяют менять масштаб по фиксированным шагам.</li>
                <li><strong>Быстрый сброс на 100%:</strong> Кликните по текстовому значению масштаба (например, <code>120%</code>), чтобы мгновенно сбросить масштаб на исходные 100%.</li>
                <li><strong>Трекпад:</strong> Используйте жест сведения/разведения двух пальцев (Pinch-to-zoom) для плавного и точного масштабирования.</li>
            </ul>
        </div>
        
        <div class="device-specific" data-device="touch" style="display: none;">
            <ul>
                <li><strong>Жест разведения пальцев:</strong> Коснитесь экрана двумя пальцами и разведите их в стороны для плавного приближения. Центр зума будет находиться точно между пальцами.</li>
                <li><strong>Жест сведения пальцев:</strong> Сведите два пальца на экране вместе для отдаления масштаба.</li>
                <li><strong>Интерфейсные кнопки:</strong> Нажимайте на кнопки с иконками <img src="icons_bord/icon-plus.webp" class="help-inline-icon"> and <img src="icons_bord/icon-minus.webp" class="help-inline-icon"> в правом верхнем углу для пошагового масштабирования.</li>
                <li><strong>Вернуться к обзору:</strong> Меню доски → «Найти рисунки» — вписывает всё содержимое доски в экран.</li>
            </ul>
        </div>

        <h4>Перемещение по холсту (Панорамирование)</h4>
        
        <div class="device-specific" data-device="desktop">
            <ul>
                <li><strong>Колесико мыши (СКМ):</strong> Нажмите и удерживайте колесико мыши (среднюю кнопку), затем перемещайте курсор. Это самый быстрый способ сдвига доски.</li>
                <li><strong>Клавиша Пробел:</strong> Зажмите клавишу <kbd>Пробел</kbd> и перетаскивайте холст левой кнопкой мыши (ЛКМ).</li>
                <li><strong>Инструмент "Рука":</strong> Выберите иконку руки <img src="icons_bord/icon-hand.webp" class="help-inline-icon"> (или нажмите <kbd>H</kbd>), зажмите ЛКМ и свободно перемещайте холст.</li>
            </ul>
        </div>
        
        <div class="device-specific" data-device="touch" style="display: none;">
            <ul>
                <li><strong>Два пальца:</strong> Проведите двумя пальцами по экрану в любом направлении. Это позволяет перемещать холст, не переключая текущий инструмент (например, не выходя из режима рисования кистью).</li>
                <li><strong>Инструмент "Рука" <img src="icons_bord/icon-hand.webp" class="help-inline-icon">:</strong> Выберите иконку руки на панели, после чего вы сможете перетаскивать холст одним пальцем в любом направлении.</li>
            </ul>
        </div>
    `,
    "tab-tools": `
        <h3>Инструменты рисования</h3>
        <p>Настройте параметры кисти и выберите подходящий режим для быстрого создания графики:</p>
        
        <div class="help-card-grid">
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-brush.webp" alt="Кисть">
                    <h4>Обычная кисть</h4>
                </div>
                <p>Классическое свободное рисование. Поддерживает силу нажатия (давление) пера на планшетах со стилусами (Samsung S-Pen, Apple Pencil).</p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-smartbrush.webp" alt="Умная кисть">
                    <h4>Умная кисть</h4>
                </div>
                <p>Автоматически распознает ваши наброски: небрежный круг превратится в эллипс, треугольник выровняется, а ломаная линия станет прямой. Задержите перо на 0.5с в конце прямой для принудительного выравнивания.</p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-kurve.webp" alt="Кривая">
                    <h4>Инструмент "Кривая"</h4>
                </div>
                <p>Векторные кривые Безье по опорным точкам. Кликайте для добавления узлов, нажмите <kbd>Enter</kbd> для завершения — последний узел встанет в точку под курсором. Позже в режиме выделения вы сможете перетаскивать узлы за направляющие "усы".</p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-text.webp" alt="Текст">
                    <h4>Текстовые блоки</h4>
                </div>
                <p>Кликните и растяните рамку для ввода текста. Встроенный редактор поддерживает жирность, курсив, подчеркивание, зачеркивание, надстрочные/подстрочные индексы, а также цветное выделение маркером.</p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-lastick.webp" alt="Ластик">
                    <h4>Умный Ластик</h4>
                </div>
                <p>Удаляет векторные объекты целиком при касании контура. <span class="device-specific" data-device="touch">При использовании стилуса S-Pen зажмите кнопку на корпусе пера для моментальной активации ластика. Отпустите её для возврата к кисти.</span></p>
            </div>
            <div class="help-card">
                <div class="help-card-header">
                    <img src="icons_bord/icon-laser.webp" alt="Лазерная указка">
                    <h4>Лазерная указка</h4>
                </div>
                <p>Создает яркий светящийся след, который плавно растворяется и исчезает через 1 секунду. Идеально для демонстрации элементов во время презентаций.</p>
            </div>
        </div>

        <h4>Настройка стилей и цвета:</h4>
        <ul>
            <li><strong>Толщина линии:</strong> Настраивайте кнопками <code>+</code> / <code>-</code>, ползунком или горячими клавишами: <kbd>S</kbd> (тонкая - 2px), <kbd>M</kbd> (средняя - 8px), <kbd>L</kbd> (толстая - 16px).</li>
            <li><strong>Цветовые кнопки:</strong> Быстро выбирайте цвета на всплывающей панели. Выбранная кнопка реалистично вдавливается.</li>
            <li><strong>Стили линий:</strong> Сплошная (Solid), Пунктирная (Dashed), Штрих-пунктирная (Dash-dot) и Волнистая (Wavy) для рисования синусоидальных волн.</li>
            <li><strong>Заливка:</strong> Иконка капли включает заливку замкнутых контуров; цвет заливки выбирается на отдельной палитре.</li>
        </ul>
    `,
    "tab-shapes": `
        <h3>Геометрические фигуры (2D и 3D)</h3>
        <p>Используйте готовый каталог плоских и пространственных тел для моментального построения математических и учебных чертежей:</p>
        
        <h4>Плоские 2D Фигуры</h4>
        <p>Выберите фигуру на панели. Зажмите ЛКМ (или коснитесь экрана) и тяните по диагонали, чтобы задать её размеры:</p>
        <ul>
            <li><strong>Прямоугольник <img src="icons_bord/icon-kvadrat.webp" class="help-inline-icon"> / Овал <img src="icons_bord/icon-krug.webp" class="help-inline-icon">:</strong> Удерживайте клавишу <kbd>Shift</kbd>, чтобы получить идеальный квадрат с равными сторонами или правильный круг. <span class="device-specific" data-device="touch">На сенсорном экране пропорции сохраняются по умолчанию, вы можете растягивать фигуры свободно пальцами.</span></li>
            <li><strong>Линия <img src="icons_bord/icon-line.webp" class="help-inline-icon"> и Стрелка:</strong> Для указателей связей. Удержание <kbd>Shift</kbd> выравнивает угол наклона с шагом 45 градусов.</li>
            <li><strong>Ромб <img src="icons_bord/icon-romb.webp" class="help-inline-icon">, Параллелограмм <img src="icons_bord/icon-parall.webp" class="help-inline-icon">, Трапеция <img src="icons_bord/icon-trapec.webp" class="help-inline-icon">, Треугольник <img src="icons_bord/icon-triangle.webp" class="help-inline-icon">:</strong> Строятся по интерактивным шагам. Например, для трапеции сначала растяните основание, затем кликните для задания высоты и верхнего ребра.</li>
        </ul>

        <h4>Объемные 3D Фигуры</h4>
        <p>Все пространственные фигуры строятся в трехмерной проекции по удобному пошаговому принципу:</p>
        
        <div class="device-specific" data-device="desktop">
            <ol>
                <li><strong>Шаг 1 (Площадь основания):</strong> Зажмите левую кнопку мыши и потяните, чтобы растянуть основание фигуры на плоскости холста. Отпустите кнопку мыши.</li>
                <li><strong>Шаг 2 (Высота / Объем):</strong> Переместите курсор по вертикали (без зажатия кнопок), вытягивая фигуру по высоте. Сделайте одиночный клик ЛКМ, чтобы завершить фигуру.</li>
            </ol>
        </div>
        
        <div class="device-specific" data-device="touch" style="display: none;">
            <ol>
                <li><strong>Шаг 1 (Площадь основания):</strong> Коснитесь экрана пальцем или стилусом и проведите в сторону, чтобы задать размеры основания фигуры. Оторвите перо/палец от экрана.</li>
                <li><strong>Шаг 2 (Высота / Объем):</strong> Проведите стилусом или пальцем вверх или вниз, настраивая высоту фигуры в реальном времени. Сделайте одиночный короткий тап по экрану для завершения построения.</li>
            </ol>
        </div>

        <p>Доступны следующие объемные тела:</p>
        <ul>
            <li><strong>Параллелепипед (Куб) <img src="icons_bord/icon-3D.webp" class="help-inline-icon"></strong> — с автоматической прорисовкой невидимых ребер штриховкой.</li>
            <li><strong>Сфера <img src="icons_bord/icon-sphere.webp" class="help-inline-icon"></strong> — объемный шар со светотеневой штриховкой.</li>
            <li><strong>Конус <img src="icons_bord/icon-conus.webp" class="help-inline-icon"> и Усеченный конус <img src="icons_bord/icon-cutconus.webp" class="help-inline-icon"></strong> — тела вращения с прорисованным основанием.</li>
            <li><strong>Пирамида <img src="icons_bord/icon-piramide.webp" class="help-inline-icon"> и Усеченная пирамида <img src="icons_bord/icon-cuppiramide.webp" class="help-inline-icon"></strong> — многогранники с квадратным основанием.</li>
            <li><strong>Усеченная сфера <img src="icons_bord/icon-cutsphere.webp" class="help-inline-icon"></strong> — полусфера со срезом на плоскости.</li>
        </ul>
        <p><em>Во время построения ориентируйтесь на текстовые подсказки (тултипы), отображаемые рядом с вашим указателем.</em></p>
    `,
    "tab-objects": `
        <h3>Работа с объектами и слоями</h3>
        <p>Каждый нарисованный элемент является самостоятельным векторным объектом. Вы можете изменять его параметры в любое время:</p>
        
        <h4>Выделение объектов</h4>
        <ul>
            <li><strong>Клик / Тап:</strong> Выберите инструмент "Выделение" <img src="icons_bord/icon-cursor.webp" class="help-inline-icon"> (клавиша <kbd>V</kbd>) и нажмите на любой объект на холсте. Вокруг него появится синяя рамка выделения.</li>
            <li><strong>Выделение рамкой (Marquee):</strong> 
                <span class="device-specific" data-device="desktop">Зажмите ЛКМ на пустом месте доски и растяните синий прямоугольник поверх группы объектов, чтобы выбрать их все.</span>
                <span class="device-specific" data-device="touch">Коснитесь пустого места экрана и проведите пальцем по диагонали, чтобы охватить рамкой несколько объектов.</span>
            </li>
            <li><strong>Групповой выбор:</strong> Удерживайте клавишу <kbd>Shift</kbd> при кликах по объектам для их добавления/удаления из группы.</li>
        </ul>

        <h4>Трансформация объектов</h4>
        <ul>
            <li><strong>Перемещение:</strong> Наведите указатель на выделенный объект и перетаскивайте его. При активном режиме магнита он будет прилипать к сетке.</li>
            <li><strong>Масштабирование:</strong> Тяните за любой из 8 прямоугольных маркеров на рамке выделения. 
                <ul>
                    <li><em>Угловые маркеры:</em> меняют размер. Для текста это пропорционально меняет размер шрифта.</li>
                    <li><em>Боковые маркеры:</em> сжимают или растягивают объект. Для текста это переносит строки в реальном времени под ширину рамки.</li>
                </ul>
            </li>
            <li><strong>Вращение:</strong> Тяните за верхний круглый маркер, соединенный ножкой с рамкой. Зажмите <kbd>Shift</kbd>, чтобы вращать фигуру шагами в 15 градусов.</li>
            <li><strong>Свободный центр вращения (2D Pivot):</strong> В центре выделения расположена зеленая точка-перекрестие. Вы можете перетащить её в любое место на холсте. Вращение объекта будет происходить вокруг этой точки. Двойной клик/тап по пивоту сбросит его обратно в геометрический центр.</li>
        </ul>

        <h4>Управление слоями</h4>
        <div class="device-specific" data-device="desktop">
            <p><strong>Контекстное меню:</strong> Нажмите правой кнопкой мыши (ПКМ) по выделенному объекту (или группе), чтобы вызвать быстрое меню действий:</p>
        </div>
        <div class="device-specific" data-device="touch" style="display: none;">
            <p><strong>Контекстное меню:</strong> Зажмите палец на выделенном объекте на 1 секунду (Long Press) или используйте кнопки на всплывающей панели управления, чтобы вызвать действия:</p>
        </div>
        <ul>
            <li><strong>На передний план:</strong> Поднимает выбранные объекты на самый верх (они перекроют другие).</li>
            <li><strong>На задний план:</strong> Опускает объекты под все остальные слои на холсте.</li>
            <li><strong>Продублировать <img src="icons_bord/icon-copy.webp" class="help-inline-icon">:</strong> Создает точную копию объекта со сдвигом.</li>
            <li><strong>Удалить:</strong> Стирает объекты с холста.</li>
        </ul>
        <p>Порядок объектов меняется правым кликом по объекту: «Переместить вперед/назад», «На передний/задний план».</p>
    `,
    "tab-advanced": `
        <h3>Дополнительные инструменты и PDF</h3>
        <p>Используйте продвинутые возможности доски для ведения полноценных интерактивных презентаций и решения сложных задач:</p>
        
        <h4>Чертежные инструменты (Скрепка <img src="icons_bord/icon-skrepka.webp" class="help-inline-icon">)</h4>
        <ul>
            <li><strong>Линейка <img src="icons_bord/icon-lineyka.webp" class="help-inline-icon">:</strong> 
                <ul>
                    <li>Позволяет измерять расстояния и рисовать ровные линии. Поверните её за круглые края или введите угол вручную.</li>
                    <li><strong>Магнитная привязка <img src="icons_bord/icon-magnet.webp" class="help-inline-icon">:</strong> включите иконку магнита на панели линейки. Теперь при рисовании кистью рядом с гранью линейки штрих автоматически прилипнет к ней, помогая рисовать идеально ровные отрезки.</li>
                    <li><strong>Свободный центр вращения:</strong> перетащите зеленый маркер в любую точку, чтобы вращать линейку вокруг нее.</li>
                </ul>
            </li>
            <li><strong>Транспортир <img src="icons_bord/icon-transportir.webp" class="help-inline-icon">:</strong> 
                <ul>
                    <li>Полукруглая измерительная шкала (0°-180°) со встроенной линейкой толщиной 45 единиц для удобного тач-управления.</li>
                    <li><strong>Прозрачный центр:</strong> вырез внутри транспортира полностью прозрачен — сквозь него видно сетку и можно писать кистью. Кнопки закрытия и настроек перенесены в полый центр, чтобы не перекрывать шкалу.</li>
                    <li><strong>Примагничивание:</strong> штрихи кисти автоматически прилипают к ровной нижней грани или к круглому верхнему ободу транспортира, позволяя рисовать точные дуги.</li>
                </ul>
            </li>
        </ul>

        <h4>Работа с PDF-документами и картинками</h4>
        <ul>
            <li><strong>Импорт:</strong> 
                <span class="device-specific" data-device="desktop">Перетащите PDF-файл или картинку прямо в окно браузера (Drag & Drop), вставьте изображение из буфера обмена (<kbd>Ctrl+V</kbd>) или загрузите его через меню вложений (Скрепка <img src="icons_bord/icon-skrepka.webp" class="help-inline-icon">).</span>
                <span class="device-specific" data-device="touch">Нажмите на иконку Скрепки <img src="icons_bord/icon-skrepka.webp" class="help-inline-icon">, выберите файл через проводник устройства или вставьте его из буфера обмена.</span>
            </li>
            <li><strong>Управление страницами PDF:</strong> На PDF-слое отображаются кнопки навигации <code>Назад</code> (<img src="icons_bord/icon-previouspage.webp" class="help-inline-icon">) и <code>Вперед</code> (<img src="icons_bord/icon-nextpage.webp" class="help-inline-icon">), а также текстовое поле с текущей страницей. Введите нужную страницу и подтвердите переход кнопкой-галочкой (<img src="icons_bord/icon-endlessons.webp" class="help-inline-icon">).</li>
            <li><strong>Режим аннотаций (Пометки на PDF):</strong>
                <ol>
                    <li>Выделите PDF-документ или картинку кликом/тапом.</li>
                    <li>Нажмите кнопку <strong>"Выбрать аннотации"</strong> на плавающей панели. Рамка PDF сменится на красную штрих-пунктирную линию.</li>
                    <li>Теперь любые штрихи кисти, стрелки или текст, созданные поверх документа, будут привязаны к нему.</li>
                    <li><strong>Привязка к страницам:</strong> пометки сохраняются строго на той странице PDF, на которой они были нарисованы. При перелистывании страниц отображаются только соответствующие пометки.</li>
                    <li><strong>Групповое перемещение:</strong> если вы сдвинете или масштабируете PDF-документ, все ваши пометки переместятся и изменят масштаб вместе с ним. Внутри красной рамки вы по-прежнему можете выделять и редактировать отдельные аннотации.</li>
                </ol>
            </li>
        </ul>

        <h4>Импорт и Экспорт проектов</h4>
        <ul>
            <li><strong>Сохранить проект <img src="icons_bord/icon-save.webp" class="help-inline-icon">:</strong> Скачивает весь ваш холст со всеми слоями и настройками в файл проекта <code>.board</code>.</li>
            <li><strong>Открыть проект:</strong> Загружает ранее сохраненный <code>.board</code> проект обратно на доску.</li>
            <li><strong>Экспорт в изображение:</strong> Генерирует и скачивает изображение всей видимой области доски в <code>.jpg</code> (сжатие 0.95) или <code>.png</code> (без потерь), включая стикеры и связи между ними.</li>
            <li><strong>Печать / PDF:</strong> Открывает системный диалог печати с готовым снимком доски — там можно выбрать «Сохранить как PDF» или отправить на принтер.</li>
        </ul>
    `
};

export default helpContent;
// --- END OF FILE js/help-content.js ---