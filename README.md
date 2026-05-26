# iGMS hero animations — прототипы

Песочница с прототипами фоновых анимаций для нового hero iGMS-лендинга.
Все самописные, генерятся в браузере, конфигурируются под бренд.

| Прототип | URL (deployed) | Идея | Источник |
|---|---|---|---|
| **hub** | `/` | Список всех прототипов | — |
| **dot-ring** | `/dot-ring/` | Кольцо/дуга из точек, вращается | salesloft.com/platform/forecast |
| **hero01-copperx** | `/hero01-copperx/` | Поток горизонтальных волн на canvas | copperx.io/payment-links |
| **hero02-castle** | `/hero02-castle/` | Мягкие пастельные блобы с drift'ом | castle.io/product/rules |

Боевой URL: **https://design-prototype.airgms.com/**
Доступ — OIDC, только пользователи `@igms.com` (dev-зона, не публично).

## Структура папок

```
igms-ui-animations/
├── README.md
├── deploy.sh             ← rsync на EC2, см. `./deploy.sh --help`
├── .gitignore
├── _import/              ← drop-zone для ассетов из Figma (не деплоится)
├── .claude/              ← preview settings (не деплоится)
└── prototypes/           ← это deploy root → /var/www/prototypes/
    ├── index.html        ← hub
    ├── shared/
    │   ├── proto-nav.css
    │   └── igms-main-multicalendar-screen.png
    ├── dot-ring/
    │   ├── index.html
    │   ├── styles.css
    │   └── dot-ring.js
    ├── hero01-copperx/
    │   ├── index.html
    │   ├── styles.css
    │   └── waves.js
    └── hero02-castle/
        ├── index.html
        └── styles.css
```

Внутри каждого прототипа стандартные имена (`index.html`, `styles.css`,
JS-модуль) → URL без расширений (`/<имя-прототипа>/`).

## Деплой

```bash
./deploy.sh                       # запушить всё (с --delete)
./deploy.sh --dry                 # сухой прогон, посмотреть diff
./deploy.sh hero01-copperx        # только один прототип
./deploy.sh hero01-copperx --dry
```

Используется dedicated SSH-ключ `~/.ssh/ec2_proto_deploy_ed25519` (deploy-only,
без passphrase). Сервер: Amazon Linux 2023, nginx, autoindex on.

## Локальный preview

```bash
python3 -m http.server 8765
# → http://localhost:8765/prototypes/
```

Или через VSCode Live Server / любой статик-сервер.

---

Ниже — детальная техническая дока по каждому прототипу. Начинаем с dot-ring
(исторически первый).

---

## Часть 1 — Dot-ring

---

## TL;DR

- Один inline-SVG с сотнями/тысячами `<circle>`-точек, расставленных в кольце
  (annulus) или сегменте дуги.
- Точки полностью непрозрачные (`fill="currentColor"`, без `opacity`-атрибута)
  → пересечения сливаются как halftone-печать.
- Цвет → CSS-переменная `--dot-color`.
- Анимация — одна CSS-keyframe `dot-ring-spin`, медленное вращение SVG вокруг
  центра. Никаких canvas, requestAnimationFrame, particles.js.
- Один и тот же класс `DotRing` обслуживает оба варианта: «кольцо вокруг
  картинки» (Salesloft hero1) и «горизонт планеты с орбиты» (большой радиус,
  виден только верхний сегмент дуги).

---

## Файлы

```
igms-ui-animations/
├── README.md             ← этот файл
├── index.html            ← демо: hero1 + hero2 + панель контролов
├── styles.css            ← все стили + CSS-переменные + keyframes
├── dot-ring.js           ← генератор SVG + класс DotRing + пресеты
└── .claude/launch.json   ← конфиг python -m http.server для preview
```

Запуск локально: `python3 -m http.server 8765`, открыть
`http://localhost:8765/`.

---

## Источник: что у Salesloft под капотом

Разобрано через `curl` исходник + CSS-файлы Next.js.

- Hero-секция: `<section class="hero HeroPlatformPageL2_solsticeRingGreen__... bg">`.
- CSS-правило:
  ```css
  .…solsticeRingGreen .…imageColumn::after {
    content: "";
    position: absolute;
    width: 900px; height: 900px;
    left: 10px; top: -400px; bottom: 0;
    background-image: url(dot-ring-full-green.a865d360.svg);
    background-size: cover;
    animation: rotate 350s infinite;
    z-index: 0;
  }
  @keyframes rotate { 0% { transform: rotate(0deg) } to { transform: rotate(1turn) } }
  ```
- SVG-файл `dot-ring-full-green.svg` — **статика 1.1 MB**, 4 764 `<path>`-точек,
  заранее раскиданных в **толстом кольце**:
  - viewBox 955 × 955, центр ≈ (484, 480)
  - точки занимают радиус 377…486 (т.е. 0.79…1.02 от viewBox/2)
  - распределение по радиусу неравномерное, пик плотности на ~0.84 × R, к
    краям спадает
  - всё одного цвета `#B5D626` (Salesloft green), без opacity-вариаций
- Никакого JS-runtime'а — браузер крутит готовый SVG через CSS-анимацию.

Наша реализация повторяет идею, но **генерирует SVG в рантайме** под
параметры (цвет/плотность/радиус/толщина) — никакого тяжёлого ассета и
конфигурируемые свойства.

---

## API генератора `DotRing` (`dot-ring.js`)

### Конструктор

```js
import { DotRing, DOT_RING_PRESETS } from "./dot-ring.js";

const ring = new DotRing(hostElement, {
  bands: [...],          // массив поясов (см. ниже)
  rotationSeconds: 250,  // длительность одного оборота, секунды
  direction: 1,          // 1 = по часовой, -1 = против
  viewBox: 1000,         // логический размер SVG (можно не трогать)
  seed: 1,               // PRNG-seed для воспроизводимой случайности
});

ring.update({ rotationSeconds: 400 });   // частичное обновление
ring.update(DOT_RING_PRESETS.horizon);   // подмена набора поясов
ring.destroy();                           // убрать SVG
```

`hostElement` — любой `<div>`, который абсолютно позиционирован относительно
секции. Класс `.dot-ring-host` навешивается автоматически.

### Параметры пояса (`band`)

```ts
{
  innerRadius: number;   // доля от viewBox/2, нижняя граница пояса
  outerRadius: number;   // доля от viewBox/2, верхняя граница
  count: number;         // сколько точек разместить
  dotRadius: number;     // радиус точки в SVG-юнитах (viewBox=1000)
  falloff?: { k: number }; // опционально — градиент плотности по радиусу
}
```

Если `falloff` не задан, точки распределены **равномерно по площади** в
пределах annulus (как у Salesloft hero1).

### Формула плотности (`falloff.k`)

Для каждой кандидатной точки вычисляется
`t = (r − rIn) / (rOut − rIn) ∈ [0, 1]`
и точка оставляется с вероятностью

```
P(t) = (1 − t)^k
```

| `k` | характер |
|---|---|
| 0 (не задан) | равномерно по всему поясу |
| 1 | линейный спад |
| 1.2 | очень пологая дымка |
| 2 | квадратичный — рекомендован, ощущение атмосферы |
| 3 | кубический — резкая «земля», быстрый переход в космос |
| 4+ | почти ступенька, тонкая яркая линия |

Геометрический смысл: внутренняя граница пояса (`r = rIn`) → 100% точек
(«поверхность планеты»), внешняя (`r = rOut`) → 0% («край атмосферы»).
Реализовано через rejection sampling — итоговое количество точек всегда
точно равно `count`.

Все точки рендерятся **полностью непрозрачными**. Пересечения сливаются в
один тон цвета без накопления альфы — эффект как у halftone-печати:
визуальная градация яркости создаётся только распределением точек, не их
прозрачностью.

### Несколько поясов

`bands` — массив. Можно сделать концентрические кольца (см. пресет `halo`).
Для горизонта рекомендуется один пояс с `falloff` — выглядит органичнее.

---

## Пресеты `DOT_RING_PRESETS`

### Замкнутые кольца (под Hero 1 / Salesloft-стиль)

| Имя | Пояса | Использование |
|---|---|---|
| `default` | 1 пояс 0.78–1.00, 3 000 точек | базовый |
| `dense` | 1 пояс 0.74–1.02, 5 000 | плотнее, чуть шире |
| `sparse` | 1 пояс 0.82–0.96, 1 200 | пустее, точки крупнее |
| `halo` | 4 концентрических пояса (0.50/0.70/0.85/0.95) | «гало» — слои с убывающей плотностью |

### Дуги горизонта (под Hero 2)

Все используют единственный пояс с `falloff`.

| Имя | Пояс | `k` | count | Характер |
|---|---|---|---|---|
| `horizon-thin` | 0.86–1.00 | 3 | 8 000 | резкая линия + быстрый спад |
| `horizon` (default) | 0.68–1.00 | 2 | 14 000 | плавная атмосфера |
| `horizon-thick` | 0.55–1.00 | 1.8 | 22 000 | глубокая атмосфера |
| `horizon-soft` | 0.45–1.00 | 1.2 | 26 000 | очень пологая дымка |

---

## CSS-паттерны позиционирования (`styles.css`)

### Базовый host

```css
.dot-ring-host {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  width: 140%;
  aspect-ratio: 1 / 1;
  transform: translate(-50%, -50%);
  color: var(--dot-color);
  pointer-events: none;
  will-change: transform;
}
```

Host центрируется в позиционированном предке (например, `.hero-visual` с
`position: relative`). SVG внутри занимает `width: 100%; height: 100%`. Sсё
вращение — на самом SVG.

### Hero 1 — кольцо вокруг картинки

Host — внутри `.hero-visual`. Картинка имеет `z-index: 2`, host — `z-index: 1`,
поэтому кольцо торчит из-под/из-за картинки.

### Hero 2 — горизонт

```css
.dot-ring-host.horizon {
  width: 320vw;           /* радиус ≈ 160vw — почти прямой горизонт */
  top: 1vw;               /* верх кольца чуть-чуть ниже верха секции */
  bottom: auto;
  left: 50%;
  transform: translateX(-50%);   /* НЕ translateY, иначе уедет */
}
```

Кольцо в ~3× шире вьюпорта → центр кольца глубоко под секцией → видна только
верхняя дуга. Секция должна быть `overflow: hidden`.

**Ручки:**
- `width` 150…600vw — меньше = резче изгиб, больше = почти прямая линия
- `top` −25…+20vw — поднимает/опускает кольцо. Отрицательно → пик выше
  секции, видны только пологие фланги. Положительно → пик опускается внутрь
  секции, изгиб более выражен.
- `padding-top` секции — расстояние от верха секции до текста

### Уважение к `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  .dot-ring-host > svg { animation: none; }
}
```

---

## Цвет

Управляется через CSS-переменную:

```css
:root { --dot-color: #B5D626; }   /* Salesloft green по дефолту */
```

Точки в SVG используют `fill="currentColor"`, а у `.dot-ring-host` стоит
`color: var(--dot-color)`. Поменять цвет можно из JS:

```js
document.documentElement.style.setProperty("--dot-color", "#2A8C5A");
```

Или сразу в `:root`, или для конкретной секции. Цвет применяется
**мгновенно**, без перерисовки SVG.

---

## Текущие дефолты (под наш демо)

### Hero 1 (закрытое кольцо)

| Параметр | Значение |
|---|---|
| Preset | `default` |
| `rotationSeconds` | 250 |
| Host width | 140% (от `.hero-visual`) |
| Direction | CW |

### Hero 2 (горизонт)

| Параметр | Значение |
|---|---|
| Preset | `horizon` |
| `rotationSeconds` | 1040 |
| Host width | 320vw |
| Host top | 1vw |
| Direction | CW |

---

## Demo-панель (только для тестов)

`<aside class="controls">` внизу `index.html`. Табы переключают цель
(Hero 1 ↔ Hero 2). Каждая цель помнит свои значения.

- **Color (global)** — общая CSS-переменная, влияет на оба кольца.
- **Rotation duration** — длительность одного оборота, секунды.
- **Ring size / Ring width** — `host.style.width`, единицы зависят от
  цели: для hero1 — `%`, для hero2 — `vw`.
- **Peak offset** (только hero2) — `host.style.top` в `vw`.
- **Density preset** — список зависит от цели.
- **Direction** — CW / CCW.

В прод-билде панель убирается, остаются только инстансы `DotRing` с
зашитыми параметрами.

---

## Как подключить на iGMS-сайт

Минимальный фрагмент:

```html
<!-- 1. Хост-див в секции -->
<section class="hero-igms">
  <div id="hero-ring" class="dot-ring-host horizon"></div>
  <div class="hero-igms-inner">
    <h1>...</h1>
    <button>...</button>
  </div>
</section>

<script type="module">
  import { DotRing, DOT_RING_PRESETS } from "/path/to/dot-ring.js";
  new DotRing(document.getElementById("hero-ring"), {
    rotationSeconds: 1040,
    ...DOT_RING_PRESETS.horizon,
  });
</script>
```

CSS (брендовый цвет + позиционирование скопировать из `styles.css`):

```css
:root { --dot-color: #2A8C5A; }   /* iGMS green */
.hero-igms { position: relative; overflow: hidden; }
.dot-ring-host.horizon { width: 320vw; top: 1vw; left: 50%;
                         transform: translateX(-50%); ... }
```

---

## Производительность

- 14 000 SVG-кругов рисуются один раз при `new DotRing()`, потом только
  трансформируется родительский SVG → браузер кэширует слой как растровую
  текстуру, вращение через GPU compositor. На M1/M2 — 60fps без проблем,
  CPU использование почти нулевое.
- На медленных Android-устройствах с 22 000+ точек (`horizon-thick`) могут
  быть тормоза. Решения: уменьшить `count` или добавить media-query с
  понижением плотности для мобилок.
- Генерация SVG: ~5–20 мс для 14 000 точек на современном железе
  (rejection sampling). Происходит синхронно при создании / `update()`.

---

## Открытые вопросы / TODO для следующей итерации

- [ ] Выбрать финальный брендовый цвет и финальный пресет для главной
      iGMS (сейчас гоняем `#B5D626` Salesloft green; iGMS — `#2A8C5A`).
- [ ] Решить: на главной iGMS hero1-стиль (кольцо вокруг скриншота) или
      hero2-стиль (горизонт под текст). Возможно — оба, на разных лендингах.
- [ ] Адаптация под мобильные: на узких экранах `width: 320vw` даёт
      огромное кольцо относительно высоты секции, возможно нужны другие
      пропорции под `@media (max-width: 768px)`.
- [ ] Тёмная тема: проверить как точки смотрятся на тёмном фоне (вероятно
      понадобится более яркий цвет / другой пресет).
- [ ] Анимация при скролле: можно ли менять скорость вращения от скролл-
      позиции, чтобы дуга «оживала» когда секция в зоне видимости?
- [ ] A11y: `aria-hidden="true"` на SVG уже стоит. Проверить, что
      `prefers-reduced-motion` корректно стопает анимацию во всех
      сценариях.
- [ ] Возможный вариант: вместо одного непрерывного вращения — slow drift
      + случайные «мерцания» точек (изменение opacity на 1–2 точках в
      секунду через `animate` SVG-attr). Не уверен, что это нужно — лучше
      посмотреть на финальном дизайне.

---

## История изменений в прототипе

1. Сделали базовый генератор с несколькими концентрическими «оболочками»
   и scatter. Слишком сложно, мало похоже на Salesloft.
2. Разобрали Salesloft SVG → один толстый пояс с равномерным
   распределением. Переписали под единый параметр `bands: [{innerR, outerR,
   count, dotRadius}]`.
3. Добавили вторую секцию hero2 с гигантским радиусом (280vw) — эффект
   «горизонт планеты с орбиты». Видна только верхняя дуга.
4. Добавили табы в панель контролов — независимые настройки для hero1 и
   hero2, общий цвет.
5. Переход от 3-полосных пресетов horizon к **одному поясу с
   градиентом плотности** `(1 − t)^k`. Все точки непрозрачные, эффект
   halftone-печати. Пересмотрели все `horizon-*` пресеты.

---

## Часть 2 — hero01-copperx (волны)

### Источник
[copperx.io/payment-links](https://copperx.io/payment-links) — у них **MP4
видео** (`/_next/static/media/banner.426883ec.mp4`) на фоне hero,
автоплей+луп. Мы заменили на canvas-генерацию — легче, конфигурируемо,
без видео-ассета.

### Идея
Flow-field из 30–60 тонких горизонтальных линий. Каждая линия — гладкая
кривая с **двумя гармониками синуса** + слабая третья:

```
y(x, t) = baseY
       + A · 0.70 · sin(x / λ₁ · 2π + φₐ + t)
       + A · 0.28 · sin(x / λ₂ · 2π + φ_b + t·1.35)
       + A · 0.08 · sin(x / λ₃ · 2π + φₐ·1.7 + t·0.6)
```

где `λ₁ = wavelength`, `λ₂ = λ₁·0.42`, `λ₃ = λ₁·0.18`. Композиция двух
несвязных частот даёт «органичный» вид, который не выглядит как
математический синус. Фаза каждой линии сдвинута относительно соседних
(`φₐ = i·0.42 + sin(i·0.7)·0.5`) — линии не качаются синхронно, поэтому
получается плетёное движение, а не стая параллельных копий.

Цвет — HSL, hue растёт по линиям от `hueStart` до `hueStart + hueRange`.
`mix-blend-mode: multiply` на canvas — слои не темнят друг друга, а
смешиваются как краска.

### Файлы
- `hero01-copperx.html` — demo + панель контролов
- `hero01-copperx.js` — класс `WaveField` + пресеты
- `hero01-copperx.css` — стили hero + продукт-мок

### API
```js
import { WaveField, WAVE_PRESETS } from "./hero01-copperx.js";
const wave = new WaveField(canvasElement, WAVE_PRESETS.pastel);
wave.start();
wave.update({ amplitude: 100, hueStart: 200 });
wave.stop();    // или wave.destroy();
```

Все опции — числовые (см. `DEFAULTS` в `hero01-copperx.js`):
`lineCount, lineSpacing, amplitude, wavelength, speed, lineWidth,
opacity, hueStart, hueRange, saturation, lightness`.

### Пресеты
- `pastel` — мягкие тёплые цвета, плотный поток
- `calm` — узкая палитра, медленные волны
- `aurora` — холодные сине-зелёные тона
- `igms` — зелёно-жёлтый брендовый
- `vivid` — широкая палитра, много линий, сильная амплитуда

### Производительность
~36 линий × ~110 сэмплов = ~4 000 line segments каждый кадр. На M1/M2 это
50–60 fps без проблем. Если лагает на мобильном — уменьшить `lineCount`
или поднять `lineSpacing`. `dpr` ограничен `min(devicePixelRatio, 2)` —
чтобы не рендерить лишнее на retina.

### `prefers-reduced-motion`
Учитывается: при `reduce` анимация не запускается, рисуется один кадр.

---

## Часть 3 — hero02-castle (блобы)

### Источник
[castle.io/product/rules](https://castle.io/product/rules) — у них прямо
в HTML видны 3 абсолютных дива 1024×1024 с tailwind-классами
`bg-radial from-yellow-300/15 to-transparent`,
`bg-radial from-cyan-300/30 ...`, `bg-radial from-purple-300/30 ...`.
Статика, без анимации. Мы добавили медленный drift и breathing-scale,
плюс конфигурируемые цвета через CSS-переменные.

### Идея
4 абсолютных дива, каждый — `border-radius: 50%` + radial-gradient +
`filter: blur(40px)` + `mix-blend-mode: multiply`. Размер 70vw по
умолчанию (огромные мягкие пятна). Анимация — `@keyframes drift-N`
которая медленно сдвигает и слегка масштабирует блоб по сложной траектории
30–48 секунд. У каждого блоба своя независимая фаза, поэтому общий
рисунок «течёт» непрерывно.

### Файлы
- `hero02-castle.html` — demo + контролы (CSS-only анимация, JS только
  для слайдеров)
- `hero02-castle.css` — стили + keyframes

### Настройки (CSS-переменные на `:root`)
```css
--blob-1: #FFE066;     /* цвет каждого из 4 блобов */
--blob-2: #FF9EC7;
--blob-3: #9EE9FF;
--blob-4: #C7B6FF;
--blob-size: 70vw;     /* диаметр */
--blob-opacity: 0.5;
--blob-blur: 40px;
--blob-speed: 1;        /* множитель скорости — duration делится на это */
--blob-blend: multiply; /* или screen/overlay/soft-light/normal */
```

### Пресеты
- `pastel` — жёлтый/розовый/cyan/фиолетовый (как у Castle)
- `warm` — оттенки песка/персик/розовый
- `cool` — все холодные тона
- `igms` — жёлтый + наш зелёный + cyan

### Производительность
Чистый CSS-композит. Бесплатно на GPU. 4 слоя с `filter: blur` — единственная
нагрузка, но даже на слабых iPhone это 60fps.

---

## Сравнение прототипов

| | dot-ring | copperx-waves | castle-blobs |
|---|---|---|---|
| **Технология** | Inline SVG + CSS rotate | Canvas 2D + rAF | CSS @keyframes |
| **JS-runtime** | Только генерация (один раз) | requestAnimationFrame loop | Нет |
| **Конфиг** | Программный (bands, falloff) | Программный (lineCount, hue…) | CSS-переменные |
| **Бренд-цвет** | 1 CSS-переменная | HSL диапазон | 4 CSS-переменные |
| **Размер DOM** | ~3 000–18 000 элементов | 1 canvas | 4 дива |
| **Идеально для** | Графичный акцент, кольцо/дуга | Поточный/жидкий фон | Мягкий цветовой акцент |
| **Сложность интеграции** | Низкая | Низкая | Очень низкая |

---

## Следующие шаги

- [ ] Выбрать ОДИН прототип под новый iGMS hero. Текущий лидер по
      «легкости» — castle (CSS-only, минимум кода). copperx интереснее
      визуально. dot-ring — самый «нарративный».
- [ ] Заменить mock-дашборд на реальный скриншот продукта.
- [ ] Подбор финального цвета — на сейчас у каждого прототипа свои
      дефолты, нужен единый брендовый.
- [ ] Адаптация под мобильные.
- [ ] Тёмная тема (если будет).
