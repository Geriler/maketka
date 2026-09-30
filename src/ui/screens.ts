/**
 * Экраны поверх стола: стартовое меню (песочница или карьера) и карта карьеры — компоненты-узлы,
 * стрелки «из чего собирается», как дерево исследований.
 */

import { LESSONS, type Lesson } from "../career/lessons";
import { REPAIRS, stageById } from "../career/repairs";
import { PROJECTS } from "../career/projects";
import { FUNC_NAMES, LEVELS, gateIo, goalMet, kitLabel, type Level, type LogicFunc } from "../career/levels";
import { bestOf, isDone, loadSlot, missing } from "../career/session";
import { metricsHtml } from "./career";
import { PIN_ROLES } from "../chips/roles";
import { packageName } from "../model/breadboard";
import { plural } from "../chips/count";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ─── Стартовое меню ─────────────────────────────────────────────────────────

export interface MenuHost {
  chooseMode(mode: "sandbox" | "career"): void;
}

export class MenuScreen {
  readonly el: HTMLElement;

  constructor(private host: MenuHost) {
    this.el = document.createElement("div");
    this.el.className = "screen menu-screen";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Выбор режима");
    this.el.addEventListener("click", (e) => {
      const mode = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]")?.dataset.mode;
      if (mode === "sandbox" || mode === "career") this.host.chooseMode(mode);
    });
    document.body.appendChild(this.el);
  }

  show(current?: "sandbox" | "career"): void {
    const done = LEVELS.filter((l) => isDone(l.id)).length;
    this.el.innerHTML = `<div class="menu-box">
      <h1>Макетка</h1>
      <p class="sub">3D-песочница электрических цепей</p>
      <div class="menu-cards">
        <button class="menu-card${current === "sandbox" ? " current" : ""}" data-mode="sandbox">
          <b>Песочница</b>
          <span>Все детали, приборы и микросхемы сразу. Свои схемы, проекты, примеры.</span>
        </button>
        <button class="menu-card career${current === "career" ? " current" : ""}" data-mode="career">
          <b>Карьера</b>
          <span>Открывайте компоненты, собирая их из выданного набора деталей — от инвертора до четырёхразрядного сумматора.</span>
          <small>Открыто ${done} из ${LEVELS.length} · уроков ${LESSONS.filter((l) => isDone(l.id)).length} из ${LESSONS.length} · ремонтов ${REPAIRS.filter((l) => isDone(l.id)).length} из ${REPAIRS.length} · проектов ${PROJECTS.filter((l) => isDone(l.id)).length} из ${PROJECTS.length}</small>
        </button>
      </div>
      <p class="sub">У каждого режима свой стол и свои сохранения.</p>
    </div>`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

// ─── Карта карьеры ──────────────────────────────────────────────────────────

export interface MapHost {
  startLevel(id: string, fresh: boolean): void;
  openWorkshop(): void;
  openMenu(): void;
  /** Закрыть карту и вернуться к столу (если он есть). */
  closeMap(): void;
  /** Есть ли стол, к которому можно вернуться. */
  hasTable(): boolean;
}

/** Где узлы: [столбец, ряд]. Слева — детали, потом вентили, потом то, что из них собирается. */
const PLACE: Record<string, [number, number]> = {
  "intro-led": [0, 0],
  "intro-volts": [0, 1],
  "intro-amps": [0, 2],
  "intro-divider": [0, 3],
  "intro-switch": [0, 4],
  "intro-scope": [0, 5],
  parts: [1, 2.5],
  "fix-led-open": [0, 10.5],
  "fix-led-dim": [1, 10.5],
  "fix-divider": [2, 10.5],
  "fix-switch-short": [3, 10.5],
  "fix-switch-reversed": [4, 10.5],
  "fix-pcb-crack": [5, 10.5],
  "fix-adder": [6, 10.5],
  "fix-blinker": [6, 11.5],
  "fix-smd-crack": [7, 11.5],
  "fix-smd-fet": [8, 11.5],
  "fix-soic-bridge": [9, 11.5],
  "fix-display": [10, 11.5],
  "fix-555": [10, 12.5],
  "nand-cmos": [2, 0],
  "not-cmos": [2, 1.5],
  "nor-cmos": [2, 3],
  lm393: [2, 5],
  lm358: [2, 6.5],
  xor: [3, 0],
  and: [3, 1.5],
  or: [3, 3],
  buf: [3, 4.5],
  lm78l05: [3, 6.5],
  hc7266: [4, 0],
  hc283: [4, 1.2],
  hc85: [4, 2.4],
  mux: [4, 3.6],
  hc138: [4, 4.8],
  schmitt: [4, 6],
  hc244: [4, 7.2],
  hc245: [4, 7.2],
  dff: [4, 8.4],
  ne555: [5, 1.2],
  hc4511: [5, 4.8],
  hc574: [5, 7.2],
  dffr: [5, 8.4],
  cnt4: [5, 9.6],
  sreg8: [6, 8.4],
  cnt393: [6, 9.6],
  max6816: [7, 6],
  hc157: [5, 3.6],
  hc161: [6, 7.2],
  hc173: [6, 6],
  rom8: [5, 6],
  ram4: [7, 4.8],
  hc595: [7, 7.8],
  hc4017: [7, 9],
  "proj-hyst": [8, 1.2],
  "proj-adc": [8, 3.6],
  "proj-stopwatch": [8, 4.8],
  "proj-counter": [8, 6],
  "proj-dac": [8, 7.8],
  "proj-lights": [8, 9],
  "proj-sar": [9, 3.6],
  "proj-cpu": [9, 6],
};
/**
 * Узлы карты — группы уровней, иначе стрелок не разобрать:
 * - варианты одного компонента (И-НЕ на КМОП и на РТЛ, XNOR тремя способами…);
 * - цепочки, где учебные ступеньки ведут к настоящей микросхеме (полусумматор → сумматор → 74HC283),
 *   одиночный корпус — к сдвоенному (LM321 → LM358), и задачки, где открытое тут же применяют (АЛУ после 74HC283).
 * Цепочка перечислена по первому уровню каждого шага; варианты шага подтягиваются сами.
 */
const CHAINS: string[][] = [
  ["xnor", "hc7266", "eq2"],
  ["half", "full", "hc283", "alu4"],
  ["sr", "dlatch", "dff", "sreg4"],
  ["div2", "cnt4"],
  ["dlatchr", "dffr"],
  ["tffr", "cnt393"],
  ["dec2", "hc138"],
  ["seg7", "hc4511"],
  ["schmitt", "osc"],
  ["rcdb", "max6816"],
  ["lmv331", "lm393"],
  ["lm321", "lm358"],
  ["vref", "lm78l05"],
  ["johnson", "hc4017"],
  ["mag1", "hc85"],
  ["cnt1", "hc161"],
  ["sram1", "dram1", "ram4"],
  ["tbuf", "hc125", "hc244", "hc245"],
];
interface Group {
  /** Уровень, чьё имя у узла и чьё место на карте: последняя настоящая микросхема цепочки. */
  head: Level;
  levels: Level[];
  /** Цепочка (иначе — только варианты одного компонента). */
  chain: boolean;
}
const byFunc = (f: LogicFunc) => LEVELS.filter((l) => l.func === f);
const GROUPS: Group[] = (() => {
  const chained = new Set(CHAINS.flat().map((id) => LEVELS.find((l) => l.id === id)!.func));
  const chains = CHAINS.map((ids) => {
    const levels = ids.flatMap((id) => byFunc(LEVELS.find((l) => l.id === id)!.func));
    return { head: [...levels].reverse().find((l) => !l.intermediate) ?? levels.at(-1)!, levels, chain: true };
  });
  const single = [...new Set(LEVELS.map((l) => l.func))].filter((f) => !chained.has(f)).map((f) => ({ head: byFunc(f)[0], levels: byFunc(f), chain: false }));
  return [...single, ...chains];
})();
const groupOf = (id: string): Group | undefined => GROUPS.find((g) => g.levels.some((l) => l.id === id));
/** Узел карты, где собирается функция. */
const headOf = (f: LogicFunc): string => GROUPS.find((g) => g.levels.some((l) => l.func === f))!.head.id;
/** Группа открыта: собран её главный уровень (для вариантов — любой из них). */
const groupDone = (g: Group) => byFunc(g.head.func).some((l) => isDone(l.id));
/** Короткие подписи уроков на карте. */
const SHORT: Record<string, string> = {
  "intro-led": "зажечь светодиод",
  "intro-volts": "мультиметр: напряжение",
  "intro-amps": "мультиметр: ток",
  "intro-divider": "делитель напряжения",
  "intro-switch": "транзистор-ключ",
  "intro-scope": "осциллограф",
};
const W = 200, H = 64, COLW = 270, ROWH = 88, PAD = 40;
const at = (id: string) => ({ x: PAD + PLACE[id][0] * COLW, y: PAD + PLACE[id][1] * ROWH });

/** Из каких функций собирается уровень (по микросхемам набора). */
const needs = (l: Level): LogicFunc[] => l.kit.flatMap((k) => (k.part === "chip" ? [k.func] : []));

const variant = (l: Level) =>
  l.variant ??
  (l.id.endsWith("-cmos") ? "КМОП" : l.id.endsWith("-rtl") ? "РТЛ" : l.kit.some((k) => k.part === "chip") ? "из микросхем" : l.kit.some((k) => k.part === "bjt" || k.part === "mosfet") ? "из транзисторов" : "из деталей");

/** Короткие названия функций для узлов карты. */
const FUNC_SHORT: Partial<Record<LogicFunc, string>> = { xor: "Искл. ИЛИ", xnor: "XNOR", xnor4: "4 × XNOR", eq2: "сравнение", mux: "мультиплексор", add4: "сумматор 4 бит", sr: "память", dlatch: "память", dff: "память, по фронту", schmitt: "два порога", osc: "сам меняется", div2: "счёт", cnt4: "счёт", sreg4: "сдвиг", dlatchr: "память, сброс", dffr: "по фронту, сброс", sreg8: "сдвиг, 8 бит", tffr: "счёт по спаду", cnt393: "2 × счёт 4 бит", dec2: "выбор 1 из 4", dec3: "выбор 1 из 8", seg7: "цифра на индикатор", bcd7: "цифра, защёлка", rcdb: "без дребезга", debounce: "без дребезга, 50 мс", cmp: "сравнение напряжений", cmp2: "2 × сравнение", timer: "таймер, генератор", mag1: "больше, меньше, равно", mag4: "сравнение чисел", sreg595: "сдвиг и защёлка", addsub: "проект: + и −", opamp: "усилитель", opamp2: "2 × усилитель", vref: "опорное напряжение", reg5: "стабилизатор 5 В", johnson: "Джонсон, 10 состояний", cnt4017: "один из десяти", tbuf: "три состояния", tbuf4: "4 × три состояния", buf8z: "8 × на шину", reg8z: "регистр, 8 бит", mux4q: "4 × мультиплексор", cnt1: "разряд счёта", cnt161: "счёт, загрузка", reg173: "регистр, 4 бит", bus245: "шина в обе стороны", rom8: "память, 8 слов", ram4: "запись и чтение", sram1: "бит в защёлке", dram1: "бит в конденсаторе" };
/** Подпись узла: функция и вариант; не влезает — только вариант. */
function nodeSub(l: Level): string {
  const full = `${FUNC_SHORT[l.func] ?? FUNC_NAMES[l.func]} · ${variant(l)}`;
  return full.length > 27 ? variant(l) : full;
}

/** Подпись группы: функция и варианты («И-НЕ · КМОП, РТЛ») или число уровней цепочки; не влезают — их число. */
function groupSub(g: Group): string {
  const n = g.levels.length;
  if (n === 1) return nodeSub(g.head);
  const name = FUNC_SHORT[g.head.func] ?? FUNC_NAMES[g.head.func];
  const count = g.chain ? plural(n, "уровень", "уровня", "уровней") : plural(n, "вариант", "варианта", "вариантов");
  const full = g.chain ? `${name} · ${count}` : `${name} · ${g.levels.map(variant).join(", ")}`;
  return full.length > 27 ? count : full;
}
/** Имя уровня на вкладке группы: у вариантов — способ сборки, в цепочке — название (и способ, если их несколько). */
function tabLabel(g: Group, l: Level): string {
  if (!g.chain) return variant(l);
  return g.levels.filter((x) => x.func === l.func).length > 1 ? `${l.part} · ${variant(l)}` : l.part;
}

export class CareerMap {
  readonly el: HTMLElement;
  private chosen?: string;

  constructor(private host: MapHost) {
    this.el = document.createElement("div");
    this.el.className = "screen map-screen";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Карта карьеры");
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const node = t.closest<SVGGElement>("[data-node]")?.dataset.node;
      if (node && node !== "parts") {
        // Группа: остаёмся на выбранном уровне, иначе — первый, который можно собрать, или первый не пройденный
        const g = groupOf(node);
        this.chosen = !g ? node : g.levels.some((l) => l.id === this.chosen) ? this.chosen : (g.levels.find((l) => !isDone(l.id) && !missing(l).length) ?? g.levels.find((l) => !isDone(l.id)) ?? g.head).id;
        return this.render();
      }
      const v = t.closest<HTMLElement>("[data-variant]")?.dataset.variant;
      if (v) {
        this.chosen = v;
        return this.render();
      }
      const act = t.closest<HTMLElement>("[data-map]")?.dataset.map;
      if (act === "start" || act === "restart") this.host.startLevel(this.chosen!, act === "restart");
      if (act === "workshop") this.host.openWorkshop();
      if (act === "menu") this.host.openMenu();
      if (act === "close") this.host.closeMap();
    });
    document.body.appendChild(this.el);
  }

  show(focus?: string): void {
    if (focus) this.chosen = focus;
    this.render();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  private render(): void {
    const done = LEVELS.filter((l) => isDone(l.id)).length;
    const cols = Math.max(...Object.values(PLACE).map(([c]) => c));
    const rows = Math.max(...Object.values(PLACE).map(([, r]) => r));
    const width = PAD * 2 + cols * COLW + W;
    const height = PAD * 2 + rows * ROWH + H;
    // Стрелки: от деталей ко всем вентилям; от вентилей — к тому, что из них собирается
    const edges: string[] = [];
    const edge = (from: string, to: string, lit: boolean) => {
      const a = at(from), b = at(to);
      const cls = `class="edge${lit ? " lit" : ""}" marker-end="url(#arrow${lit ? "-lit" : ""})"`;
      // В одном столбце — сверху вниз, между столбцами — слева направо
      if (PLACE[from][0] === PLACE[to][0]) {
        edges.push(`<path ${cls} d="M${a.x + W / 2} ${a.y + H}L${b.x + W / 2} ${b.y}"/>`);
        return;
      }
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
      edges.push(`<path ${cls} d="M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`);
    };
    // Введение: урок за уроком, последний ведёт к деталям (рекомендовано, но не обязательно)
    LESSONS.forEach((l, i) => edge(l.id, LESSONS[i + 1]?.id ?? "parts", isDone(l.id)));
    // Ремонт — отдельной цепочкой после уроков про приборы (рекомендовано, не обязательно)
    edge(LESSONS.at(-1)!.id, REPAIRS[0].id, isDone(LESSONS.at(-1)!.id));
    REPAIRS.slice(1).forEach((r, i) => edge(REPAIRS[i].id, r.id, isDone(REPAIRS[i].id)));
    // Между группами: одна стрелка на пару, сколько бы уровней ни было с обеих сторон; внутри цепочки стрелок нет.
    // Горит, если собрано хоть что-то из того, что берётся из группы-источника.
    const funcDone = (f: LogicFunc) => byFunc(f).some((l) => isDone(l.id));
    const link = (to: string, funcs: LogicFunc[], skip: (src: string) => boolean = () => false) => {
      const lit = new Map<string, boolean>();
      for (const f of funcs) {
        const src = headOf(f);
        if (src !== to && !skip(src)) lit.set(src, (lit.get(src) ?? false) || funcDone(f));
      }
      for (const [src, on] of lit) edge(src, to, on);
    };
    for (const g of GROUPS) {
      if (g.levels.some((l) => !needs(l).length)) edge("parts", g.head.id, true);
      link(g.head.id, g.levels.flatMap(needs));
    }
    // Проекты: от микросхем набора (базовые вентили слева не тянем через всю карту)
    // ПЗУ в наборе — стрелка от уровня, который его открывает
    for (const pr of PROJECTS) link(pr.id, pr.kit.flatMap((k): LogicFunc[] => (k.part === "chip" ? [k.func] : k.part === "other" && k.type === "chip" ? (k.tool.includes("prom") ? ["rom8"] : k.tool.includes("ram") ? ["ram4"] : []) : [])), (src) => PLACE[src][0] < 4);
    const nodes = [
      `<g class="node done root" data-node="parts" transform="translate(${at("parts").x} ${at("parts").y})"><rect width="${W}" height="${H}" rx="10"/><text x="14" y="27" class="t">Детали</text><text x="14" y="47" class="s">транзисторы и резисторы</text></g>`,
      ...LESSONS.map((l, i) => {
        const p = at(l.id);
        return `<g class="node ${isDone(l.id) ? "done" : "open"} lesson${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.title)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">Урок ${i + 1}${isDone(l.id) ? " ✓" : ""}</text>
          <text x="14" y="47" class="s">${esc(SHORT[l.id] ?? l.title)}</text></g>`;
      }),
      ...REPAIRS.map((l, i) => {
        const p = at(l.id);
        return `<g class="node ${isDone(l.id) ? "done" : "open"} lesson repair${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.title)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">Ремонт ${i + 1}${isDone(l.id) ? " ✓" : ""}</text>
          <text x="14" y="47" class="s">${esc(l.title.length > 25 ? l.title.slice(0, 24) + "…" : l.title)}</text></g>`;
      }),
      ...PROJECTS.map((l, i) => {
        const p = at(l.id);
        const state = isDone(l.id) ? "done" : missing(l).length ? "locked" : "open";
        return `<g class="node ${state} lesson project${this.chosen === l.id ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.title)}">
          <rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">Проект ${i + 1}${state === "done" ? " ✓" : state === "locked" ? " 🔒" : ""}</text>
          <text x="14" y="47" class="s">${esc(l.title)}</text></g>`;
      }),
      ...GROUPS.map((g) => {
        const l = g.head, p = at(l.id), n = g.levels.length;
        const done = g.levels.filter((x) => isDone(x.id)).length;
        const state = groupDone(g) ? "done" : g.levels.every((x) => isDone(x.id) || missing(x).length) ? "locked" : "open";
        // Задачи: ★ — все выполнены, ☆ — есть невыполненные
        const goals = g.levels.flatMap((x) => (x.goals ?? []).map((q) => goalMet(q, bestOf(x.id))));
        const star = goals.length ? (goals.every(Boolean) ? " ★" : " ☆") : "";
        // Сколько уровней группы пройдено, если не все
        const part = n > 1 && done && done < n ? ` ${done}/${n}` : "";
        const mark = (state === "done" ? " ✓" : state === "locked" ? " 🔒" : "") + part;
        const chosen = g.levels.some((x) => x.id === this.chosen);
        return `<g class="node ${state}${g.levels.every((x) => x.intermediate) ? " step" : ""}${n > 1 ? " group" : ""}${chosen ? " chosen" : ""}" data-node="${l.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(l.part)}">
          ${n > 1 ? `<rect class="stack" x="5" y="-5" width="${W}" height="${H}" rx="10"/>` : ""}<rect width="${W}" height="${H}" rx="10"/>
          <text x="14" y="27" class="t">${esc(l.part)}${mark}${star}</text>
          <text x="14" y="47" class="s">${esc(groupSub(g))}</text></g>`;
      }),
    ];
    const chosen = this.chosen ? LEVELS.find((l) => l.id === this.chosen) : undefined;
    const lesson = this.chosen ? stageById(this.chosen) : undefined;
    this.el.innerHTML = `<header class="map-head">
        <div><div class="eyebrow">карьера</div><h2>Открыто ${done} из ${LEVELS.length} · уроков ${LESSONS.filter((l) => isDone(l.id)).length} из ${LESSONS.length} · ремонтов ${REPAIRS.filter((l) => isDone(l.id)).length} из ${REPAIRS.length} · проектов ${PROJECTS.filter((l) => isDone(l.id)).length} из ${PROJECTS.length} · задач ${LEVELS.flatMap((l) => (l.goals ?? []).filter((g) => goalMet(g, bestOf(l.id)))).length} из ${LEVELS.flatMap((l) => l.goals ?? []).length}</h2></div>
        <div class="row">
          ${this.host.hasTable() ? `<button class="btn inline" data-map="close">К столу</button>` : ""}
          <button class="btn inline" data-map="workshop">Мастерская</button>
          <button class="btn inline" data-map="menu">Меню</button>
        </div>
      </header>
      <div class="map-body">
        <div class="map-scroll"><svg viewBox="0 0 ${width} ${height}" class="map-svg" style="max-width:${width}px;min-width:${Math.round(width * 0.7)}px">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="arrow"/></marker>
            <marker id="arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="arrow lit"/></marker>
          </defs>
          ${edges.join("")}${nodes.join("")}
        </svg></div>
        <aside class="map-card">${lesson ? this.lessonCard(lesson) : chosen ? this.card(chosen) : `<p class="sub">Начните с введения слева, если приборы и детали пока незнакомы, — или сразу с вентилей. Выберите компонент на карте. Зелёные — открыты, светлые — можно собирать, серые — сначала откройте то, из чего они собираются.</p><p class="sub">Мастерская — свободный стол: базовые детали и все открытые модули.</p>`}</aside>
      </div>`;
  }

  private lessonCard(l: Lesson): string {
    const started = !!loadSlot(l.id);
    const need = l.project ? missing(l) : [];
    const buttons = need.length
      ? `<p class="sub bad">Сначала откройте: ${esc(need.join(", "))}.</p>`
      : `<div class="row"><button class="btn inline primary" data-map="start">${started ? "Продолжить" : isDone(l.id) ? "Пройти ещё раз" : "Начать"}</button>
      ${started ? `<button class="btn inline" data-map="restart">Начать заново</button>` : ""}</div>`;
    return `<div class="eyebrow">${l.repair ? `ремонт ${REPAIRS.indexOf(l) + 1}` : l.project ? `проект ${PROJECTS.indexOf(l) + 1} · из открытых микросхем` : `введение · урок ${LESSONS.indexOf(l) + 1}`}</div>
      <h3>${esc(l.title)}${isDone(l.id) ? " ✓" : ""}</h3>
      <p>${esc(l.about)}</p>
      ${l.kit.length ? `<div class="eyebrow">набор</div><ul class="kitlist">${l.kit.map((k) => `<li>${esc(kitLabel(k))} × ${k.count}</li>`).join("")}</ul>` : ""}
      ${buttons}`;
  }

  private card(l: Level): string {
    const need = missing(l);
    const io = gateIo(l);
    const pins = l.roles.map((r, i) => `${i + 1} ${l.names[i] || PIN_ROLES[r].name}`).join(", ");
    const started = !!loadSlot(l.id);
    const buttons = need.length
      ? `<p class="sub bad">Сначала откройте: ${esc(need.join(", "))}.</p>`
      : `<div class="row"><button class="btn inline primary" data-map="start">${started ? "Продолжить" : isDone(l.id) ? "Собрать ещё раз" : "Собрать"}</button>
         ${started ? `<button class="btn inline" data-map="restart">Начать заново</button>` : ""}</div>`;
    const group = groupOf(l.id)!;
    const tabs = group.levels.length > 1
      ? `<div class="variants" role="tablist">${group.levels.map((x) => `<button class="btn inline${x === l ? " primary" : ""}" role="tab" aria-selected="${x === l}" data-variant="${x.id}">${esc(tabLabel(group, x))}${isDone(x.id) ? " ✓" : missing(x).length ? " 🔒" : ""}</button>`).join("")}</div>`
      : "";
    return `${tabs}<div class="eyebrow">${esc(FUNC_NAMES[l.func])} · ${variant(l)}</div>
      <h3>${esc(l.part)}${isDone(l.id) ? " ✓" : ""}</h3>
      <p>${esc(l.about)}</p>
      ${l.intermediate ? `<p class="sub">Учебная: такой микросхемы не выпускают, в мастерской и песочнице её нет.</p>` : ""}
      <div class="eyebrow">набор</div>
      <ul class="kitlist">${l.kit.map((k) => `<li>${esc(kitLabel(k))} × ${k.count}</li>`).join("")}</ul>
      ${bestOf(l.id) ? `<div class="eyebrow">лучшие цифры</div>${metricsHtml(undefined, bestOf(l.id))}` : ""}
      ${l.goals ? `<div class="eyebrow">задачи (необязательные)</div><ul class="kitlist">${l.goals.map((g) => `<li>${goalMet(g, bestOf(l.id)) ? "✓" : "☐"} ${esc(g.text)}</li>`).join("")}</ul>` : ""}
      <div class="eyebrow">корпус ${packageName(l.package ?? "SOT-23-5", l.roles.length)}</div><p class="sub">${esc(pins)}; ${plural(io.inputs.length, "вход", "входа", "входов")}${io.outputs.length > 1 ? `, ${plural(io.outputs.length, "выход", "выхода", "выходов")}` : ""}.${l.sequence ? " С памятью: проверяется последовательностью шагов." : ""}${l.check === "sweep" ? " Проверяются ещё пороги: вход плавно растёт и падает." : l.check === "osc" ? " Проверка записывает выход 6 секунд, как осциллограф." : l.check === "bounce" ? " Проверка нажимает кнопку с дребезгом и следит, сколько раз переключится выход." : l.check === "compare" ? " Проверка подаёт на входы напряжения с разницей 50 мВ и 1 В." : l.check === "timer" ? " Проверка: таблица по шагам и работа генератором." : l.check === "opamp" ? " Проверка включает его повторителем и усилителем ×2, под нагрузкой и без обратной связи." : l.check === "regulator" ? " Проверка меняет входное напряжение и нагрузку и меряет выход и ток покоя." : ""}</p>
      ${buttons}`;
  }
}
