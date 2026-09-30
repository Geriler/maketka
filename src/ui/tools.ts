/** Инструменты: встроенные и установки деталей (из реестра src/parts), горячие клавиши встроенных, кнопки. */

import type { Component } from "../model/types";
import { PARTS, type ToolDef } from "../parts";
import { LEVELS, type LogicFunc } from "../career/levels";
import { isMemory } from "../chips/memory";

/** Инструмент: встроенный (выбор, провод, дорожка, платы, удаление) или установка детали (id из PartDef.tools). */
export type Tool = "select" | "wire" | "trace" | "bb" | "pcb" | "smdb" | "delete" | PlaceTool;
export type PlaceTool = string;

/** Инструменты установки деталей из реестра: id → тип детали и описание инструмента. Список меняется (микросхемы библиотеки). */
export function placeTools(): Map<PlaceTool, { type: Component["type"]; def: ToolDef }> {
  const all = new Map(Object.values(PARTS).flatMap((p) => p.tools.map((t) => [t.id, { type: p.type, def: t as ToolDef }] as const)));
  for (const k of kit) all.set(k.id, { type: k.type as Component["type"], def: k.def });
  return all;
}

/** Инструменты набора уровня карьеры (приложение обновляет их при каждом изменении схемы). */
let kit: { id: string; type: string; def: ToolDef }[] = [];
export function setKitTools(list: typeof kit): void {
  kit = list;
}

/** Какие инструменты показывать (в карьере — только набор и приборы). */
let visible: (tool: string) => boolean = () => true;
export function setToolFilter(f: (tool: string) => boolean): void {
  visible = f;
}
/** Горячие клавиши инструментов (в латинской и в русской раскладке). Детали выбираются только кнопками. */
export const TOOL_KEYS: Record<string, Tool> = {
  "1": "select", "2": "wire",
  t: "trace", T: "trace", "е": "trace", "Е": "trace",
  b: "bb", B: "bb", "и": "bb", "И": "bb", v: "pcb", V: "pcb", "м": "pcb", "М": "pcb",
};

/**
 * Разделы меню микросхем — по тому, что микросхема делает: иначе список из десятков обозначений
 * не помещается на экран. Микросхемы, собранные в песочнице, — в разделе «Свои».
 */
const CHIP_CATS: { name: string; funcs: LogicFunc[] }[] = [
  { name: "Вентили", funcs: ["not", "nand", "nor", "and", "or", "xor", "xnor", "xnor4", "buf", "schmitt"] },
  { name: "Выбор", funcs: ["mux", "mux4q", "dec2", "dec3", "seg7", "bcd7"] },
  { name: "Числа", funcs: ["half", "full", "add4", "addsub", "eq2", "mag1", "mag4"] },
  { name: "Память", funcs: ["sr", "dlatch", "dff", "dlatchr", "dffr", "sreg4", "sreg8", "sreg595", "reg8z", "reg173", "rom8", "ram4", "sram1", "dram1"] },
  { name: "Счёт и время", funcs: ["div2", "cnt4", "tffr", "cnt393", "cnt1", "cnt161", "johnson", "cnt4017", "timer", "osc", "rcdb", "debounce"] },
  { name: "Шина", funcs: ["tbuf", "tbuf4", "buf8z", "bus245"] },
  { name: "Аналоговые", funcs: ["cmp", "cmp2", "opamp", "opamp2", "vref", "reg5"] },
];
const OWN = "Свои";
/** Раздел микросхемы по инструменту chip:ref:… / chip:career:… (обозначение уровня карьеры). */
export function chipCat(toolId: string): string {
  if (isMemory(toolId.replace(/^chip:/, ""))) return "Память";
  const level = LEVELS.find((l) => l.id === toolId.match(/^chip:(?:ref|career):(.+)$/)?.[1]);
  return (level && CHIP_CATS.find((c) => c.funcs.includes(level.func))?.name) ?? OWN;
}
/** Открытый раздел (запоминается в браузере; нет — первый непустой). */
let chipTab = (() => {
  try {
    return localStorage.getItem("maketka.chipTab") ?? "";
  } catch {
    return "";
  }
})();

/** Показать в меню микросхем только раздел name. */
function showChipTab(body: Element, name: string): void {
  chipTab = name;
  try {
    localStorage.setItem("maketka.chipTab", name);
  } catch {
    /* без памяти — ничего */
  }
  body.querySelectorAll<HTMLElement>("[data-chip-cat]").forEach((b) => (b.hidden = b.dataset.chipCat !== name));
  body.querySelectorAll<HTMLElement>("[data-chip-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.chipTab === name)));
}

/** Кнопки инструментов деталей — в группы на панели слева, в порядке реестра. */
export function renderToolButtons(tools: HTMLElement): void {
  // Перерисовка (библиотека микросхем поменялась): сначала убрать прежние кнопки деталей
  tools.querySelectorAll(".group-body [data-part-tool]").forEach((b) => b.remove());
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const chips: { def: ToolDef; cat: string }[] = [];
  for (const { def } of placeTools().values()) {
    if (!def.group || !visible(def.id)) continue;
    const body = tools.querySelector(`details[data-group="${def.group}"] .group-body`);
    const cat = def.group === "chips" ? chipCat(def.id) : undefined;
    if (cat) chips.push({ def, cat });
    body?.insertAdjacentHTML(
      "beforeend",
      `<button class="tool" data-tool="${def.id}" data-part-tool aria-pressed="false" title="${def.title.replace(/"/g, "&quot;")}"${cat ? ` data-chip-cat="${cat}"` : ""}>
        <svg viewBox="0 0 30 18">${def.icon}</svg>${def.sub ? `<span class="tool-name">${esc(def.label)}<small>${esc(def.sub)}</small></span>` : esc(def.label)}
      </button>`,
    );
  }
  // Микросхемы — по разделам: сверху вкладки непустых разделов, ниже — только выбранный
  const chipBody = tools.querySelector('details[data-group="chips"] .group-body');
  if (chipBody && chips.length) {
    const names = [...CHIP_CATS.map((c) => c.name), OWN].filter((n) => chips.some((c) => c.cat === n));
    chipBody.insertAdjacentHTML(
      "afterbegin",
      `<div class="chip-tabs" data-part-tool role="group" aria-label="Разделы микросхем">${names
        .map((n) => `<button type="button" class="chip-tab" data-chip-tab="${n}" aria-pressed="false">${esc(n)} <small>${chips.filter((c) => c.cat === n).length}</small></button>`)
        .join("")}</div>`,
    );
    showChipTab(chipBody, names.includes(chipTab) ? chipTab : names[0]);
    if (!(chipBody as HTMLElement).dataset.tabsBound) {
      (chipBody as HTMLElement).dataset.tabsBound = "1";
      // Список выпадает от кнопки группы и мог уйти за нижний край окна: высота — до края, дальше прокрутка
      // Не помещается вниз — список поднимается вверх, насколько позволяет окно
      const fit = () => {
        const el = chipBody as HTMLElement;
        el.style.removeProperty("max-height");
        el.style.removeProperty("top");
        if (getComputedStyle(el).position === "fixed") return;
        const box = el.getBoundingClientRect();
        const lift = Math.max(0, Math.min(box.bottom - (window.innerHeight - 12), box.top - 12));
        if (lift) el.style.top = `${parseFloat(getComputedStyle(el).top) - lift}px`;
        el.style.maxHeight = `${Math.max(160, window.innerHeight - (box.top - lift) - 12)}px`;
      };
      chipBody.closest("details")?.addEventListener("toggle", fit);
      window.addEventListener("resize", fit);
      chipBody.addEventListener("click", (e) => {
        const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-chip-tab]");
        if (tab) {
          showChipTab(chipBody, tab.dataset.chipTab!);
          fit();
        }
      });
    }
  }
  // Встроенные инструменты (выбор, провод, платы…) — тоже по фильтру
  tools.querySelectorAll<HTMLElement>(".tool[data-tool]:not([data-part-tool])").forEach((b) => (b.hidden = !visible(b.dataset.tool!)));
  // Пустую группу не показываем (например, «Микросхемы», пока своих нет)
  tools.querySelectorAll<HTMLElement>("details[data-group]").forEach((g) => (g.hidden = !g.querySelector(".group-body [data-tool]")));
}
