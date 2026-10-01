import * as THREE from "three";
import { HOLE_BY_ID, MODULE_ROWS, holeLabel, isModule, isSot, packageName, pinLayoutText, pinOffsets } from "../model/breadboard";
import type { Chip, ChipDef } from "../model/types";
import { countChip, countChips, countDetails, countShort } from "../chips/count";
import { resolveChip, toolChips } from "../chips/registry";
import { CMOS_INPUT, INPUT_BAND, MAX_FLIPS, MODEL_MAX_OUT, MODEL_OFF, REF_ABS_MAX, X_FACTOR, modelAt, type ChipModel, type ModelState } from "../chips/model";
import type { Simulation } from "../sim/simulation";
import { pinNode } from "../sim/nodes";
import { formatOhms, formatSI } from "../sim/resistorCodes";
import { type ComponentView, blackPlastic, disposeGroup, freeTransform, lead, mm, tagPickable } from "../view/kit";
import { kv, pill, selectField } from "../view/panel";
import { PIN_ROLES } from "../chips/roles";
import { chipAbout, chipKind } from "../chips/about";
import { hex2, isMemory, memWord, memoryInfo, parseWord, ramGarbage, smdFootprintOf, type MemoryInfo } from "../chips/memory";
import { toolFor, type PartDef } from "./types";

/** Подпись вывода корпуса: имя, у неподключённого — NC. */
export function chipPinName(def: ChipDef, i: number): string {
  const role = def.pinRoles?.[i] ?? "nc";
  return role === "nc" ? "NC" : def.pinNames[i] || PIN_ROLES[role].name;
}

/** Инструмент установки микросхемы из библиотеки. */
export function chipTool(def: ChipDef) {
  const soic = !isSot(def.package) && !isModule(def.package) && [4, 6, 8, 14, 16, 18, 20, 24, 28].includes(def.pins);
  // SMD-исполнение: SO-n (SOIC) или своё, если у микросхемы оно другое (SOP-28 на 450 мил у HM62256B)
  const smdFp = smdFootprintOf(def.id) ?? `SO-${def.pins}`;
  const smdName = smdFp === "SOP-28" ? "SOP-28 (SMD, 450 мил)" : `SO-${def.pins} (SMD, SOIC)`;
  const about = chipAbout(def.id);
  const kind = chipKind(def.id);
  return toolFor<Chip>()({
    id: `chip:${def.id}`,
    group: "chips",
    icon: `<rect x="7" y="4" width="16" height="10" rx="1" /><path d="M9 4V1M13 4V1M17 4V1M21 4V1M9 14v3M13 14v3M17 14v3M21 14v3" /><circle cx="9.5" cy="11.5" r="1" />`,
    label: def.name,
    ...(kind ? { sub: kind } : {}),
    title: `${def.name} — ${about ?? `${packageName(def.package, def.pins)}, ${def.id.startsWith("ref:") ? "заводская" : "собрана вами"}`}`,
    settings: { smd: false },
    name: () => def.name,
    note: (s) =>
      (about ? `<p>${about}</p>` : "") +
      (s.smd && soic
        ? `<p class="sub">${smdName}, шаг 1,27 мм — та же микросхема без ножек, выводы нумеруются как у DIP: ${def.pinNames.map((_, i) => `${i + 1} ${chipPinName(def, i)}`).join(", ")}. Ставится только на плату под SMD — под ней появятся площадки.</p>`
        : isModule(def.package)
          ? `<p class="sub">Модуль — своя плата с деталями на штыревом разъёме, стоит на нём вертикально: ${def.pinNames.map((_, i) => `${i + 1} ${chipPinName(def, i)}`).join(", ")}. Выводы — в один ряд через 2,54 мм: в макетке — вдоль ряда (каждый вывод в своём столбце), на плате под SMD — в свои отверстия.</p>`
          : `<p class="sub">${packageName(def.package, def.pins)}${isSot(def.package) ? " на переходнике" : ""}: ${def.pinNames.map((_, i) => `${i + 1} ${chipPinName(def, i)}`).join(", ")}. Встаёт поперёк центральной канавки макетки${def.package === "DIPW" ? " (ряды f и b: между рядами выводов 15,24 мм)" : ""}: ${pinLayoutText(def.package, def.pins)}. На плате под SMD ${isSot(def.package) ? "встаёт без переходника, на свои площадки" : "делает себе отверстия где угодно"}.</p>`),
    // У DIP есть исполнение в SOIC — выбор корпуса
    editor: (s) => (soic ? selectField("chipBody", "Корпус", [["dip", `${packageName(def.package, def.pins)} (выводной)`], ["soic", smdName]], s.smd ? "soic" : "dip") : ""),
    set(s, field, value) {
      if (field === "chipBody") s.smd = value === "soic";
    },
    create: (s) => ({ type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, ...(s.smd && soic ? { smd: true } : {}) }),
    hint: () => isModule(def.package) ? `Нажмите на отверстие — туда встанет вывод 1, остальные ${def.pins - 1} — вправо по ряду. R — повернуть.` : `Нажмите на отверстие ряда f у канавки — туда встанет вывод 1: ${pinLayoutText(def.package, def.pins)}, дальний ряд — в ряду ${def.package === "DIPW" ? "b (корпус на 600 мил перекрывает канавку и ещё три ряда)" : "e"}. R — повернуть (до установки или выделенную): на печатной плате и корпусе — в любую сторону.`,
  });
}

export const chip: PartDef<Chip> = {
  type: "chip",
  prefix: "D",
  pins: 0,
  pinLabel: (c, i, scene) => {
    const def = resolveChip(scene, c.def);
    return def ? `${i + 1} ${chipPinName(def, i)}` : `вывод ${i + 1}`;
  },
  pinCount: (c) => c.pins,
  // Вложенная микросхема занимает столько, сколько её начинка
  chipSpace: (c, scene) => {
    const def = resolveChip(scene, c.def);
    return def ? def.space ?? def.parts.length : c.pins;
  },
  where: (_c, holes) => holes.map((h, i) => `${i + 1} ${holeLabel(h)}`).join(", "),
  onBoard: () => true,
  // Инструменты — заводские компоненты карьеры и по одному на свою микросхему библиотеки
  get tools() {
    return toolChips().map(chipTool);
  },
  polar: () => true,
  label: (c) => `${c.name} (${packageName(c.package, c.pins)})`,
  value: (c) => c.name,
  burn: (c) => [`Микросхема ${c.id} вышла из строя`, "Сгорела деталь внутри или перегружен выход. Посмотрите, куда подключены выходы, откройте её схему (в панели микросхемы) или замените микросхему новой."],
  burnedWord: "ВЫШЛА ИЗ СТРОЯ",
  view: chipView,

  schematicParts: (c, sim) => {
    const def = resolveChip(sim.scene, c.def);
    return [
      {
        key: "",
        pins: Array.from({ length: c.pins }, (_, i) => i),
        box: Array.from({ length: c.pins }, (_, i) => `${i + 1} ${def ? chipPinName(def, i) : ""}`.trim()),
        value: def?.name ?? "нет описания",
        current: 0,
      },
    ];
  },

  // Начинка — отдельные детали (Simulation разворачивает её); здесь — только соединения с выводами.
  // Проверенная микросхема считается моделью: ключи выходов, входы и ток покоя
  stamp(c, sim, { links, out }) {
    const model = sim.modelOf(c.id);
    if (sim.state(c.id).burned) return;
    if (model) {
      const node = (p: number) => pinNode(c, p - 1);
      const q = sim.junction.get(`${c.id}:q`);
      const on = q !== undefined && q >= 0;
      const pt = modelAt(model, supply(c, model, sim) ?? model.vmax);
      out.push({ id: `${c.id}:iq`, a: node(model.vcc), b: node(model.gnd), r: pt.volts / Math.max(pt.iq, pt.volts / MODEL_OFF) });
      model.inputs.forEach((p, i) => {
        // Вход КМОП ни к чему не тянется: висящий уходит к середине питания — там он «ни то ни сё»
        if (pt.rIn[i] >= CMOS_INPUT) {
          out.push({ id: `${c.id}:in${i}`, a: node(p), b: node(model.gnd), r: 2 * pt.rIn[i] });
          out.push({ id: `${c.id}:iv${i}`, a: node(model.vcc), b: node(p), r: 2 * pt.rIn[i] });
        } else out.push({ id: `${c.id}:in${i}`, a: node(p), b: node(model.gnd), r: pt.rIn[i] });
      });
      const zm = sim.junction.get(`${c.id}:zm`) ?? 0;
      model.outputs.forEach((p, k) => {
        // Третье состояние: оба ключа закрыты — выход отключён
        const z = on && !!(zm & (1 << k));
        // Неопределённый выход (вход «висит»): оба ключа приоткрыты — выход посередине, и течёт сквозной ток
        const x = on && !z && !!(q! & (1 << (k + 16)));
        const high = on && !z && !x && !!(q! & (1 << k));
        const low = on && !z && !x && !high;
        // Включённый ключ — источник: единица на dHigh ниже питания, ноль на dLow выше общего, и сопротивление
        out.push({ id: `${c.id}:h${k}`, a: node(model.vcc), b: node(p), r: high ? pt.rHigh[k] : x ? X_FACTOR * pt.rHigh[k] : MODEL_OFF, emf: high ? -pt.dHigh[k] : 0 });
        out.push({ id: `${c.id}:l${k}`, a: node(p), b: node(model.gnd), r: low ? pt.rLow[k] : x ? X_FACTOR * pt.rLow[k] : MODEL_OFF, emf: low ? -pt.dLow[k] : 0 });
      });
      return;
    }
    const def = resolveChip(sim.scene, c.def);
    if (!def) return;
    for (const net of def.nets) {
      const nodes = [
        ...net.members.map(([id, p]) => `pin:${c.id}/${id}:${p}`),
        ...(net.pins ?? []).filter((n) => n <= c.pins).map((n) => pinNode(c, n - 1)),
      ];
      for (let i = 1; i < nodes.length; i++) links.push([nodes[0], nodes[i]]);
    }
  },
  /**
   * Модель: какие выходы включены — по входам из прошлого решения. Состояние меняется, пока не
   * устоится; число переключений на решение ограничено (как у блока питания), иначе кольцо из
   * инверторов без задержки качалось бы вечно.
   */
  newton(c, sim, iter, shared) {
    const model = sim.modelOf(c.id);
    if (!model || sim.state(c.id).burned) return true;
    const span = supply(c, model, sim) ?? 0;
    // Без питания выходы отключены. Вход: ниже 30 % питания — ноль, выше 70 % — единица, между — не
    // определён; выход, который от него зависит, тоже не определён
    let q = -1;
    if (span > 0.5) {
      // Схема с памятью качается внутри шага (счёт → сброс → снова тот же фронт…): тогда входы
      // идут как события по порядку — сброс, отпущенный без нового фронта, оставляет ноль
      if (model.state && (shared.per?.get(c.id) ?? 0) >= 2) sim.junction.set(`${c.id}:rl`, 1);
      const prev = sim.junction.get(`${c.id}:rl`) ? runState(c, model, sim) : (sim.memory.get(`${c.id}:seq`) as ModelState | undefined);
      const levels = inputLevels(c, model, sim, prev);
      const open = levels.map((l, i) => (l === undefined ? i : -1)).filter((i) => i >= 0);
      const tries = open.length > 4 ? [] : Array.from({ length: 1 << open.length }, (_, m) => levels.map((l, i) => l ?? !!(m & (1 << open.indexOf(i)))));
      const data = memData(c, model, sim);
      const results = tries.map((bits) => model.logic(bits, prev, data));
      if (model.state && tries.length === 1) {
        sim.junction.set(`${c.id}:rs`, model.state(tries[0], prev));
        sim.junction.set(`${c.id}:ri`, tries[0].reduce((m, b, i) => m | (b ? 1 << i : 0), 0));
      }
      q = 0;
      model.outputs.forEach((_, k) => {
        const vals = new Set(results.map((r) => r[k]));
        if (vals.size !== 1) q |= 1 << (k + 16);
        else if ([...vals][0]) q |= 1 << k;
      });
    }
    const key = `${c.id}:q`;
    // Отключённые выходы — по входам (если входы определены; иначе как было)
    const zkey = `${c.id}:zm`;
    let zm = sim.junction.get(zkey) ?? 0;
    if (model.z && span > 0.5) {
      const lv = inputLevels(c, model, sim, sim.memory.get(`${c.id}:seq`) as ModelState | undefined);
      if (lv.every((l) => l !== undefined)) zm = model.z(lv as boolean[]).reduce((m, b, k) => m | (b ? 1 << k : 0), 0);
    }
    if (zm !== (sim.junction.get(zkey) ?? 0)) {
      sim.junction.set(zkey, zm);
      if (sim.junction.get(key) === q) return false;
    }
    if (sim.junction.get(key) === q || shared.flips >= 64) return true;
    // Качается в петле без задержки — генерирует быстрее, чем видно: выходы «не определены»
    const per = (shared.per ??= new Map());
    const n = (per.get(c.id) ?? 0) + 1;
    if (n > MAX_FLIPS && q >= 0) {
      const x = model.outputs.reduce((m, _, k) => m | (1 << (k + 16)), 0);
      if (sim.junction.get(key) === x) return true;
      q = x;
    }
    // Уже качается (две смены за решение) — за итерацию меняется только одна такая модель: иначе
    // защёлка из двух вентилей переключается обеими половинами разом и ходит 00 ↔ 11 без конца
    if (n > 2) {
      if (shared.swingIter === iter) return false;
      shared.swingIter = iter;
    }
    per.set(c.id, n);
    sim.junction.set(key, q);
    shared.flips++;
    return false;
  },
  // Расчёт установился: запомнить входы и выходы — по ним триггер помнит своё и узнаёт фронт
  commit(c, sim) {
    const model = sim.modelOf(c.id);
    // ОЗУ: без питания содержимое пропадает; с питанием — запись, пока держится сигнал записи
    if (model?.ram) {
      const span = supply(c, model, sim) ?? 0;
      if (span < RAM_KEEP) sim.memory.delete(`${c.id}:ram`);
      else {
        const lv = inputLevels(c, model, sim, sim.memory.get(`${c.id}:seq`) as ModelState | undefined);
        const w = lv.every((l) => l !== undefined) ? model.ram.write(lv as boolean[]) : undefined;
        if (w) memData(c, model, sim)![w[0]] = w[1];
      }
    }
    // EEPROM: байт — на фронте после импульса записи, если питания хватает и цикл не идёт
    if (model?.eeprom) eepromCommit(c, model, sim);
    const q = sim.junction.get(`${c.id}:q`);
    if (!model || q === undefined || q < 0) return;
    const looped = !!sim.junction.get(`${c.id}:rl`);
    const prev = looped ? runState(c, model, sim) : (sim.memory.get(`${c.id}:seq`) as ModelState | undefined);
    const inputs = inputLevels(c, model, sim, prev).map((l) => !!l);
    const state = model.state?.(inputs, prev);
    for (const k of ["rs", "ri", "rl"]) sim.junction.delete(`${c.id}:${k}`);
    sim.memory.set(`${c.id}:seq`, { inputs, outputs: model.outputs.map((_, k) => !!(q & (1 << k))), ...(state !== undefined ? { state } : {}) } satisfies ModelState);
  },
  // Перегрузка: самый нагруженный выход модели (предел как у логики 74-й серии) и питание сверх предельного
  load(c, sim) {
    const model = sim.modelOf(c.id);
    // Предел питания: из модели, иначе из описания заводской микросхемы (у аналоговых модели нет)
    const absMax = model?.absMax ?? resolveChip(sim.scene, c.def)?.absMax ?? (c.def.startsWith("ref:") ? REF_ABS_MAX : undefined);
    let worst = 0;
    model?.outputs.forEach((_, k) => {
      for (const key of [`${c.id}:h${k}`, `${c.id}:l${k}`]) worst = Math.max(worst, Math.abs(sim.branch(key).current));
    });
    const def = model ? undefined : resolveChip(sim.scene, c.def);
    const span = model ? supply(c, model, sim) : def ? defSupply(c, def, sim) : undefined;
    const byVolts = absMax && span ? span / absMax : 0;
    if (!model && !byVolts) return undefined;
    return byVolts > worst / MODEL_MAX_OUT
      ? { ratio: byVolts, what: "напряжение", limit: formatSI(absMax!, "В") }
      : { ratio: worst / MODEL_MAX_OUT, what: "ток", limit: formatSI(MODEL_MAX_OUT, "А") };
  },
  thermal: { threshold: 1, rate: 0.6, cooling: 0.5 },
  voltage: () => 0,
  current: () => 0,
  power: () => 0,
  readout: (c, sim) => {
    const def = resolveChip(sim.scene, c.def);
    return `<div class="kv"><span>${def ? `${def.name}, ${packageName(def.package, def.pins)}` : "Нет описания микросхемы"}</span><span>${isMemory(def?.id) ? "по даташиту" : def ? countShort(countChip(def, sim.scene)) : ""}</span></div>`;
  },
  status: (c, sim) => (resolveChip(sim.scene, c.def) ? pill("ok", "РАБОТАЕТ") : pill("bad", "НЕТ ОПИСАНИЯ — ОТКРОЙТЕ ПРОЕКТ, ГДЕ ОНА ЕСТЬ")),

  // Содержимое ПЗУ и EEPROM: «rom:адрес» — слово (что не разобрать — не меняем), «rom:clear» —
  // всё чистое; «rompage» — какую страницу по 256 слов показать в панели
  edit(c, field, value) {
    if (field === "rompage") return void memPage.set(c.id, Math.max(0, Math.floor(Number(value) || 0)));
    if (field === "rom:clear") return void delete c.data;
    const info = memoryInfo(c.def) ?? memoryInfo("ref:prom288")!;
    const a = Number(field.match(/^rom:(\d+)$/)?.[1]);
    const w = parseWord(value);
    if (!Number.isInteger(a) || a < 0 || a >= info.words || w === undefined) return;
    const data = c.data ? [...c.data] : [];
    for (let i = data.length; i <= a; i++) data[i] = info.blank;
    data[a] = w & ((1 << info.width) - 1);
    // Хвост из чистых слов не храним — у 32K × 8 проект иначе распух бы
    while (data.length && (data[data.length - 1] ?? info.blank) === info.blank) data.pop();
    if (data.length) c.data = data;
    else delete c.data;
  },

  panel(c, sim) {
    const def = resolveChip(sim.scene, c.def);
    if (!def) return { title: "Микросхема", body: `<p class="sub">Описания этой микросхемы нет ни в библиотеке, ни в проекте.</p>` };
    const volts = (i: number) => sim.solution.voltage.get(pinNode(c, i));
    const rows = Array.from({ length: c.pins }, (_, i) => {
      const v = volts(i);
      return kv(`${i + 1} ${chipPinName(def, i)}`, v === undefined ? "не подключён" : formatSI(v, "В"));
    }).join("");
    const mem = memoryInfo(def.id);
    if (mem) return memoryPanel(c, sim, def, mem, rows, volts);
    const burned = def.parts.filter((p) => sim.state(`${c.id}/${p.id}`).burned).map((p) => p.id);
    const k = countChip(def, sim.scene);
    return {
      title: def.name,
      body: `${chipAbout(def.id) ? `<p>${chipAbout(def.id)}</p>` : ""}${kv("Внутри", countShort(k))}
        <p class="sub">${countDetails(k)}${k.chips.size ? `. Собрана из своих микросхем: ${countChips(k)}` : ""}.</p>
        ${burned.length ? kv("Сгорело внутри", burned.join(", ")) : ""}
        <div class="eyebrow">выводы (потенциал)</div>${rows}
        <p class="sub">${def.id.startsWith("ref:") ? "Заводская: внутри эталонная сборка из карьеры." : def.id.startsWith("career:") ? "Открыта в карьере: внутри ваша сборка." : "Собрана вами."} ${modelText(sim.modelOf(c.id), sim, c)}</p>`,
      editor: `<div class="row"><button class="btn inline" data-act="openChip" id="btn-open-chip">Открыть схему</button></div>`,
    };
  },
};

/** Питание модели по текущему решению (VCC − GND), В; undefined — решения ещё нет. */
function supply(c: Chip, model: ChipModel, sim: Simulation): number | undefined {
  const v = (p: number) => sim.solution.voltage.get(pinNode(c, p - 1));
  const a = v(model.vcc), b = v(model.gnd);
  return a === undefined || b === undefined ? undefined : a - b;
}

/** Питание раскрытой микросхемы — по выводам, назначенным питанием и общим. */
function defSupply(c: Chip, def: ChipDef, sim: Simulation): number | undefined {
  const vcc = def.pinRoles?.indexOf("vcc") ?? -1, gnd = def.pinRoles?.indexOf("gnd") ?? -1;
  if (vcc < 0 || gnd < 0) return undefined;
  const a = sim.solution.voltage.get(pinNode(c, vcc)), b = sim.solution.voltage.get(pinNode(c, gnd));
  return a === undefined || b === undefined ? undefined : a - b;
}

/**
 * Уровни входов модели. Обычный вход: выше полосы INPUT_BAND — единица, ниже — ноль, в ней — не
 * определён (так ведёт себя висящий). Триггер Шмитта (model.hyst): выше верхнего порога — единица,
 * ниже нижнего — ноль, между — как было на прошлом расчёте.
 */
/** Ниже такого питания, В, ОЗУ забывает всё (у настоящих TTL-ОЗУ — задолго до нуля). */
const RAM_KEEP = 2;

/** Какую страницу памяти (по 256 слов) показывает панель, по микросхемам. */
const memPage = new Map<string, number>();
const PAGE = 256;

/**
 * Панель памяти: что сейчас на выводах и содержимое страницами по 256 слов. ПЗУ и EEPROM — правятся
 * (прошивка сохраняется в проекте), ОЗУ — только посмотреть: оно в расчёте и без питания пропадает.
 */
function memoryPanel(c: Chip, sim: Simulation, def: ChipDef, mem: MemoryInfo, rows: string, volts: (i: number) => number | undefined) {
  const model = mem.model;
  const g = volts(model.gnd - 1);
  const high = (p: number) => {
    const v = volts(p - 1);
    return v !== undefined && g !== undefined && v - g > 1.4;
  };
  const addr = mem.addrPins.reduce((m, p, i) => m | (high(p) ? 1 << i : 0), 0);
  const selected = !high(mem.selectPin);
  const ram = mem.kind === "ram" ? (sim.memory.get(`${c.id}:ram`) as number[] | undefined) : undefined;
  const pages = Math.ceil(mem.words / PAGE);
  const page = Math.min(memPage.get(c.id) ?? (selected ? Math.floor(addr / PAGE) : 0), pages - 1);
  const from = page * PAGE, to = Math.min(mem.words, from + PAGE);
  const digits = mem.width > 4 ? 2 : 1;
  const aDigits = Math.max(2, (mem.words - 1).toString(16).length);
  const hex = (w: number) => w.toString(16).toUpperCase().padStart(digits, "0");
  const busy = sim.memory.get(`${c.id}:eeBusy`) as { until: number } | undefined;
  const cells = Array.from({ length: to - from }, (_, i) => {
    const a = from + i;
    const now = a === addr && selected ? " now" : "";
    const label = `<span>${a.toString(16).toUpperCase().padStart(aDigits, "0")}</span>`;
    if (mem.kind === "ram") {
      const w = ram?.[a];
      return `<label class="rom-cell${ram ? now : ""}" title="Адрес ${a}${w === undefined ? "" : `: ${w.toString(2).padStart(mem.width, "0")}`}">${label}<input class="btn" type="text" readonly value="${w === undefined ? "—" : hex(w)}" aria-label="Слово по адресу ${a}" /></label>`;
    }
    const w = memWord(mem, c.data, a);
    return `<label class="rom-cell${now}" title="Адрес ${a}: ${w.toString(2).padStart(mem.width, "0")} = ${w}">${label}<input class="btn" type="text" maxlength="10" data-field="rom:${a}" value="${digits === 2 ? hex2(w) : hex(w)}" aria-label="Слово по адресу ${a}" /></label>`;
  }).join("");
  const pager = pages > 1
    ? `<div class="field"><label for="f-rompage">Страница (адреса ${from.toString(16).toUpperCase().padStart(aDigits, "0")}…${(to - 1).toString(16).toUpperCase().padStart(aDigits, "0")})</label><input id="f-rompage" class="btn" type="number" min="0" max="${pages - 1}" data-field="rompage" value="${page}" /></div><p class="sub">Всего ${pages} страниц по ${PAGE} слов; номер страницы — старшие биты адреса.</p>`
    : "";
  const mode = mem.kind === "ram"
    ? !ram ? "нет питания" : !selected ? "не выбрана" : `адрес ${addr}`
    : busy && sim.time < busy.until ? `идёт запись (ещё ${Math.ceil((busy.until - sim.time) * 1000)} мс): чтение — опрос` : selected ? `адрес ${addr}` : "не выбрана";
  const note = mem.kind === "ram"
    ? "Содержимое меняют только сигналы на выводах. Без питания оно пропадает, после включения в ячейках что попало — как у настоящей."
    : mem.kind === "eeprom"
      ? "Впишите слово: шестнадцатеричное (3F), восемь двоичных цифр (00111111) или десятичное с d (d63) — как программатором. Схема тоже может писать: импульс W̅E̅ при C̅E̅ = 0 и O̅E̅ = 1, байт ложится за 10 мс; пока идёт запись, на I/O7 — обратный записанному бит. Содержимое сохраняется в проекте и без питания."
      : "Впишите слово: шестнадцатеричное (3F), восемь двоичных цифр (00111111) или десятичное с d (d63). Подсвечено слово, которое сейчас на выходах. Содержимое у каждой такой микросхемы своё и сохраняется в проекте.";
  return {
    title: def.name,
    body: `<p>${chipAbout(def.id) ?? ""}</p>
      ${kv("Сейчас", mode)}
      ${pager}
      <div class="eyebrow">содержимое (адрес → слово, шестнадцатеричное)</div>
      <div class="rom-grid">${cells}</div>
      <p class="sub">${note}</p>
      <div class="eyebrow">выводы (потенциал)</div>${rows}
      <p class="sub">Заводская, по даташиту ${mem.source}.</p>`,
    ...(mem.kind === "ram" ? {} : { editor: `<div class="row"><button class="btn inline" data-act="romClear">Стереть всё (${mem.blank ? "единицы" : "нули"})</button></div>` }),
  };
}

/**
 * EEPROM после установившегося расчёта: запись байта на фронте W̅E̅ (см. ChipModel.eeprom) — если
 * питание выше порога, прошло время после включения и прежний цикл закончился. Байт ложится в
 * прошивку (Chip.data), идёт цикл twc.
 */
function eepromCommit(c: Chip, model: ChipModel, sim: Simulation): void {
  const ee = model.eeprom!;
  const span = supply(c, model, sim) ?? 0;
  const onKey = `${c.id}:eeOn`;
  if (span < ee.vsense) {
    sim.memory.delete(onKey);
    return;
  }
  if (!sim.memory.has(onKey)) sim.memory.set(onKey, sim.time);
  const prev = sim.memory.get(`${c.id}:seq`) as ModelState | undefined;
  const now = inputLevels(c, model, sim, prev);
  if (!prev || now.some((l) => l === undefined)) return;
  const busy = sim.memory.get(`${c.id}:eeBusy`) as { until: number } | undefined;
  if (busy && sim.time < busy.until) return;
  if (sim.time - (sim.memory.get(onKey) as number) < ee.powerOn) return;
  const w = ee.write(prev.inputs, now as boolean[]);
  if (!w) return;
  const data = c.data ? [...c.data] : [];
  for (let i = data.length; i <= w[0]; i++) data[i] = ee.blank;
  data[w[0]] = w[1];
  c.data = data;
  sim.memory.set(`${c.id}:eeBusy`, { until: sim.time + ee.twc, last: w[1] });
}

/**
 * Содержимое памяти для модели: у ПЗУ — прошивка этой микросхемы (Chip.data), у ОЗУ — то, что
 * лежит в расчёте; нет (только что включили) — мусор, своё для каждого включения.
 */
function memData(c: Chip, model: ChipModel, sim: Simulation): number[] | undefined {
  if (model.eeprom) {
    // Идёт цикл записи: чтение — опрос. I/O7 — дополнение записанного, I/O6 — меняется
    const busy = sim.memory.get(`${c.id}:eeBusy`) as { until: number; last: number } | undefined;
    if (!busy || sim.time >= busy.until) return c.data;
    const poll = (busy.last & 0x3f) | (~busy.last & 0x80) | ((Math.floor(sim.time * 1000) & 1) << 6);
    return new Proxy([] as number[], { get: (t, k) => (typeof k === "string" && /^\d+$/.test(k) ? poll : Reflect.get(t, k)) });
  }
  if (!model.ram) return c.data;
  const key = `${c.id}:ram`;
  let d = sim.memory.get(key) as number[] | undefined;
  if (!d) {
    const n = ((sim.memory.get(`${c.id}:ramOn`) as number | undefined) ?? 0) + 1;
    sim.memory.set(`${c.id}:ramOn`, n);
    const seed = [...c.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) ^ (n * 7919);
    d = sim.ramZero ? Array(model.ram.words).fill(0) : ramGarbage(model.ram.words, model.outputs.length, seed);
    sim.memory.set(key, d);
  }
  return d;
}

/** Состояние схемы с памятью после последнего события этого шага (в sim.junction — откатывается вместе с шагом). */
function runState(c: Chip, model: ChipModel, sim: Simulation): ModelState | undefined {
  const base = sim.memory.get(`${c.id}:seq`) as ModelState | undefined;
  const rs = sim.junction.get(`${c.id}:rs`);
  const ri = sim.junction.get(`${c.id}:ri`);
  if (rs === undefined || ri === undefined) return base;
  const inputs = model.inputs.map((_, i) => !!(ri & (1 << i)));
  return { inputs, outputs: model.logic(inputs, base, memData(c, model, sim)), state: rs };
}

function inputLevels(c: Chip, model: ChipModel, sim: Simulation, prev?: ModelState): (boolean | undefined)[] {
  const v = (p: number) => sim.solution.voltage.get(pinNode(c, p - 1)) ?? 0;
  const gnd = v(model.gnd), span = v(model.vcc) - gnd;
  const [lo, hi] = model.hyst ?? INPUT_BAND;
  // Гистерезис помнит, где вход был только что — в этом же расчёте (иначе, переключившись, выход
  // чуть сдвигает вход назад, и тот снова читается по-старому — выход качается)
  const now = sim.junction.get(`${c.id}:hin`);
  const levels = model.inputs.map((p, i) => {
    const x = (v(p) - gnd) / (span || 1);
    const was = now !== undefined ? !!(now & (1 << i)) : (prev?.inputs[i] ?? false);
    return x >= hi ? true : x <= lo ? false : model.hyst ? was : undefined;
  });
  if (model.hyst) sim.junction.set(`${c.id}:hin`, levels.reduce((m: number, b, i) => m | (b ? 1 << i : 0), 0));
  return levels;
}

/** Как считается микросхема: моделью (и с какими параметрами) или целиком. */
function modelText(m: ChipModel | undefined, sim: Simulation, c: Chip): string {
  if (!m) return "Расчёт — полный, как если бы схема стояла на макетке: детали внутри греются и горят как обычно.";
  const pt = modelAt(m, supply(c, m, sim) ?? m.vmax);
  const r = (xs: number[]) => [...new Set(xs.map((x) => (x >= CMOS_INPUT ? "∞" : formatOhms(x))))].join(", ");
  return `Она уже прошла проверку, поэтому считается моделью, снятой с этой проверки при питании ${formatSI(m.vmin, "В")}–${formatSI(m.points.at(-1)!.volts, "В")}: сейчас выход — ключ к питанию через ${r(pt.rHigh)} или к общему через ${r(pt.rLow)}, вход — ${r(pt.rIn)}, ток покоя ${formatSI(pt.iq, "А")}. Вне этого диапазона она считается по транзисторам. Вход переключается около половины питания${m.hyst ? ` — с гистерезисом: вверх при ${Math.round(m.hyst[1] * 100)} %, вниз при ${Math.round(m.hyst[0] * 100)} % питания` : ""}; висящий вход КМОП не определён — выход тогда ни то ни сё. Петля из микросхем без RC-цепи генерирует быстрее, чем видно приборам (у настоящих — десятки мегагерц), — её выход тоже «не определён», посередине. Перегрузка выхода сверх ${formatSI(MODEL_MAX_OUT, "А")}${m.absMax ? ` или питание выше ${formatSI(m.absMax, "В")}` : ""} выводит её из строя.`;
}

// ─── 3D: корпус DIP ──────────────────────────────────────────────────────────

function nameTexture(text: string, pinsHalf: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64 * pinsHalf;
  canvas.height = 160;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1c1e21";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#c9ccd1";
  g.font = `600 ${Math.min(46, (canvas.width / Math.max(4, text.length)) * 1.5)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, canvas.width / 2, 84);
  // Ключ — точка у вывода 1 (левый нижний угол)
  g.beginPath();
  g.arc(26, 128, 11, 0, Math.PI * 2);
  g.fillStyle = "#34373b";
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * DIP: выводы 1…N/2 — вдоль одной стороны, N/2+1…N — обратно вдоль другой; между рядами 7,62 мм.
 * На плате — по отверстиям (в том порядке, как выводы); на столе — ножки вниз, провода к их концам.
 */
function chipView(c: Chip): ComponentView {
  const group = new THREE.Group();
  const k = c.pins / 2;
  let pins: THREE.Vector3[];
  let base: THREE.Vector3[];
  if (c.placement.mode === "board") {
    base = c.placement.holes.map((id) => {
      const h = HOLE_BY_ID.get(id)!;
      return new THREE.Vector3(h.x, h.y, h.z);
    });
    pins = base;
  } else {
    const offsets = pinOffsets(c.package, c.pins);
    const len = Math.max(...offsets.map(([a]) => a)) + 1;
    const half = c.package === "DIPW" ? 3 : 1.5;
    base = offsets.map(([along, across]) => new THREE.Vector3(along - (len - 1) / 2, mm(0.3), isModule(c.package) ? 0 : across === 0 ? half : -half));
    pins = base.map((p) => freeTransform(c, p));
    group.position.set(c.placement.x, 0, c.placement.z);
    group.rotation.y = c.placement.rot;
  }
  if (isSot(c.package)) return sotView(c, group, base, pins);
  if (isModule(c.package)) return moduleView(c, group, base, pins);
  const Hs = base[0].y; // поверхность платы (или стола)
  const center = base.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / base.length);
  const u = base[k - 1].clone().sub(base[0]).setY(0).normalize(); // вдоль ряда выводов 1…k
  const v = base[0].clone().sub(base[c.pins - 1]).setY(0).normalize(); // поперёк: от второго ряда к первому
  const body = new THREE.Group();
  // Корпус: 6,35 мм у DIP на 300 мил, 14 мм у DIP на 600 мил (AT28C256: 13,5…14,4)
  const half = c.package === "DIPW" ? 3 : 1.5;
  const L = k - 0.25, W = mm(c.package === "DIPW" ? 14 : 6.35), T = mm(3.3);
  const top = new THREE.MeshStandardMaterial({ map: nameTexture(c.name, k), roughness: 0.55 });
  const side = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.55 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(L, T, W), [side, side, top, side, side, side]);
  body.add(box);
  const y = Hs + mm(1) + T / 2;
  body.position.set(center.x, y, center.z);
  // Локальная +X — вдоль u, локальная +Z — вдоль v
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), v));
  group.add(body);
  // Ножки: от боковой грани корпуса наружу и вниз в отверстие
  for (const p of base) {
    const toward = p.clone().sub(center).setY(0);
    const across = v.clone().multiplyScalar(Math.sign(toward.dot(v)) || 1);
    const edge = p.clone().addScaledVector(across, -(half - W / 2 - mm(0.2))).setY(y - T / 4);
    group.add(lead([edge, p.clone().setY(y - T / 4), p.clone().setY(Hs + mm(1)), p.clone().setY(Hs - 0.2)], mm(0.25)));
  }
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot: c.placement.mode === "board" ? center.clone().setY(y + T) : freeTransform(c, new THREE.Vector3(0, y + T, 0)),
    update() {},
    dispose: () => disposeGroup(group),
  };
}

// ─── 3D: модуль на штыревом разъёме ─────────────────────────────────────────────

/** Плата модуля: зелёная, название, «SIP-n», номера выводов у разъёма. */
function moduleTexture(name: string, n: number, w: number, h: number): THREE.CanvasTexture {
  const P = 48;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * P);
  canvas.height = Math.round(h * P);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#2a8a4c";
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Дорожки от выводов разъёма вверх
  g.strokeStyle = "#3fa865";
  g.lineWidth = P * 0.18;
  for (let i = 0; i < n; i++) {
    const x = (i + (w - n) / 2 + 0.5) * P;
    g.beginPath();
    g.moveTo(x, canvas.height);
    g.lineTo(x, canvas.height - P * (1.6 + (i % 3) * 0.7));
    g.stroke();
  }
  g.fillStyle = "#f2f4f0";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 ${P * 0.55}px "IBM Plex Mono", ui-monospace, monospace`;
  for (let i = 0; i < n; i++) if (i === 0 || i === n - 1 || (i + 1) % 5 === 0) g.fillText(String(i + 1), (i + (w - n) / 2 + 0.5) * P, canvas.height - P * 0.55);
  g.font = `700 ${Math.min(P * 1.4, (canvas.width / Math.max(6, name.length)) * 1.4)}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(name, canvas.width / 2, canvas.height * 0.42);
  g.font = `600 ${P * 0.7}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(`модуль SIP-${n}`, canvas.width / 2, canvas.height * 0.42 + P * 1.3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Модуль: штыревой разъём (чёрная планка, штыри в отверстиях) и над ним — плата модуля стоймя,
 * в плоскости ряда выводов. Высота платы — как у её поля под детали.
 */
function moduleView(c: Chip, group: THREE.Group, base: THREE.Vector3[], pins: THREE.Vector3[]): ComponentView {
  const n = base.length;
  const Hs = base[0].y;
  const center = base.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / n);
  const u = n > 1 ? base[n - 1].clone().sub(base[0]).setY(0).normalize() : new THREE.Vector3(1, 0, 0);
  const v = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0));
  const basis = new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), v);
  const strip = mm(2.5);
  const header = new THREE.Mesh(new THREE.BoxGeometry(n, strip, strip), blackPlastic);
  header.position.copy(center).setY(Hs + mm(1) + strip / 2);
  header.quaternion.setFromRotationMatrix(basis);
  group.add(header);
  for (const p of base) group.add(lead([p.clone().setY(Hs - 0.2), p.clone().setY(Hs + mm(1) + strip + mm(1.5))], mm(0.32)));
  const w = n + 2, h = MODULE_ROWS + 3, t = mm(1.6);
  const face = new THREE.MeshStandardMaterial({ map: moduleTexture(c.name, n, w, h), roughness: 0.6, emissive: 0x0b2414 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x1a4d2c, roughness: 0.7 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), [edge, edge, edge, edge, face, face]);
  const y = Hs + mm(1) + strip + h / 2;
  board.position.copy(center).setY(y);
  board.quaternion.setFromRotationMatrix(basis);
  group.add(board);
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot: c.placement.mode === "board" ? center.clone().setY(y + h / 2) : freeTransform(c, new THREE.Vector3(0, y + h / 2, 0)),
    update() {},
    dispose: () => disposeGroup(group),
  };
}

// ─── 3D: SOT-23-5/6 на переходнике ─────────────────────────────────────────────

/** Шелкография и медь переходника: дорожки от площадок SOT-23 к штырькам (5 или 6), номера, название. */
function adapterTexture(name: string, n: number): THREE.CanvasTexture {
  const P = 96;
  const canvas = document.createElement("canvas");
  canvas.width = 3.3 * P;
  canvas.height = 4.3 * P;
  const g = canvas.getContext("2d")!;
  const X = (x: number) => (x + 1.65) * P;
  const Z = (z: number) => (z + 2.15) * P;
  g.fillStyle = "#1d4f9c";
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Площадки SOT-23: 1–3 — к ближнему ряду, дальше по кругу по дальнему (у SOT-23-5 посередине пусто)
  const sot = sotPads(n).map(([x, z]): [number, number] => [x * mm(0.95), z * mm(1.2)]);
  const header = sotPads(n).map(([x, z]): [number, number] => [x, z * 1.5]);
  g.strokeStyle = "#d9a441";
  g.lineWidth = P * 0.12;
  g.lineCap = "round";
  sot.forEach(([sx, sz], i) => {
    const [hx, hz] = header[i];
    g.beginPath();
    g.moveTo(X(sx), Z(sz));
    g.lineTo(X(sx), Z((sz + hz) / 2));
    g.lineTo(X(hx), Z((sz + hz) / 2));
    g.lineTo(X(hx), Z(hz));
    g.stroke();
  });
  // Штырьки: лужёные кольца (средние без ножки корпуса — не подключены)
  const idle: [number, number][] = n === 5 ? [[0, -1.5]] : n === 4 ? [[0, 1.5], [0, -1.5]] : [];
  for (const [hx, hz] of [...header, ...idle]) {
    g.fillStyle = "#d4d6d8";
    g.beginPath();
    g.arc(X(hx), Z(hz), P * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#f2f4f0";
  g.font = `700 ${P * 0.28}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  header.forEach(([hx, hz], i) => g.fillText(String(i + 1), X(hx) + P * 0.42, Z(hz) + (hz > 0 ? -P * 0.42 : P * 0.42)));
  g.font = `600 ${P * 0.24}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(name.slice(0, 14), canvas.width / 2, P * 0.95);
  g.fillText(n === 4 ? "SOT-143" : `SOT-23-${n}`, canvas.width / 2, canvas.height - P * 0.95);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Выводы SOT-23 по порядку: [вдоль, поперёк] в долях — 1…3 снизу слева направо, дальше обратно сверху. */
function sotPads(n: number): [number, number][] {
  if (n === 4) return [[-1, 1], [1, 1], [1, -1], [-1, -1]];
  return n === 5
    ? [[-1, 1], [0, 1], [1, 1], [1, -1], [-1, -1]]
    : [[-1, 1], [0, 1], [1, 1], [1, -1], [0, -1], [-1, -1]];
}

/**
 * Переходник SOT-23-5/6 → 2,54 мм: синяя плата на двух рядах штырьков (через 7,62 мм, как DIP-6),
 * сверху — сама микросхема 2,9 × 1,6 мм. base — отверстия выводов (или точки на столе).
 */
function sotView(c: Chip, group: THREE.Group, base: THREE.Vector3[], pins: THREE.Vector3[]): ComponentView {
  const Hs = base[0].y;
  // Вдоль ближнего ряда: 1 → 3 (у SOT-143 в ближнем ряду только 1 и 2)
  const u = base[base.length === 4 ? 1 : 2].clone().sub(base[0]).setY(0).normalize();
  const v = base[0].clone().sub(base[base.length - 1]).setY(0).normalize(); // от дальнего ряда к ближнему
  const center = base[0].clone().addScaledVector(u, 1).addScaledVector(v, -1.5).setY(Hs);
  const spacer = mm(2.5), T = mm(1.6);
  const body = new THREE.Group();
  body.position.copy(center);
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), v));
  // Колодки штырьков — чёрные планки по рядам
  for (const z of [1.5, -1.5]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3, spacer, 0.9), blackPlastic);
    bar.position.set(0, spacer / 2, z);
    body.add(bar);
  }
  // Плата переходника
  const top = new THREE.MeshStandardMaterial({ map: adapterTexture(c.name, base.length), roughness: 0.5 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x1d4f9c, roughness: 0.5 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.3, T, 4.3), [edge, edge, top, edge, edge, edge]);
  board.position.y = spacer + T / 2;
  body.add(board);
  // Штырьки: от отверстия до верха платы (средний дальний — для вида, ни к чему не подключён)
  const metal = new THREE.MeshStandardMaterial({ color: 0xd4d6d8, metalness: 0.85, roughness: 0.3 });
  for (const [x, z] of [[-1, 1.5], [0, 1.5], [1, 1.5], [1, -1.5], [0, -1.5], [-1, -1.5]]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(mm(0.64), spacer + T + mm(1.2), mm(0.64)), metal);
    pin.position.set(x, (spacer + T + mm(1.2)) / 2 - 0.2, z);
    body.add(pin);
  }
  // SOT-23: корпус 2,9 × 1,6 × 1,1 мм и пять или шесть ножек «крылом чайки»
  const chipTop = spacer + T;
  const sot = new THREE.Mesh(new THREE.BoxGeometry(mm(2.9), mm(1.1), mm(1.6)), blackPlastic);
  sot.position.y = chipTop + mm(0.15) + mm(0.55);
  body.add(sot);
  for (const [x, side] of sotPads(base.length).map(([a, b]) => [a * mm(0.95), b])) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(mm(0.4), mm(0.15), mm(0.6)), metal);
    leg.position.set(x, chipTop + mm(0.1), side * mm(1.1));
    body.add(leg);
  }
  // Ключ — точка у вывода 1 на корпусе
  const dot = new THREE.Mesh(new THREE.CircleGeometry(mm(0.2), 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a8f96 }));
  dot.position.set(-mm(0.95), sot.position.y + mm(0.56), mm(0.4));
  body.add(dot);
  group.add(body);
  tagPickable(group, c.id);
  return {
    group,
    pins,
    hotspot: c.placement.mode === "board" ? center.clone().setY(Hs + chipTop + 1) : freeTransform(c, new THREE.Vector3(0, Hs + chipTop + 1, 0)),
    update() {},
    dispose: () => disposeGroup(group),
  };
}
