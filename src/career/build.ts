/**
 * Карьера без интерфейса: стол уровня, эталонные компоненты, набор деталей и проверка по таблице
 * истинности. Без DOM — годится и для приложения, и для тестов.
 */

import { BOARDS, applyBoards, newChipBoard, type BoardSpec } from "../model/breadboard";
import { TRANSISTORS, mosfetPin, type Chip, type ChipDef, type Component, type Endpoint, type MosfetRole, type Scene, type TransistorKind } from "../model/types";
import { packageChip, packageProblems, chipInner } from "../chips/package";
import { chipsUsed } from "../chips/registry";
import { countChip, plural } from "../chips/count";
import { Simulation, heatThreshold, pinNode } from "../sim/simulation";
import { formatSI } from "../sim/resistorCodes";
import { FUNC_NAMES, LEVELS, SEQUENTIAL, SMD_TWIN, gateIo, kitLabel, seqNext, seqOuts, seqState, sequenceExpected, truth, zOutputs, type KitItem, type Level, type LogicFunc } from "./levels";
import { PIN_ROLES } from "../chips/roles";
import { MODEL_OFF, REF_ABS_MAX, chipModel, setModelSource, type ChipModel, type ModelPoint, type ModelState } from "../chips/model";
import { memoryModel } from "../chips/memory";

/** Напряжение питания при проверке, В. */
export const CHECK_VOLTS = 5;

/** Корпус уровня (SOT-23-5 или DIP) с заданными выводами; менять их нельзя. */
export function levelCase(level: Level): BoardSpec {
  const pkg = level.package ?? "SOT-23-5";
  const b = newChipBoard(level.roles.length, 0, 0, "K1", pkg);
  return { ...b, roles: [...level.roles], names: [...level.names], label: level.part, fixed: true, ...(level.room ? { room: level.room } : {}) };
}

/**
 * Стол уровня: только корпус. Поле корпуса по умолчанию — под SMD (детали набора — в SMD-корпусах);
 * сетку 2,54 мм под выводные детали можно выбрать в панели корпуса.
 */
export function levelScene(level: Level, smd = true): Scene {
  const box = levelCase(level);
  return { components: [], wires: [], boards: [smd ? { ...box, smd: true, seats: [] } : box], career: { level: level.id } };
}

/** Сделать что-то при наборе плат boards и вернуть прежние (отверстия общие на всё приложение). */
export function withBoards<T>(boards: BoardSpec[], fn: () => T): T {
  const saved = BOARDS.map((b) => ({ ...b }));
  applyBoards(boards);
  try {
    return fn();
  } finally {
    applyBoards(saved);
  }
}

/**
 * Эталонная сборка уровня на его корпусе: детали в отверстиях, цепи — перемычками.
 * chipFor — какую микросхему ставить на место детали-микросхемы нужной функции.
 */
export function recipeScene(level: Level, chipFor: (func: LogicFunc) => ChipDef): Scene {
  // Эталонная сборка стоит на сетке площадок (выводные детали)
  const scene = levelScene(level, false);
  const chips: Record<string, ChipDef> = {};
  for (const p of level.recipe.parts) {
    const placement = { mode: "board" as const, holes: p.holes };
    let c: Component;
    if (p.func) {
      const def = chipFor(p.func);
      chips[def.id] = def;
      Object.assign(chips, def.scene.chips ?? {});
      c = { id: p.id, type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement };
    } else if (p.ohms) c = { id: p.id, type: "resistor", variant: "tht", ohms: p.ohms, smdSize: "0805", placement };
    else if (p.uF) c = { id: p.id, type: "capacitor", variant: "ceramic", uF: p.uF, volts: 50, placement };
    else if (p.diode) c = { id: p.id, type: "diode", kind: p.diode, placement };
    else if (p.kind && p.kind in TRANSISTORS) c = { id: p.id, type: "transistor", kind: p.kind as TransistorKind, placement };
    else c = { id: p.id, type: "mosfet", kind: p.kind as "2N7000", placement };
    scene.components.push(c);
  }
  const hole = (end: string): string => {
    if (/^P\d+$/.test(end)) return `k:${end.slice(1)}`;
    const [id, pin] = end.split(".");
    const c = scene.components.find((x) => x.id === id)!;
    const holes = (c.placement as { holes: string[] }).holes;
    if (c.type === "mosfet") return holes[mosfetPin(c.kind, pin as MosfetRole)];
    if (c.type === "transistor") return holes["CBE".indexOf(pin)];
    return holes[Number(pin) - 1];
  };
  let n = 0;
  for (const net of level.recipe.nets) {
    for (let i = 1; i < net.length; i++) {
      scene.wires.push({ id: `W${++n}`, a: { hole: hole(net[0]) } as Endpoint, b: { hole: hole(net[i]) } as Endpoint, color: "#2f9e5a" });
    }
  }
  if (Object.keys(chips).length) scene.chips = chips;
  return scene;
}

/** Упаковать эталонную сборку уровня в микросхему с данным обозначением. */
export function packageRecipe(level: Level, id: string, chipFor: (func: LogicFunc) => ChipDef): ChipDef {
  const scene = recipeScene(level, chipFor);
  return withBoards(scene.boards!, () => {
    const def = packageChip(scene, level.part, id, 0);
    def.scene.chips = { ...chipsUsed(scene), ...(scene.chips ?? {}) };
    return def;
  });
}

/**
 * Эталонные («заводские») компоненты всех уровней — для песочницы. Составные собираются из
 * эталонных КМОП-вентилей.
 */
export function referenceChips(): ChipDef[] {
  const out = new Map<string, ChipDef>();
  const chipFor = (func: LogicFunc) => out.get(`ref:${func}-cmos`) ?? out.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
  for (const level of LEVELS) out.set(`ref:${level.id}`, { ...packageRecipe(level, `ref:${level.id}`, chipFor), absMax: level.absMax ?? REF_ABS_MAX });
  return [...out.values()];
}

// ─── Набор деталей ──────────────────────────────────────────────────────────

/** Функция микросхемы по обозначению описания: «career:nand-rtl», «ref:nand-cmos» → nand. */
export function chipFunc(defId: string): LogicFunc | undefined {
  const m = defId.match(/^(?:career|ref):(.+)$/);
  return m ? LEVELS.find((l) => l.id === m[1])?.func : undefined;
}

/** К какой строке набора относится деталь (-1 — ни к какой). */
export function kitIndex(kit: KitItem[], c: Component): number {
  if (c.stock) return -1;
  return kit.findIndex((k) => {
    // SMD-пара (2N7002 вместо 2N7000…) — та же строка набора: на корпусе под SMD выдаётся она
    if (k.part === "mosfet") return c.type === "mosfet" && (c.kind === k.kind || c.kind === SMD_TWIN[k.kind]);
    if (k.part === "bjt") return c.type === "transistor" && (c.kind === k.kind || c.kind === SMD_TWIN[k.kind]);
    if (k.part === "resistor") return c.type === "resistor" && c.ohms === k.ohms;
    if (k.part === "other") return c.type === k.type && Object.entries(k.match ?? k.preset).every(([key, v]) => (c as unknown as Record<string, unknown>)[key] === v || (key === "size" && v === "5mm" && !(c as { size?: string }).size));
    return c.type === "chip" && chipFunc(c.def) === k.func;
  });
}

/** Сколько деталей каждой строки набора уже стоит в схеме. */
export function kitUsed(kit: KitItem[], scene: Scene): number[] {
  const used = kit.map(() => 0);
  for (const c of scene.components) {
    const i = kitIndex(kit, c);
    if (i >= 0) used[i]++;
  }
  return used;
}

/** Что в начинке не из набора или сверх него. */
export function kitProblems(level: Level, scene: Scene): string[] {
  const out: string[] = [];
  const counts = level.kit.map(() => 0);
  for (const c of chipInner(scene)) {
    const i = kitIndex(level.kit, c);
    if (i < 0) out.push(`${c.id} — не из набора.`);
    else counts[i]++;
  }
  level.kit.forEach((k, i) => {
    if (counts[i] > k.count) out.push(`${kitLabel(k)}: в наборе ${k.count}, а стоит ${counts[i]}.`);
  });
  return out;
}

// ─── Проверка ───────────────────────────────────────────────────────────────

export interface CheckRow {
  /** Номер шага последовательности (у схем с памятью), с 1. */
  step?: number;
  inputs: boolean[];
  /** По выходам (в порядке номеров выводов): что нужно и что есть, В. */
  expected: boolean[];
  volts: number[];
  /** Каждый выход отдельно: верен ли. */
  each: boolean[];
  /** Выход должен быть отключён (третье состояние): идти за нагрузкой в обе стороны. */
  z?: boolean[];
  /** Ток от питания в этом состоянии, А. */
  amps: number;
  /** Ток в каждый вход (от источника сигнала), А. */
  inAmps: number[];
  /** Что сгорело или перегружено сверх номинала при этой строке (обозначения внутри микросхемы). */
  burned: string[];
  /** Выход «висит»: идёт за нагрузкой (к общему — ноль, к питанию — единица). */
  floating: boolean[];
  ok: boolean;
}

/**
 * Цифры сборки: что зависит от решения игрока. Число транзисторов при фиксированном наборе почти
 * не меняется — оно для сравнения вариантов (КМОП против РТЛ), как и ток покоя.
 */
export interface Metrics {
  /** Охватывающий прямоугольник занятых площадок поля корпуса, площадок. */
  width: number;
  height: number;
  /** Проводов и дорожек внутри корпуса. */
  links: number;
  /** Наибольший ток от питания по строкам таблицы, А. */
  idle: number;
  /** Транзисторов внутри, с раскрытием вложенных микросхем. */
  transistors: number;
  /** Наименьшее питание из SUPPLY_STEPS, при котором сборка ещё работает, В. */
  vmin?: number;
  /**
   * Выходное сопротивление, Ом: худшее из «к питанию» и «к общему» по всем выходам при 5 В. Чем
   * меньше, тем больше входов выдержит выход и тем твёрже держит уровень.
   */
  rOut?: number;
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
  rows: CheckRow[];
  def?: ChipDef;
  metrics?: Metrics;
  /** Шаги урока введения: что сделано, что нет. */
  steps?: { text: string; ok: boolean }[];
  /** Что проверить, если не прошло: симптомы, без решения. */
  diagnosis?: string[];
  /** Какие цифры стали лучше прежних (заполняет приложение, сохраняя результат). */
  better?: (keyof Metrics)[];
}

/** Площадка поля корпуса «k:B7» → [столбец, ряд]; выводы корпуса («k:3») и чужие платы — нет. */
function fieldCell(hole: string): [number, number] | undefined {
  const m = hole.match(/^k:([A-Z])(\d+)$/);
  return m ? [Number(m[2]), m[1].charCodeAt(0) - 65] : undefined;
}

/** Цифры сборки на корпусе (после успешной проверки). */
export function measure(scene: Scene, rows: CheckRow[], def: ChipDef, chips: Record<string, ChipDef>): Metrics {
  const cells: [number, number][] = [];
  for (const c of chipInner(scene)) if (c.placement.mode === "board") cells.push(...c.placement.holes.map(fieldCell).filter((x): x is [number, number] => !!x));
  const onCase = (h: string) => /^k:/.test(h);
  const wires = scene.wires.filter((w) => "hole" in w.a && "hole" in w.b && onCase(w.a.hole) && onCase(w.b.hole));
  const traces = (scene.traces ?? []).filter((t) => onCase(t.a) && onCase(t.b));
  for (const w of wires) for (const e of [w.a, w.b]) if ("hole" in e) cells.push(...[fieldCell(e.hole)].filter((x): x is [number, number] => !!x));
  for (const t of traces) cells.push(...[fieldCell(t.a), fieldCell(t.b)].filter((x): x is [number, number] => !!x));
  const span = (i: 0 | 1) => (cells.length ? Math.max(...cells.map((c) => c[i])) - Math.min(...cells.map((c) => c[i])) + 1 : 0);
  return {
    width: span(0),
    height: span(1),
    links: wires.length + traces.length,
    idle: Math.max(0, ...rows.map((r) => r.amps)),
    transistors: countChip(def, { components: [], wires: [], chips }).transistors,
  };
}

/**
 * Нагрузка выхода на стенде, Ом. Обычно 100 кОм — лёгкая, как вход КМОП с утечками. У уровня с
 * требованием к току (level.drive, при 5 В) — такая, что выход, удержавший 70 % питания (или 30 %),
 * отдаёт (или принимает) не меньше этого тока: так проверяют, скольких входов хватит выходу.
 */
export const loadOhms = (level: Level) => (level.drive ? (0.7 * CHECK_VOLTS) / level.drive : 100_000);

/**
 * Двунаправленный вывод (он и во входах, и в выходах уровня), когда по таблице работает входом,
 * проверка подаёт на него уровень через такой резистор, Ом: если микросхема сама тянет его в
 * другую сторону, уровень на выводе испортится — это провал, как у настоящей шины.
 */
export const BUS_DRIVE = 100;

/** Подтяжка выходов с открытым коллектором на проверке, Ом. */
export const PULL_UP = 10_000;

/** Уровни логики при питании vcc: единица — не ниже 70 %, ноль — не выше 30 %. */
const isHigh = (v: number, vcc: number) => v >= 0.7 * vcc;
const isLow = (v: number, vcc: number) => v <= 0.3 * vcc;

/** Больше стольких входов таблицу не перебирают целиком, а проверяют набором векторов. */
const FULL_TABLE_INPUTS = 6;

/**
 * Входные наборы для проверки. До FULL_TABLE_INPUTS входов — вся таблица. Больше — как проверяют
 * настоящие микросхемы: все нули, все единицы, «бегущая» единица и «бегущий» ноль (каждый вход
 * отдельно) и ещё случайные, но всегда одни и те же наборы — всего 40.
 */
export function inputVectors(n: number): boolean[][] {
  const bits = (m: number) => Array.from({ length: n }, (_, i) => !!(m & (1 << (n - 1 - i))));
  if (n <= FULL_TABLE_INPUTS) return Array.from({ length: 1 << n }, (_, m) => bits(m));
  const all = (1 << n) - 1;
  const seen = new Set<number>();
  const out: number[] = [];
  const add = (m: number) => {
    if (!seen.has(m)) seen.add(m), out.push(m);
  };
  add(0);
  add(all);
  for (let i = 0; i < n; i++) add(1 << i);
  for (let i = 0; i < n; i++) add(all ^ (1 << i));
  // Линейный конгруэнтный генератор с постоянным зерном: наборы одни и те же при каждой проверке
  let x = 12345;
  while (out.length < 40) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    add((x >> 8) & all);
  }
  return out.map(bits);
}

/**
 * Прогнать микросхему def по таблице истинности функции уровня: питание 5 В, входы — на питание
 * или на общий, каждый выход нагружен 100 кОм. Нагрузка тянет против нужного уровня (к питанию,
 * если нужен ноль, и наоборот): выход должен сам удержать чёткий ноль или единицу, и ничего
 * внутри не должно сгореть.
 */
export function truthTable(def: ChipDef, level: Level, chips: Record<string, ChipDef>, volts = CHECK_VOLTS, load = loadOhms(level)): CheckRow[] {
  const io = gateIo(level);
  const rows: CheckRow[] = [];
  const n = io.inputs.length;
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: { mode: "free", x: 0, z: 0, rot: 0 } };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const loads = io.outputs.map((_, k) => `RL${k + 1}`);
  // Открытый коллектор: единицу даёт резистор 10 кОм к питанию, как на плате
  const pulls = (level.openDrain ?? []).map((p, k) => ({ p, id: `RP${k + 1}` }));
  // Двунаправленные выводы: номер того же вывода среди входов (−1 — обычный выход) и резистор, через который его подают
  const both = io.outputs.map((p) => io.inputs.indexOf(p));
  const drive = (k: number) => `RD${k + 1}`;
  /**
   * Провода стенда: входы inputs; нагрузка выхода k — к питанию, если up[k], иначе к общему.
   * asInput[k] — двунаправленный вывод k сейчас вход: подан через BUS_DRIVE, без нагрузки. Провод
   * каждого входа — на своём месте (по нему считается ток входа), у двунаправленного — к резистору.
   */
  const wiring = (inputs: boolean[], up: boolean[], asInput: boolean[] = io.outputs.map(() => false)) =>
    (
      [
        [plus, pin(io.vcc)],
        [minus, pin(io.gnd)],
        ...pulls.flatMap(({ p, id }): [Endpoint, Endpoint][] => [[pin(p), { comp: id, pin: 0 }], [{ comp: id, pin: 1 }, plus]]),
        ...io.inputs.map((p, i): [Endpoint, Endpoint] => {
          const k = io.outputs.indexOf(p);
          return [pin(p), k >= 0 ? { comp: drive(k), pin: 0 } : inputs[i] ? plus : minus];
        }),
        ...io.outputs.flatMap((p, k): [Endpoint, Endpoint][] =>
          asInput[k]
            ? []
            : [
                [pin(p), { comp: loads[k], pin: 0 }],
                [{ comp: loads[k], pin: 1 }, up[k] ? plus : minus],
              ],
        ),
        ...io.outputs.flatMap((_, k): [Endpoint, Endpoint][] => (asInput[k] ? [[{ comp: drive(k), pin: 1 }, inputs[both[k]] ? plus : minus]] : [])),
      ] as [Endpoint, Endpoint][]
    ).map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" }));
  const scene: Scene = {
    components: [
      { id: "G1", type: "psu", volts, amps: 1, on: true, placement: { mode: "free", x: 0, z: 0, rot: 0 } },
      u,
      ...loads.map((id): Component => ({ id, type: "resistor", variant: "tht", ohms: load, smdSize: "0805", placement: { mode: "free", x: 0, z: 0, rot: 0 } })),
      ...pulls.map(({ id }): Component => ({ id, type: "resistor", variant: "tht", ohms: PULL_UP, smdSize: "0805", placement: { mode: "free", x: 0, z: 0, rot: 0 } })),
      ...both.flatMap((i, k): Component[] => (i >= 0 ? [{ id: drive(k), type: "resistor", variant: "tht", ohms: BUS_DRIVE, smdSize: "0805", placement: { mode: "free", x: 0, z: 0, rot: 0 } }] : [])),
    ],
    wires: wiring(Array(n).fill(false), io.outputs.map(() => false)),
    boards: [],
    chips: { ...chips, [def.id]: def },
  };
  // Один стенд на всю таблицу, как на столе: входы и нагрузки переключаются, а расчёт продолжается
  // с прошлого состояния — так он сходится в разы быстрее, чем каждый раз с нуля
  // Проверяемая микросхема — до транзисторов; микросхемы внутри неё, уже проверенные, — моделью
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  /** Один прогон: переключить стенд и дать схеме установиться. */
  const run = (inputs: boolean[], up: boolean[], asInput?: boolean[]) => {
    scene.wires = wiring(inputs, up, asInput);
    sim.solve();
    const burnt = new Set<string>();
    for (const c of sim.step(0.01)) if (c.id.startsWith("U1/")) burnt.add(c.id.slice(3));
    // Сгорание в расчёте копится нагревом за секунды, проверка короче — поэтому перегрузка сверх
    // номинала тоже провал: в жизни такая деталь сгорела бы чуть позже
    for (const c of sim.parts) {
      if (!c.id.startsWith("U1/")) continue;
      const limit = heatThreshold(c);
      if (limit && sim.overload(c) > limit) burnt.add(c.id.slice(3));
    }
    const gnd = sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0;
    const outV = io.outputs.map((p) => (sim.solution.voltage.get(pinNode(u, p - 1)) ?? 0) - gnd);
    // Ток от питания без токов нагрузок: то, что потребляет сама микросхема
    const loadAmps = loads.reduce((sum, _, k) => sum + Math.abs(sim.current(scene.components[2 + k])), 0);
    const amps = Math.max(0, Math.abs(sim.current(scene.components[0])) - loadAmps);
    // Провода входов идут от вывода к источнику: ток в вывод — с обратным знаком
    const inAmps = io.inputs.map((_, i) => -(sim.solution.branches.get(`W${2 + 2 * pulls.length + i}`)?.current ?? 0));
    return { volts: outV, amps, burnt, inAmps };
  };
  // Схема с памятью — шаги по порядку (подготовительные не проверяются); остальные — таблица
  const expectedSeq = sequenceExpected(level);
  const steps = level.sequence
    ? level.sequence.map((s, i) => ({ inputs: s.in, expected: expectedSeq[i], prep: !!s.prep }))
    : inputVectors(n).map((inputs) => ({ inputs, expected: truth(level.func, inputs), prep: false }));
  let stepNo = 0;
  let lastPrep: number[] | undefined;
  for (const [i, step] of steps.entries()) {
    // Первый проверяемый шаг после подготовительных: что хранит схема — замеряем, дальше считаем от этого
    if (level.sequence && !step.prep && lastPrep && i > 0 && steps[i - 1].prep) {
      const q0 = seqState(level.func, lastPrep.map((v) => v > volts / 2));
      sequenceExpected(level, q0, i).forEach((e, j) => (steps[i + j].expected = e));
    }
    const { inputs, prep } = step;
    // Отключённый выход: в первом прогоне нагрузка к питанию — он должен быть единицей, во втором к общему — нулём.
    // Отключённый двунаправленный — это вход: на нём должен остаться поданный уровень
    const zAll = zOutputs(level.func, inputs);
    const asInput = io.outputs.map((_, k) => both[k] >= 0 && !!zAll?.[k]);
    const z = zAll?.map((zk, k) => zk && both[k] < 0);
    const expected = step.expected.map((e, k) => (asInput[k] ? inputs[both[k]] : z?.[k] ? false : e));
    const good = (k: number, v: number) => (expected[k] || z?.[k] ? isHigh(v, volts) : isLow(v, volts));
    const first = run(inputs, expected.map((e) => !e), asInput);
    if (prep) {
      lastPrep = first.volts;
      continue;
    }
    const each = expected.map((_, k) => good(k, first.volts[k]));
    const burnt = new Set(first.burnt);
    let floating = expected.map(() => false);
    if (z?.some(Boolean)) {
      const second = run(inputs, expected, asInput);
      second.burnt.forEach((c) => burnt.add(c));
      z.forEach((zk, k) => zk && (each[k] = each[k] && isLow(second.volts[k], volts)));
    }
    // Неверный выход: он неправ сам или просто идёт за нагрузкой? Нагрузка в другую сторону покажет
    if (!each.every(Boolean)) {
      const second = run(inputs, expected, asInput);
      second.burnt.forEach((c) => burnt.add(c));
      floating = expected.map((_, k) => !each[k] && good(k, second.volts[k]));
    }
    rows.push({
      ...(level.sequence ? { step: ++stepNo } : {}),
      inputs,
      expected,
      volts: first.volts,
      amps: first.amps,
      inAmps: first.inAmps,
      burned: [...burnt],
      floating,
      each,
      // Для модели: где выход не вёл сам (отключён или работал входом) — не мерка его сопротивления
      ...(zAll ? { z: zAll } : {}),
      ok: !burnt.size && each.every(Boolean),
    });
  }
  return rows;
}

/** Стенд для одной микросхемы: питание volts, вход (если есть) — от второго блока питания, выход — на нагрузку 100 кОм к общему. */
function bench(def: ChipDef, level: Level, chips: Record<string, ChipDef>, volts = CHECK_VOLTS, button = false) {
  const io = gateIo(level);
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const links: [Endpoint, Endpoint][] = [
    [plus, pin(io.vcc)],
    [minus, pin(io.gnd)],
    [pin(io.outputs[0]), { comp: "RL", pin: 0 }],
    [{ comp: "RL", pin: 1 }, minus],
  ];
  const components: Component[] = [
    { id: "G1", type: "psu", volts, amps: 1, on: true, placement: free },
    u,
    { id: "RL", type: "resistor", variant: "tht", ohms: 100_000, smdSize: "0805", placement: free },
  ];
  if (button) {
    // Кнопка между входом и общим: отпущена — вход подтягивает сама микросхема
    components.push({ id: "SB1", type: "switch", closed: false, placement: free });
    links.push([{ comp: "SB1", pin: 0 }, pin(io.inputs[0])], [{ comp: "SB1", pin: 1 }, minus]);
  } else if (io.inputs.length) {
    components.push({ id: "G2", type: "psu", volts: 0, amps: 1, on: true, placement: free });
    links.push([{ comp: "G2", pin: 1 }, pin(io.inputs[0])], [{ comp: "G2", pin: 0 }, minus]);
  }
  const scene: Scene = { components, wires: links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: { ...chips, [def.id]: def } };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  const burnt = new Set<string>();
  const out = () => (sim.solution.voltage.get(pinNode(u, io.outputs[0] - 1)) ?? 0) - (sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0);
  const step = (dt: number) => {
    for (const c of sim.step(dt)) if (c.id.startsWith("U1/")) burnt.add(c.id.slice(3));
    for (const c of sim.parts) {
      const limit = heatThreshold(c);
      if (c.id.startsWith("U1/") && limit && sim.overload(c) > limit) burnt.add(c.id.slice(3));
    }
  };
  return { sim, scene, out, step, burnt };
}

/**
 * Стенд ячейки памяти: микросхема U1 (до транзисторов), блок питания 5 В, источник строки GW
 * (его напряжение задаёт шаг), источник половины питания GH и то, что висит на линиях данных:
 * подтяжки 10 кОм к питанию (RP1, RP2) и ёмкость линии CB. Шаг — какие выводы куда соединить
 * и сколько секунд так держать; после шага — напряжения на выводах.
 */
type CellTie = "vcc" | "gnd" | "wl" | "half" | "pull" | "cb" | "free";
function cellBench(def: ChipDef, chips: Record<string, ChipDef>) {
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const res = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free });
  const scene: Scene = {
    components: [
      { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free },
      u,
      { id: "GW", type: "psu", volts: 5, amps: 1, on: true, placement: free },
      { id: "GH", type: "psu", volts: 2.5, amps: 1, on: true, placement: free },
      res("RP1", 10_000),
      res("RP2", 10_000),
      { id: "CB", type: "capacitor", variant: "ceramic", uF: 1, volts: 50, placement: free } as Component,
    ],
    wires: [],
    boards: [],
    chips: { ...chips, [def.id]: def },
  };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const burnt = new Set<string>();
  /** Выводы ties (номер → куда) на seconds секунд при строке wl вольт; напряжения выводов после. */
  const hold = (ties: Record<number, CellTie>, wl: number, seconds: number) => {
    (scene.components[2] as { volts: number }).volts = wl;
    let pulls = 0;
    const links: [Endpoint, Endpoint][] = [[{ comp: "G1", pin: 0 }, { comp: "GW", pin: 0 }], [{ comp: "G1", pin: 0 }, { comp: "GH", pin: 0 }], [{ comp: "CB", pin: 1 }, { comp: "G1", pin: 0 }]];
    for (const [p, t] of Object.entries(ties)) {
      const e = pin(Number(p));
      if (t === "vcc") links.push([e, { comp: "G1", pin: 1 }]);
      if (t === "gnd") links.push([e, { comp: "G1", pin: 0 }]);
      if (t === "wl") links.push([e, { comp: "GW", pin: 1 }]);
      if (t === "half") links.push([e, { comp: "GH", pin: 1 }], [e, { comp: "CB", pin: 0 }]);
      if (t === "cb") links.push([e, { comp: "CB", pin: 0 }]);
      if (t === "pull") {
        const r = `RP${++pulls}`;
        links.push([e, { comp: r, pin: 0 }], [{ comp: r, pin: 1 }, { comp: "G1", pin: 1 }]);
      }
    }
    scene.wires = links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" }));
    sim.solve();
    for (let t = 0; t < seconds - 1e-9; t += 0.005) for (const c of sim.step(0.005)) if (c.id.startsWith("U1/")) burnt.add(c.id.slice(3));
    for (const c of sim.parts) {
      const limit = heatThreshold(c);
      if (c.id.startsWith("U1/") && limit && sim.overload(c) > limit) burnt.add(c.id.slice(3));
    }
    return (p: number) => sim.solution.voltage.get(pinNode(u, p - 1)) ?? 0;
  };
  return { hold, burnt };
}

/**
 * Ячейка SRAM (1 WL, 2 BL, 3 GND, 4 BL̅, 6 VCC): запись — строка открыта, линии держит сильный
 * источник (прямо питание и общий); в покое и при чтении линии подтянуты к питанию 10 кОм, как у
 * настоящей памяти. Чтение: одна из линий уходит к нулю — BL при нуле, BL̅ при единице.
 */
function sramSteps(def: ChipDef, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const { hold, burnt } = cellBench(def, chips);
  const base = { 3: "gnd", 6: "vcc" } as const;
  const idle = () => hold({ ...base, 1: "gnd", 2: "pull", 4: "pull" }, 5, 0.05);
  const write = (b: boolean) => hold({ ...base, 1: "wl", 2: b ? "vcc" : "gnd", 4: b ? "gnd" : "vcc" }, 5, 0.02);
  const read = () => {
    const v = hold({ ...base, 1: "wl", 2: "pull", 4: "pull" }, 5, 0.02);
    return [v(2), v(4)] as const;
  };
  const out: { text: string; ok: boolean }[] = [];
  const fmt = (x: number) => formatSI(x, "В");
  for (const b of [true, false]) {
    write(b);
    // Не выбранная ячейка линий не трогает: обе остаются подтянутыми к питанию
    const v = idle();
    out.push({ text: `Записали ${+b}, строка закрыта: BL ${fmt(v(2))}, BL̅ ${fmt(v(4))} (обе должны остаться высокими — ячейка не выбрана)`, ok: v(2) >= 3.5 && v(4) >= 3.5 });
    const [bl1, blb1] = read();
    idle();
    const [bl2, blb2] = read();
    idle();
    const good = (bl: number, blb: number) => (b ? bl >= 3.5 && blb <= 1.5 : bl <= 1.5 && blb >= 3.5);
    out.push({ text: `Открыли строку и прочитали: BL ${fmt(bl1)}, BL̅ ${fmt(blb1)} (нужно ${b ? "BL высокий, BL̅ у нуля" : "BL у нуля, BL̅ высокий"})`, ok: good(bl1, blb1) });
    out.push({ text: `Прочитали ещё раз — чтение не портит: BL ${fmt(bl2)}, BL̅ ${fmt(blb2)}`, ok: good(bl2, blb2) });
  }
  out.push({ text: burnt.size ? `Сгорело: ${[...burnt].join(", ")}` : "Ничего не сгорело", ok: !burnt.size });
  return out;
}

/** Сдвиг линии при чтении DRAM, который ещё различит усилитель чтения, В. */
export const DRAM_SENSE = 0.1;

/**
 * Ячейка DRAM (1 WL, 2 BL, 4 GND): запись — строка 10 В (выше питания, как у настоящих DRAM),
 * линия 0 или 5 В; хранение — строка 0, линия меняется (пишут соседей); чтение — линию с ёмкостью
 * 1 мкФ ставят на 2,5 В, отпускают и открывают строку: сдвиг вверх — было 1, вниз — было 0.
 */
function dramSteps(def: ChipDef, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const { hold, burnt } = cellBench(def, chips);
  const write = (b: boolean) => hold({ 4: "gnd", 1: "wl", 2: b ? "vcc" : "gnd" }, 10, 0.02);
  // Пока ячейка заперта, по линии гуляют чужие записи: то 0, то 5 В
  const wait = () => {
    hold({ 4: "gnd", 1: "gnd", 2: "vcc" }, 10, 0.25);
    hold({ 4: "gnd", 1: "gnd", 2: "gnd" }, 10, 0.25);
  };
  const read = () => {
    hold({ 4: "gnd", 1: "gnd", 2: "half" }, 10, 0.02);
    return hold({ 4: "gnd", 1: "wl", 2: "cb" }, 10, 0.02)(2) - 2.5;
  };
  const mv = (x: number) => `${x >= 0 ? "+" : "−"}${formatSI(Math.abs(x), "В")}`;
  const out: { text: string; ok: boolean }[] = [];
  for (const b of [true, false]) {
    write(b);
    wait();
    const d = read();
    out.push({ text: `Записали ${+b}, полсекунды хранили, прочитали: линия ${mv(d)} от 2,5 В (нужно ${b ? "вверх" : "вниз"} хотя бы на ${formatSI(DRAM_SENSE, "В")})`, ok: b ? d >= DRAM_SENSE : d <= -DRAM_SENSE });
  }
  write(true);
  const first = read();
  const second = read();
  out.push({ text: `Прочитали 1 два раза подряд, не переписывая: ${mv(first)}, потом ${mv(second)} — чтение разрядило ячейку, поэтому память после чтения записывает бит обратно`, ok: true });
  out.push({ text: burnt.size ? `Сгорело: ${[...burnt].join(", ")}` : "Ничего не сгорело", ok: !burnt.size });
  return out;
}

/** Пороги по даташиту 74LVC1G14 (4,5–5,5 В), В: VT+, VT−, наименьший гистерезис. */
export const SCHMITT_LIMITS = { up: [2.2, 3.4], down: [1.4, 2.4], hyst: 0.5 } as const;

/**
 * Пороги входа: вход плавно поднимают от 0 до питания и опускают обратно шагами 0,05 В; где выход
 * переключился — там и порог. undefined — не переключился.
 */
export function thresholds(def: ChipDef, level: Level, chips: Record<string, ChipDef>, volts = CHECK_VOLTS) {
  const b = bench(def, level, chips, volts);
  const g2 = b.scene.components.find((c) => c.id === "G2") as Extract<Component, { type: "psu" }>;
  const at = (v: number) => {
    g2.volts = v;
    b.sim.solve();
    b.step(0.01);
    return b.out() > volts / 2;
  };
  const n = Math.round(volts / 0.05);
  const start = at(0);
  let up: number | undefined, down: number | undefined;
  for (let i = 1; i <= n; i++) if (up === undefined && at(i * 0.05) !== start) up = i * 0.05;
  const top = at(volts);
  for (let i = n - 1; i >= 0; i--) if (down === undefined && at(i * 0.05) !== top) down = i * 0.05;
  return { up, down, burnt: [...b.burnt] };
}

/** Проверка порогов триггера Шмитта: шаги, как у уроков. */
function sweepSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const { up, down, burnt } = thresholds(def, level, chips);
  const L = SCHMITT_LIMITS;
  const v = (x: number | undefined) => (x === undefined ? "не переключился" : formatSI(x, "В"));
  const within = (x: number | undefined, [a, b]: readonly number[]) => x !== undefined && x >= a && x <= b;
  const h = up !== undefined && down !== undefined ? up - down : undefined;
  return [
    { text: `Вход растёт — выход переключается при ${L.up[0]}–${L.up[1]} В (VT+): сейчас ${v(up)}`.replace(/\./g, ","), ok: within(up, L.up) },
    { text: `Вход падает — при ${L.down[0]}–${L.down[1]} В (VT−): сейчас ${v(down)}`.replace(/\./g, ","), ok: within(down, L.down) },
    { text: `Гистерезис VT+ − VT− не меньше ${formatSI(L.hyst, "В")}: сейчас ${h === undefined ? "—" : formatSI(h, "В")}`, ok: h !== undefined && h >= L.hyst },
    { text: burnt.length ? `Ничего не сгорело — а сейчас: ${burnt.join(", ")}` : "Ничего не сгорело", ok: !burnt.length },
  ];
}

/** Период генератора, с (по фронтам через половину питания), доля времени в единице и размах. */
export function oscillation(def: ChipDef, level: Level, chips: Record<string, ChipDef>, seconds = 6) {
  const b = bench(def, level, chips);
  const dt = 0.005;
  const vs: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    b.step(dt);
    vs.push(b.out());
  }
  const tail = vs.slice(Math.round(1 / dt));
  const mid = CHECK_VOLTS / 2;
  const rises: number[] = [];
  for (let i = 1; i < tail.length; i++) if (tail[i - 1] < mid && tail[i] >= mid) rises.push(i * dt);
  const period = rises.length >= 2 ? (rises.at(-1)! - rises[0]) / (rises.length - 1) : 0;
  const span = rises.length >= 2 ? tail.slice(Math.round(rises[0] / dt), Math.round(rises.at(-1)! / dt)) : tail;
  const duty = span.length ? span.filter((v) => v >= mid).length / span.length : 0;
  return { period, duty, lo: Math.min(...tail), hi: Math.max(...tail), burnt: [...b.burnt] };
}

/**
 * Дребезг контактов, мс от нажатия (отпускания): моменты, когда контакт меняет состояние. Нажатие —
 * замкнулся, через 0,3 мс разомкнулся… с 3,2 мс замкнут; отпускание — с 1,7 мс разомкнут.
 */
export const BOUNCE = { press: [0, 0.3, 0.8, 1.2, 2.0, 2.3, 3.2], release: [0, 0.4, 0.6, 1.5, 1.7] };
/** Сценарий проверки, мс: кнопка отпущена, нажатие, отпускание, импульс 1 мс, конец. */
export const BOUNCE_AT = { press: 150, release: 400, glitch: 650, end: 750 };

/** Замкнута ли кнопка в момент t (мс) сценария проверки дребезга. */
export function buttonClosed(t: number): boolean {
  const phase = (from: number, marks: number[], first: boolean) => {
    const k = marks.filter((m) => t - from >= m).length;
    return k % 2 === 1 ? first : !first;
  };
  if (t < BOUNCE_AT.press) return false;
  if (t < BOUNCE_AT.release) return phase(BOUNCE_AT.press, BOUNCE.press, true);
  if (t < BOUNCE_AT.glitch) return phase(BOUNCE_AT.release, BOUNCE.release, false);
  return t < BOUNCE_AT.glitch + 1;
}

/**
 * Прогнать сценарий дребезга: какой выход до нажатия и когда (мс) он переключался —
 * с гистерезисом: ноль ниже 1,5 В, единица выше 3,5 В.
 */
export function bounceRun(def: ChipDef, level: Level, chips: Record<string, ChipDef>) {
  const b = bench(def, level, chips, CHECK_VOLTS, true);
  const sw = b.scene.components.find((c) => c.id === "SB1") as Extract<Component, { type: "switch" }>;
  // Шаг 0,1 мс там, где контакт дребезжит, и 0,5 мс в остальное время
  const fine = (t: number) => [BOUNCE_AT.press, BOUNCE_AT.release, BOUNCE_AT.glitch].some((a) => t >= a - 0.5 && t < a + 5);
  let state: boolean | undefined;
  let initial: boolean | undefined;
  const edges: { t: number; high: boolean }[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let t = 0, dt = 0.1; t < BOUNCE_AT.end; t += dt) {
    dt = fine(t) ? 0.1 : 0.5;
    sw.closed = buttonClosed(t);
    b.step(dt / 1000);
    const v = b.out();
    const now = v >= 3.5 ? true : v <= 1.5 ? false : state;
    if (t >= BOUNCE_AT.press - 20) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (t < BOUNCE_AT.press) {
      state = now;
      initial = now;
      continue;
    }
    if (now !== undefined && now !== state) edges.push({ t, high: now });
    state = now;
  }
  return { initial, edges, lo, hi, burnt: [...b.burnt] };
}

/** Проверка подавителя дребезга: шаги, как у генератора. */
function bounceSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const r = bounceRun(def, level, chips);
  const [min, max] = level.delay ?? [0, 80];
  const within = (from: number, to: number) => r.edges.filter((e) => e.t >= from && e.t < to);
  const press = within(BOUNCE_AT.press, BOUNCE_AT.release);
  const release = within(BOUNCE_AT.release, BOUNCE_AT.glitch);
  const glitch = within(BOUNCE_AT.glitch, BOUNCE_AT.end);
  const ms = (x: number) => `${String(Math.round(x * 10) / 10).replace(".", ",")} мс`;
  const once = (es: typeof press, high: boolean, at: number, what: string) => {
    const ok = es.length === 1 && es[0].high === high && es[0].t - at >= min && es[0].t - at <= max;
    const now = !es.length ? "выход не переключился" : es.length > 1 ? `переключился ${es.length} раз` : es[0].high !== high ? "ушёл не туда" : `через ${ms(es[0].t - at)}`;
    return { text: `${what}: выход один раз уходит в ${high ? "единицу" : "ноль"} через ${min ? `${min}–` : "не больше "}${max} мс — сейчас ${now}`, ok };
  };
  return [
    { text: `Кнопка отпущена: на выходе единица — сейчас ${r.initial === undefined ? "ни то ни сё" : r.initial ? "единица" : "ноль"}`, ok: r.initial === true },
    once(press, false, BOUNCE_AT.press, "Нажатие с дребезгом"),
    once(release, true, BOUNCE_AT.release, "Отпускание с дребезгом"),
    { text: `Импульс 1 мс — помеха: выход не меняется${glitch.length ? ` — а он переключился ${glitch.length} раз` : ""}`, ok: !glitch.length },
    { text: `Уровни чистые: ноль не выше 1,5 В, единица не ниже 3,5 В — сейчас ${formatSI(r.lo, "В")} … ${formatSI(r.hi, "В")}`, ok: r.lo <= 1.5 && r.hi >= 3.5 },
    { text: r.burnt.length ? `Ничего не сгорело — а сейчас: ${r.burnt.join(", ")}` : "Ничего не сгорело", ok: !r.burnt.length },
  ];
}

/**
 * Точки проверки компаратора: общий уровень входов, В, и разница «+ минус −», В. Разница 50 мВ —
 * компаратор должен её различать при любом общем уровне в своём диапазоне (у LM393 — до питания − 1,5 В).
 */
export const COMPARE_POINTS: [number, number][] = [0.3, 1.0, 2.0, 3.3].flatMap((cm): [number, number][] => [[cm, 0.05], [cm, -0.05], [cm, 1], [cm, -1]]);

/** Прогнать компаратор по точкам: у каждого канала — выход при V+ и V−. */
export function compareRun(def: ChipDef, level: Level, chips: Record<string, ChipDef>) {
  const io = gateIo(level);
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const ch = level.channels ?? [];
  const components: Component[] = [{ id: "G1", type: "psu", volts: CHECK_VOLTS, amps: 1, on: true, placement: free }, u];
  const links: [Endpoint, Endpoint][] = [[plus, pin(io.vcc)], [minus, pin(io.gnd)]];
  ch.forEach((c, k) => {
    for (const [id, p] of [[`GP${k}`, c.plus], [`GM${k}`, c.minus]] as const) {
      components.push({ id, type: "psu", volts: 0, amps: 1, on: true, placement: free });
      links.push([{ comp: id, pin: 1 }, pin(p)], [{ comp: id, pin: 0 }, minus]);
    }
    components.push({ id: `RP${k}`, type: "resistor", variant: "tht", ohms: PULL_UP, smdSize: "0805", placement: free });
    components.push({ id: `RL${k}`, type: "resistor", variant: "tht", ohms: 100_000, smdSize: "0805", placement: free });
    links.push([pin(c.out), { comp: `RP${k}`, pin: 0 }], [{ comp: `RP${k}`, pin: 1 }, plus], [pin(c.out), { comp: `RL${k}`, pin: 0 }], [{ comp: `RL${k}`, pin: 1 }, minus]);
  });
  const scene: Scene = { components, wires: links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: { ...chips, [def.id]: def } };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  const burnt = new Set<string>();
  const src = (id: string) => scene.components.find((c) => c.id === id) as Extract<Component, { type: "psu" }>;
  const rows: { ch: number; cm: number; diff: number; v: number; ok: boolean; inAmps: number }[] = [];
  ch.forEach((c, k) => {
    for (const [cm, diff] of COMPARE_POINTS) {
      src(`GP${k}`).volts = Math.max(0, cm + diff / 2);
      src(`GM${k}`).volts = Math.max(0, cm - diff / 2);
      sim.solve();
      for (const b of sim.step(0.01)) if (b.id.startsWith("U1/")) burnt.add(b.id.slice(3));
      for (const p of sim.parts) {
        const limit = heatThreshold(p);
        if (p.id.startsWith("U1/") && limit && sim.overload(p) > limit) burnt.add(p.id.slice(3));
      }
      const gnd = sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0;
      const v = (sim.solution.voltage.get(pinNode(u, c.out - 1)) ?? 0) - gnd;
      const inAmps = Math.max(...[`GP${k}`, `GM${k}`].map((id) => Math.abs(sim.current(src(id)))));
      rows.push({ ch: k, cm, diff, v, ok: diff > 0 ? v >= 3.5 : v <= 0.4, inAmps });
    }
  });
  return { rows, burnt: [...burnt] };
}

/** Проверка компаратора: по каналам — различает ли 50 мВ и 1 В, выход «ноль» не выше 0,4 В (как у LM393 по даташиту). */
function compareSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const { rows, burnt } = compareRun(def, level, chips);
  const n = level.channels?.length ?? 1;
  const mv = (x: number) => `${Math.round(x * 1000)} мВ`;
  const out: { text: string; ok: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    const mine = rows.filter((r) => r.ch === k);
    const name = n > 1 ? `Канал ${k + 1}: ` : "";
    const bad = mine.filter((r) => !r.ok);
    const worst = bad[0];
    out.push({
      text: `${name}IN+ выше IN− хотя бы на 50 мВ — выход отпущен (с резистором 10 кОм к питанию не ниже 3,5 В); ниже — прижат (не выше 0,4 В), при общем уровне 0,3–3,3 В${worst ? ` — неверно при ${String(worst.cm).replace(".", ",")} В и разнице ${worst.diff > 0 ? "+" : "−"}${mv(Math.abs(worst.diff))}: выход ${formatSI(worst.v, "В")}${bad.length > 1 ? ` (и ещё ${bad.length - 1})` : ""}` : ""}`,
      ok: !bad.length,
    });
    const ia = Math.max(...mine.map((r) => r.inAmps));
    out.push({ text: `${name}Вход почти не берёт тока — меньше 1 мкА: сейчас ${formatSI(ia, "А")}`, ok: ia < 1e-6 });
  }
  out.push({ text: burnt.length ? `Ничего не сгорело — а сейчас: ${burnt.join(", ")}` : "Ничего не сгорело", ok: !burnt.length });
  return out;
}

/**
 * Операционный усилитель по даташиту LM321/LM358 при 5 В. Схемы включения: повторитель (выход на
 * IN−), неинвертирующий ×2 (10 кОм с выхода на IN−, 10 кОм с IN− на общий), без обратной связи
 * (оба входа от источников). vin — напряжение на IN+, vminus — на IN− (только без обратной связи),
 * load — нагрузка с выхода на общий, Ом.
 */
type OpampCase = { mode: "follow" | "gain2" | "open"; vin: number; vminus?: number; load?: number };

export function opampRun(def: ChipDef, level: Level, chips: Record<string, ChipDef>, c: OpampCase) {
  const io = gateIo(level);
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const res = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free });
  const src = (id: string, volts: number): Component => ({ id, type: "psu", volts, amps: 1, on: true, placement: free });
  const components: Component[] = [src("G1", CHECK_VOLTS), u];
  const links: [Endpoint, Endpoint][] = [[plus, pin(io.vcc)], [minus, pin(io.gnd)]];
  const ch = level.channels ?? [];
  ch.forEach((k, i) => {
    components.push(src(`GP${i}`, c.vin));
    links.push([{ comp: `GP${i}`, pin: 1 }, pin(k.plus)], [{ comp: `GP${i}`, pin: 0 }, minus]);
    if (c.mode === "follow") links.push([pin(k.out), pin(k.minus)]);
    if (c.mode === "gain2") {
      components.push(res(`RF${i}`, 10_000), res(`RG${i}`, 10_000));
      links.push([pin(k.out), { comp: `RF${i}`, pin: 0 }], [{ comp: `RF${i}`, pin: 1 }, pin(k.minus)], [pin(k.minus), { comp: `RG${i}`, pin: 0 }], [{ comp: `RG${i}`, pin: 1 }, minus]);
    }
    if (c.mode === "open") {
      components.push(src(`GM${i}`, c.vminus ?? 0));
      links.push([{ comp: `GM${i}`, pin: 1 }, pin(k.minus)], [{ comp: `GM${i}`, pin: 0 }, minus]);
    }
    if (c.load) {
      components.push(res(`RL${i}`, c.load));
      links.push([pin(k.out), { comp: `RL${i}`, pin: 0 }], [{ comp: `RL${i}`, pin: 1 }, minus]);
    }
  });
  const scene: Scene = { components, wires: links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: { ...chips, [def.id]: def } };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  sim.solve();
  const burnt = new Set<string>();
  for (const b of sim.step(0.01)) if (b.id.startsWith("U1/")) burnt.add(b.id.slice(3));
  for (const p of sim.parts) {
    const limit = heatThreshold(p);
    if (p.id.startsWith("U1/") && limit && sim.overload(p) > limit) burnt.add(p.id.slice(3));
  }
  const gnd = sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0;
  const find = (id: string) => scene.components.find((x) => x.id === id)!;
  const outs = ch.map((k, i) => ({
    v: (sim.solution.voltage.get(pinNode(u, k.out - 1)) ?? 0) - gnd,
    inAmps: Math.max(Math.abs(sim.current(find(`GP${i}`))), c.mode === "open" ? Math.abs(sim.current(find(`GM${i}`))) : 0),
  }));
  return { outs, supply: Math.abs(sim.current(find("G1"))), burnt: [...burnt] };
}

/** Точки повторителя и усилителя ×2, В на IN+. */
export const FOLLOW_POINTS = [0.1, 1, 2, 3];
export const GAIN2_POINTS = [0.25, 0.75, 1.5];

/** Проверка операционного усилителя: по каналам — повторитель, ×2, нагрузка, без обратной связи, входной ток; ток потребления. */
function opampSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const n = level.channels?.length ?? 1;
  const run = (c: OpampCase) => opampRun(def, level, chips, c);
  const burnt = new Set<string>();
  const inAmps = Array.from({ length: n }, () => 0);
  const note = (r: ReturnType<typeof run>) => {
    r.burnt.forEach((b) => burnt.add(b));
    r.outs.forEach((o, k) => (inAmps[k] = Math.max(inAmps[k], o.inAmps)));
    return r;
  };
  const follow = FOLLOW_POINTS.map((vin) => ({ vin, r: note(run({ mode: "follow", vin, load: 10_000 })) }));
  const gain = GAIN2_POINTS.map((vin) => ({ vin, r: note(run({ mode: "gain2", vin })) }));
  const loaded = note(run({ mode: "follow", vin: 2, load: 2_000 }));
  const high = note(run({ mode: "open", vin: 1.1, vminus: 1, load: 10_000 }));
  const low = note(run({ mode: "open", vin: 0.9, vminus: 1, load: 10_000 }));
  const idle = note(run({ mode: "follow", vin: 1 }));
  const mv = (x: number) => `${Math.round(x * 1000)} мВ`;
  const v = (x: number) => formatSI(x, "В");
  const out: { text: string; ok: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    const name = n > 1 ? `Канал ${k + 1}: ` : "";
    const fBad = follow.find((f) => Math.abs(f.r.outs[k].v - f.vin) > 0.01);
    out.push({ text: `${name}Повторитель (выход на IN−): выход = IN+ с точностью 10 мВ при 0,1–3 В${fBad ? ` — при ${v(fBad.vin)} на выходе ${v(fBad.r.outs[k].v)}` : ""}`, ok: !fBad });
    const gBad = gain.find((g) => Math.abs(g.r.outs[k].v - 2 * g.vin) > 0.01 + 0.01 * 2 * g.vin);
    out.push({ text: `${name}Усилитель ×2 (10 кОм с выхода на IN−, 10 кОм с IN− на общий): выход = 2·IN+ с точностью 1 % + 10 мВ${gBad ? ` — при ${v(gBad.vin)} на выходе ${v(gBad.r.outs[k].v)}` : ""}`, ok: !gBad });
    const lv = loaded.outs[k].v;
    out.push({ text: `${name}Повторитель под нагрузкой 2 кОм: при 2 В на входе ошибка не больше 10 мВ — сейчас ${mv(Math.abs(lv - 2))}`, ok: Math.abs(lv - 2) <= 0.01 });
    const hi = high.outs[k].v, lo = low.outs[k].v;
    out.push({ text: `${name}Без обратной связи (разница 100 мВ, нагрузка 10 кОм): выход не ниже 3,5 В и не выше 20 мВ — сейчас ${v(hi)} и ${v(lo)}`, ok: hi >= 3.5 && lo <= 0.02 });
    out.push({ text: `${name}Входной ток не больше 250 нА — сейчас ${formatSI(inAmps[k], "А")}`, ok: inAmps[k] <= 250e-9 });
  }
  const perAmp = idle.supply / n;
  out.push({ text: `Ток потребления без нагрузки не больше 1,15 мА на усилитель — сейчас ${formatSI(perAmp, "А")}`, ok: perAmp <= 1.15e-3 });
  out.push({ text: burnt.size ? `Ничего не сгорело — а сейчас: ${[...burnt].join(", ")}` : "Ничего не сгорело", ok: !burnt.size });
  return out;
}

/** Стабилизатор при входе vin и токе нагрузки iout (нагрузка — резистор vnom/iout): выход, ток покоя. */
export function regRun(def: ChipDef, level: Level, chips: Record<string, ChipDef>, vin: number, iout: number) {
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const io = gateIo(level);
  const out = io.outputs[0];
  const components: Component[] = [{ id: "G1", type: "psu", volts: vin, amps: 1, on: true, placement: free }, u];
  const links: [Endpoint, Endpoint][] = [[plus, pin(io.vcc)], ...level.roles.flatMap((r, i): [Endpoint, Endpoint][] => (r === "gnd" ? [[minus, pin(i + 1)]] : []))];
  if (iout > 0) {
    components.push({ id: "RL", type: "resistor", variant: "tht", ohms: level.reg!.vnom / iout, smdSize: "0805", placement: free });
    links.push([pin(out), { comp: "RL", pin: 0 }], [{ comp: "RL", pin: 1 }, minus]);
  }
  const scene: Scene = { components, wires: links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: { ...chips, [def.id]: def } };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  sim.solve();
  const burnt = new Set<string>();
  for (let t = 0; t < 0.05; t += 0.01) for (const b of sim.step(0.01)) if (b.id.startsWith("U1/")) burnt.add(b.id.slice(3));
  for (const p of sim.parts) {
    const limit = heatThreshold(p);
    if (p.id.startsWith("U1/") && limit && sim.overload(p) > limit) burnt.add(p.id.slice(3));
  }
  const gnd = sim.solution.voltage.get(pinNode(u, io.gnd - 1)) ?? 0;
  const vout = (sim.solution.voltage.get(pinNode(u, out - 1)) ?? 0) - gnd;
  const iin = Math.abs(sim.current(scene.components[0]));
  const iload = iout > 0 ? Math.abs(sim.current(scene.components.find((c) => c.id === "RL")!)) : 0;
  return { vout, iq: iin - iload, burnt: [...burnt] };
}

/** Проверка стабилизатора по его reg: выход во всех углах, нестабильность по входу и нагрузке, ток покоя. */
function regulatorSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const g = level.reg!;
  const [v0, v1] = g.vin;
  const [i0, i1] = g.iout;
  const vmid = Math.min(10, v1);
  const run = (vin: number, iout: number) => regRun(def, level, chips, vin, iout);
  const corners = [[v0, i0], [v0, i1], [v1, i0], [v1, i1], [vmid, i1]].map(([vin, iout]) => ({ vin, iout, r: run(vin, iout) }));
  const burnt = new Set(corners.flatMap((c) => c.r.burnt));
  const at = (vin: number, iout: number) => corners.find((c) => c.vin === vin && c.iout === iout)!.r;
  const v = (x: number) => formatSI(x, "В");
  const ma = (x: number) => formatSI(x, "А");
  const bad = corners.find((c) => c.r.vout < g.vout[0] || c.r.vout > g.vout[1]);
  const line = Math.abs(at(v1, i1).vout - at(v0, i1).vout);
  const load = Math.abs(at(vmid, i1).vout - run(vmid, i0).vout);
  const iq = run(vmid, i0).iq;
  const typ = at(vmid, i1).vout;
  return [
    ...(g.vtyp ? [{ text: `При ${v(vmid)} и ${ma(i1)} выход ${v(g.vtyp[0])}…${v(g.vtyp[1])} — сейчас ${v(typ)}`, ok: typ >= g.vtyp[0] && typ <= g.vtyp[1] }] : []),
    { text: `Выход ${v(g.vout[0])}…${v(g.vout[1])} при входе ${v(v0)}–${v(v1)} и нагрузке ${ma(i0)}–${ma(i1)}: ${corners.map((c) => `${v(c.vin)}, ${ma(c.iout)} → ${v(c.r.vout)}`).join("; ")}${bad ? " — не в пределах" : ""}`, ok: !bad },
    { text: `Вход ${v(v0)} → ${v(v1)} (нагрузка ${ma(i1)}): выход меняется не больше чем на ${formatSI(g.line, "В")} — сейчас ${formatSI(line, "В")}`, ok: line <= g.line },
    { text: `Нагрузка ${ma(i0)} → ${ma(i1)} (вход ${v(vmid)}): выход меняется не больше чем на ${formatSI(g.load, "В")} — сейчас ${formatSI(load, "В")}`, ok: load <= g.load },
    { text: `Ток покоя при ${v(vmid)} не больше ${ma(g.iq)} — сейчас ${ma(iq)}`, ok: iq <= g.iq },
    { text: burnt.size ? `Ничего не сгорело — а сейчас: ${[...burnt].join(", ")}` : "Ничего не сгорело", ok: !burnt.size },
  ];
}

/** Генератор на 555 по даташиту: RA, RB, C и ожидаемые период и доля единицы. */
export const ASTABLE = { ra: 10_000, rb: 47_000, uF: 1, period: 0.693 * (10_000 + 2 * 47_000) * 1e-6, duty: (10_000 + 47_000) / (10_000 + 2 * 47_000) };

/** 555 генератором: RA от питания к DISCH, RB от DISCH к THRES и TRIG, C от них к общему; RESET̅ — к питанию. */
export function astableRun(def: ChipDef, chips: Record<string, ChipDef>, seconds = 0.6) {
  const free = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const u: Chip = { id: "U1", type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: free };
  const pin = (p: number): Endpoint => ({ comp: "U1", pin: p - 1 });
  const plus: Endpoint = { comp: "G1", pin: 1 };
  const minus: Endpoint = { comp: "G1", pin: 0 };
  const components: Component[] = [
    { id: "G1", type: "psu", volts: CHECK_VOLTS, amps: 1, on: true, placement: free },
    u,
    { id: "RA", type: "resistor", variant: "tht", ohms: ASTABLE.ra, smdSize: "0805", placement: free },
    { id: "RB", type: "resistor", variant: "tht", ohms: ASTABLE.rb, smdSize: "0805", placement: free },
    { id: "C1", type: "capacitor", variant: "ceramic", uF: ASTABLE.uF, volts: 50, placement: free },
    { id: "RL", type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free },
  ];
  const links: [Endpoint, Endpoint][] = [
    [plus, pin(8)], [minus, pin(1)], [plus, pin(4)],
    [plus, { comp: "RA", pin: 0 }], [{ comp: "RA", pin: 1 }, pin(7)],
    [pin(7), { comp: "RB", pin: 0 }], [{ comp: "RB", pin: 1 }, pin(6)], [pin(6), pin(2)],
    [pin(6), { comp: "C1", pin: 0 }], [{ comp: "C1", pin: 1 }, minus],
    [pin(3), { comp: "RL", pin: 0 }], [{ comp: "RL", pin: 1 }, minus],
  ];
  const scene: Scene = { components, wires: links.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: { ...chips, [def.id]: def } };
  const sim = new Simulation(scene, undefined, { expand: ["U1"], strictModels: true });
  const burnt = new Set<string>();
  const dt = 0.0005;
  const vs: number[] = [];
  sim.solve();
  for (let t = 0; t < seconds; t += dt) {
    for (const b of sim.step(dt)) if (b.id.startsWith("U1/")) burnt.add(b.id.slice(3));
    vs.push((sim.solution.voltage.get(pinNode(u, 2)) ?? 0) - (sim.solution.voltage.get(pinNode(u, 0)) ?? 0));
  }
  // Первый период — заряд конденсатора с нуля до 2/3 — длиннее: пропускаем
  const tail = vs.slice(Math.round(0.15 / dt));
  const mid = CHECK_VOLTS / 2;
  const rises: number[] = [];
  for (let i = 1; i < tail.length; i++) if (tail[i - 1] < mid && tail[i] >= mid) rises.push(i * dt);
  const period = rises.length >= 2 ? (rises.at(-1)! - rises[0]) / (rises.length - 1) : 0;
  const span = rises.length >= 2 ? tail.slice(Math.round(rises[0] / dt), Math.round(rises.at(-1)! / dt)) : tail;
  const duty = span.length ? span.filter((v) => v >= mid).length / span.length : 0;
  return { period, duty, lo: Math.min(...tail), hi: Math.max(...tail), burnt: [...burnt] };
}

/** Проверка 555 генератором: период и доля единицы — по формуле даташита, ±15 %. */
function astableSteps(def: ChipDef, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const a = astableRun(def, chips);
  const ms = (x: number) => `${String(Math.round(x * 10000) / 10).replace(".", ",")} мс`;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return [
    { text: `Генератор (RA 10 кОм, RB 47 кОм, C 1 мкФ): период ${ms(ASTABLE.period)} ± 15 % — сейчас ${a.period ? ms(a.period) : "не генерирует"}`, ok: Math.abs(a.period - ASTABLE.period) <= 0.15 * ASTABLE.period },
    { text: `В единице ${pct(ASTABLE.duty)} ± 5 % времени — сейчас ${a.period ? pct(a.duty) : "—"}`, ok: !!a.period && Math.abs(a.duty - ASTABLE.duty) <= 0.05 },
    { text: `Размах выхода: ноль не выше 1,5 В, единица не ниже 3,5 В — сейчас ${formatSI(a.lo, "В")} … ${formatSI(a.hi, "В")}`, ok: a.lo <= 1.5 && a.hi >= 3.5 },
    { text: a.burnt.length ? `Ничего не сгорело — а сейчас: ${a.burnt.join(", ")}` : "Ничего не сгорело", ok: !a.burnt.length },
  ];
}

/** Проверка генератора: период, скважность, размах. */
function oscSteps(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { text: string; ok: boolean }[] {
  const o = oscillation(def, level, chips);
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return [
    { text: o.period ? `Генерирует: период 0,5–2 с — сейчас ${formatSI(o.period, "с")}` : "Генерирует: выход сам меняется то в ноль, то в единицу", ok: o.period >= 0.5 && o.period <= 2 },
    { text: `В единице 30–70 % времени — сейчас ${o.period ? pct(o.duty) : "—"}`, ok: !!o.period && o.duty >= 0.3 && o.duty <= 0.7 },
    { text: `Размах: ноль не выше 1,5 В, единица не ниже 3,5 В — сейчас ${formatSI(o.lo, "В")} … ${formatSI(o.hi, "В")}`, ok: o.lo <= 1.5 && o.hi >= 3.5 },
    { text: o.burnt.length ? `Ничего не сгорело — а сейчас: ${o.burnt.join(", ")}` : "Ничего не сгорело", ok: !o.burnt.length },
  ];
}

/** Проверить сборку уровня: корпус, набор, таблица истинности. */
export function checkLevel(level: Level, scene: Scene, chips: Record<string, ChipDef>, id = `career:${level.id}`): CheckResult {
  const problems = [...packageProblems(scene), ...kitProblems(level, scene)];
  if (problems.length) return { ok: false, problems, rows: [] };
  const def = packageChip(scene, level.part, id);
  def.scene.chips = { ...chipsUsed(scene), ...(scene.chips ?? {}) };
  // Вход КМОП, ни к чему не подключённый, уходит к середине питания: что выйдет — не угадать
  const floating = floatingInside(def, { ...chips, ...def.scene.chips });
  const hanging = floating.length ? [`Входы микросхем внутри висят в воздухе (ни к чему не подключены): ${floating.join(", ")}.`] : [];
  // Предел питания по паспорту — у собранной аналоговой микросхемы (у логики он в её модели)
  if (level.absMax) def.absMax = level.absMax;
  if (level.check === "osc" || level.check === "bounce" || level.check === "compare" || level.check === "opamp" || level.check === "regulator" || level.check === "sram" || level.check === "dram") {
    const all = { ...chips, ...def.scene.chips };
    const steps =
      level.check === "osc" ? oscSteps(def, level, all) : level.check === "bounce" ? bounceSteps(def, level, all) : level.check === "opamp" ? opampSteps(def, level, all) : level.check === "regulator" ? regulatorSteps(def, level, all) : level.check === "sram" ? sramSteps(def, all) : level.check === "dram" ? dramSteps(def, all) : compareSteps(def, level, all);
    const ok = steps.every((x) => x.ok) && !hanging.length;
    return ok
      ? { ok, problems: [], rows: [], steps, def, metrics: measure(scene, [], def, all) }
      : { ok, problems: steps.every((x) => x.ok) ? hanging : [`${FUNC_NAMES[level.func]} работает не так: смотрите шаги с ✗.`, ...hanging], rows: [], steps };
  }
  const rows = truthTable(def, level, { ...chips, ...def.scene.chips });
  const steps = !rows.every((r) => r.ok)
    ? undefined
    : level.check === "sweep"
      ? sweepSteps(def, level, { ...chips, ...def.scene.chips })
      : level.check === "timer"
        ? astableSteps(def, { ...chips, ...def.scene.chips })
        : undefined;
  const ok = rows.every((r) => r.ok) && (steps ?? []).every((x) => x.ok);
  if (!ok)
    return rows.every((r) => r.ok)
      ? { ok, problems: [`${FUNC_NAMES[level.func]}: таблица сходится, а ${level.check === "timer" ? "генератор" : "пороги"} — нет: смотрите шаги с ✗.`], rows, steps }
      : { ok, problems: [`${FUNC_NAMES[level.func]} работает не так: смотрите строки с ✗.`, ...hanging], rows, diagnosis: diagnose(level, def, rows) };
  // Таблица сошлась, но вход висит: сейчас повезло, на другой плате выйдет иначе
  if (hanging.length) return { ok: false, problems: hanging, rows };
  const all = { ...chips, ...def.scene.chips };
  const sweep = supplySweep(def, level, all, rows);
  const pt = pointFromRows(level, rows, CHECK_VOLTS, truthTable(def, level, all, CHECK_VOLTS, HEAVY_LOAD));
  const metrics = { ...measure(scene, rows, def, all), vmin: sweep.at(-1)!.volts, rOut: Math.max(...pt.rHigh, ...pt.rLow) };
  return { ok, problems: [], rows, def, metrics, ...(steps ? { steps } : {}) };
}

/**
 * Входы микросхем начинки, чья цепь не идёт ни к выводу корпуса, ни к выходу, питанию или другой
 * детали — только к таким же входам (или ни к чему).
 */
export function floatingInside(def: ChipDef, chips: Record<string, ChipDef>): string[] {
  const netOf = new Map<string, (typeof def.nets)[number]>();
  for (const n of def.nets) for (const [id, p] of n.members) netOf.set(`${id}:${p}`, n);
  const roleOf = (id: string, p: number) => {
    const c = def.parts.find((x) => x.id === id);
    return c?.type === "chip" ? chips[c.def]?.pinRoles?.[p] : "part";
  };
  const out: string[] = [];
  for (const c of def.parts) {
    if (c.type !== "chip") continue;
    const d = chips[c.def];
    d?.pinRoles?.forEach((r, p) => {
      if (r !== "in") return;
      const n = netOf.get(`${c.id}:${p}`);
      const driven = !!n && ((n.pins?.length ?? 0) > 0 || n.members.some(([id, q]) => { const x = roleOf(id, q); return x !== "in" && x !== "nc"; }));
      if (!driven) out.push(`${c.id}.${p + 1}${d.pinNames?.[p] ? ` (${d.pinNames[p]})` : ""}`);
    });
  }
  return out;
}

/**
 * Что проверить, когда таблица не сошлась: симптомы словами — неподключённые выводы, сгоревшее,
 * куда тянется выход в неверных строках. Как собрать — не говорит.
 */
export function diagnose(level: Level, def: ChipDef, rows: CheckRow[]): string[] {
  const out: string[] = [];
  const io = gateIo(level);
  const pinName = (n: number) => `${n} ${level.names[n - 1] || PIN_ROLES[level.roles[n - 1]].name}`;
  // Выводы, от которых внутри ничего не идёт
  const inside = new Set(def.nets.filter((n) => n.members.length).flatMap((n) => n.pins ?? []));
  const loose = [...io.inputs, ...io.outputs, io.vcc, io.gnd].sort((x, y) => x - y).filter((n) => !inside.has(n));
  if (loose.length) out.push(`${loose.length > 1 ? "Выводы" : "Вывод"} ${loose.map(pinName).join(", ")} ни к чему внутри не ${loose.length > 1 ? "подключены" : "подключён"}.`);
  const burnt = [...new Set(rows.flatMap((r) => r.burned))];
  if (burnt.length) out.push(`При проверке сгорело или перегружено сверх номинала: ${burnt.join(", ")}. Где-то течёт слишком большой ток — посмотрите, откуда и куда.`);
  const names = io.inputs.map((p) => level.names[p - 1] || `вывод ${p}`);
  const outNames = io.outputs.map((p) => level.names[p - 1] || `вывод ${p}`);
  const many = io.outputs.length > 1;
  const cases: string[] = [];
  for (const r of rows) {
    if (r.ok || r.burned.length) continue;
    const inputs = r.inputs.map((b, i) => `${names[i]} = ${b ? 1 : 0}`).join(", ");
    const when = r.step ? `шаге ${r.step} (${inputs})` : inputs;
    r.expected.forEach((want, k) => {
      if (r.each[k]) return;
      const v = formatSI(r.volts[k], "В");
      const what = many ? `выход ${outNames[k]}` : "выход";
      const got = r.floating[k] && level.drive
        ? `${what} под нагрузкой ${formatSI(level.drive, "А")} проседает до ${v}: он держит уровень, но слишком слабо — не хватает тока`
        : r.floating[k]
        ? `${what} ни за что не держится: куда тянет нагрузка, туда и идёт`
        : isLow(r.volts[k], CHECK_VOLTS)
          ? `${what} прижат к общему (${v})`
          : isHigh(r.volts[k], CHECK_VOLTS)
            ? `${what} у питания (${v})`
            : `${what} висит посередине (${v}) — его никто уверенно не тянет или тянут сразу в обе стороны`;
      cases.push(`${r.step ? "На" : "При"} ${when} ${many ? `на ${outNames[k]} ` : ""}нужен ${want ? "единица" : "ноль"}, а ${got}.`.replace("нужен единица", "нужна единица"));
    });
  }
  // У большой микросхемы неверных случаев может быть десятки: сначала — какие выходы и сколько раз
  if (cases.length > 6) {
    const wrong = io.outputs.map((_, k) => rows.filter((r) => !r.burned.length && !r.each[k]).length);
    const list = outNames.map((n, k) => (wrong[k] ? `${n} — в ${plural(wrong[k], "наборе", "наборах", "наборах")}` : "")).filter(Boolean);
    out.push(`Неверные выходы: ${list.join(", ")} (из ${rows.length} наборов). Первые случаи:`);
    out.push(...cases.slice(0, 4), `…и ещё ${cases.length - 4}.`);
  } else out.push(...cases);
  return out;
}

/** Строка таблицы для людей: «A=1 B=0 → 4,98 В». */
export const rowText = (r: CheckRow) => `${r.inputs.map((b) => (b ? 1 : 0)).join(" ")} → ${r.volts.map((v) => formatSI(v, "В")).join(", ")}`;

// ─── Модели проверенных микросхем ────────────────────────────────────────────

/** Уровень, из которого микросхема: «career:xor», «ref:xor» → уровень xor. */
export function chipLevel(defId: string): Level | undefined {
  const m = defId.match(/^(?:career|ref):(.+)$/);
  return m ? LEVELS.find((l) => l.id === m[1]) : undefined;
}

/**
 * Микросхемы для мастерской и песочницы: без учебных промежуточных и по одной на обозначение
 * (74LVC1G08 из И-НЕ и из ИЛИ-НЕ снаружи одинаковые — берётся первая).
 */
export function publicChips(defs: ChipDef[]): ChipDef[] {
  const seen = new Set<string>();
  return defs.filter((d) => {
    const level = chipLevel(d.id);
    if (level?.intermediate || (level && seen.has(d.name))) return false;
    seen.add(d.name);
    return true;
  });
}

/** Параметры моделей по описанию и его версии; null — микросхема не прошла, модели нет. */
const models = new Map<string, ChipModel | null>();
const measuring = new Set<string>();

/** Напряжения питания, при которых снимают параметры и ищут наименьшее рабочее, В — по убыванию. */
export const SUPPLY_STEPS = [5, 4, 3.3, 2.5, 2];

/**
 * Наименьшее питание, при котором работают все проверенные микросхемы внутри def (у каждой своя
 * модель со своим диапазоном), В; 0 — ограничений нет. Ниже него проверять сборку нет смысла.
 */
function innerVmin(def: ChipDef, scene: Scene): number {
  const s: Scene = { components: [], wires: [], chips: { ...(scene.chips ?? {}), ...(def.scene.chips ?? {}) } };
  let v = 0;
  for (const c of def.parts) {
    if (c.type !== "chip") continue;
    const d = s.chips![c.def] ?? chipsUsed({ components: [c], wires: [], chips: s.chips })[c.def];
    const m = d ? chipModel(d, s) : undefined;
    if (m) v = Math.max(v, m.vmin);
  }
  return v;
}

/**
 * Прогнать таблицу при питании от 5 В вниз, пока микросхема работает (и пока хватает внутренним);
 * вернуть строки при каждом рабочем напряжении, по убыванию. Пусто — не работает и при 5 В.
 */
export function supplySweep(def: ChipDef, level: Level, chips: Record<string, ChipDef>, first?: CheckRow[]): { volts: number; rows: CheckRow[] }[] {
  const out: { volts: number; rows: CheckRow[] }[] = [];
  const floor = innerVmin(def, { components: [], wires: [], chips });
  for (const volts of SUPPLY_STEPS) {
    if (volts < 0.95 * floor) break;
    const rows = volts === CHECK_VOLTS && first ? first : truthTable(def, level, chips, volts);
    if (!rows.every((r) => r.ok)) break;
    out.push({ volts, rows });
  }
  return out;
}

/**
 * Модель микросхемы из карьеры: прогнать её таблицу истинности по транзисторам (вложенные — уже
 * моделями) при питании от 5 В вниз, пока работает, и снять выходные и входные сопротивления и ток
 * покоя при каждом напряжении. Если не проходит и при 5 В, модели нет — такая микросхема считается
 * целиком, со всеми своими ошибками.
 */
export function characterize(def: ChipDef, scene: Scene): ChipModel | undefined {
  // Память (ПЗУ) — модель по даташиту: собирать её из деталей не нужно
  const mem = memoryModel(def);
  if (mem) return mem;
  const level = chipLevel(def.id);
  // Генератор моделью не описать: у него нет таблицы — считается целиком
  // Генератор и подавитель дребезга живут временем (RC) — модель без времени их не заменит
  // Компараторы и таймер сравнивают напряжения, а не логические уровни: только по транзисторам
  if (!level || def.pins !== level.roles.length || level.check === "osc" || level.check === "bounce" || level.check === "compare" || level.check === "timer" || level.check === "opamp" || level.check === "regulator" || level.check === "sram" || level.check === "dram") return undefined;
  const key = `${def.id}@${def.updatedAt}`;
  const known = models.get(key);
  if (known !== undefined) return known ?? undefined;
  if (measuring.has(key)) return undefined;
  measuring.add(key);
  let model: ChipModel | undefined;
  try {
    const sweep = supplySweep(def, level, { ...(scene.chips ?? {}), ...(def.scene.chips ?? {}) });
    if (sweep.length) {
      const io = gateIo(level);
      const chipsAll = { ...(scene.chips ?? {}), ...(def.scene.chips ?? {}) };
      const points = sweep.map((s) => pointFromRows(level, s.rows, s.volts, truthTable(def, level, chipsAll, s.volts, HEAVY_LOAD))).reverse();
      model = {
        inputs: io.inputs,
        outputs: io.outputs,
        vcc: io.vcc,
        gnd: io.gnd,
        // Схема с памятью: что хранит — из прошлого состояния (или по выходам), дальше — по seqNext
        logic: SEQUENTIAL.includes(level.func)
          ? (bits, prev) => seqOuts(level.func, seqNext(level.func, prev ? (prev.state ?? seqState(level.func, prev.outputs)) : 0, prev?.inputs, bits), bits)
          : (bits) => truth(level.func, bits),
        ...(zOutputs(level.func, io.inputs.map(() => false)) ? { z: (bits: boolean[]) => zOutputs(level.func, bits)! } : {}),
        ...(SEQUENTIAL.includes(level.func)
          ? { state: (bits: boolean[], prev?: ModelState) => seqNext(level.func, prev ? (prev.state ?? seqState(level.func, prev.outputs)) : 0, prev?.inputs, bits) }
          : {}),
        points,
        vmin: points[0].volts,
        vmax: 1.1 * CHECK_VOLTS,
        ...(def.id.startsWith("ref:") ? { absMax: level.absMax ?? REF_ABS_MAX } : {}),
        ...hysteresis(def, level, chipsAll),
      };
    }
  } finally {
    measuring.delete(key);
  }
  models.set(key, model ?? null);
  return model;
}

/** Пороги триггера Шмитта для модели — доли питания, снятые при 5 В. */
function hysteresis(def: ChipDef, level: Level, chips: Record<string, ChipDef>): { hyst?: [number, number] } {
  if (level.check !== "sweep") return {};
  const { up, down } = thresholds(def, level, chips);
  return up !== undefined && down !== undefined && up > down ? { hyst: [down / CHECK_VOLTS, up / CHECK_VOLTS] } : {};
}

/** Тяжёлая нагрузка для второго замера выхода, Ом: по двум замерам видно, как выход проседает под током. */
const HEAVY_LOAD = 1000;

/**
 * Параметры модели по строкам проверки при питании V (нагрузка тянула против нужного уровня) и по
 * тем же строкам с тяжёлой нагрузкой HEAVY_LOAD: выход — источник, U = U0 ∓ I·R. Два замера
 * отделяют «напряжение без нагрузки» от сопротивления: у насыщенного транзистора РТЛ ноль —
 * 0,05 В почти при любом токе, а не «резистор 1 кОм», как вышло бы по одному лёгкому замеру.
 */
export function pointFromRows(level: Level, rows: CheckRow[], V: number, heavy: CheckRow[]): ModelPoint {
  const io = gateIo(level);
  const R1 = loadOhms(level), R2 = HEAVY_LOAD;
  const avg = (xs: number[], empty: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : empty);
  const clamp = (r: number) => Math.min(MODEL_OFF, Math.max(0.5, r));
  const fit = (k: number, high: boolean) => {
    const pairs = rows.map((r, i) => [r, heavy[i]] as const).filter(([r]) => !r.z?.[k] && r.expected[k] === high);
    // Единица: нагрузка на общий, ток I = U/R, U = V − d − I·R. Ноль: к питанию, I = (V − U)/R, U = d + I·R
    const amps = (u: number, rl: number) => (high ? u : V - u) / rl;
    const rs = pairs.map(([a, b]) => {
      const i1 = amps(a.volts[k], R1), i2 = amps(b.volts[k], R2);
      return Math.abs(i2 - i1) > 1e-9 ? Math.abs(a.volts[k] - b.volts[k]) / Math.abs(i2 - i1) : MODEL_OFF;
    });
    const r = clamp(avg(rs, 10));
    const ds = pairs.map(([a]) => (high ? V - a.volts[k] - amps(a.volts[k], R1) * r : a.volts[k] - amps(a.volts[k], R1) * r));
    return { r, d: Math.min(V / 2, Math.max(0, avg(ds, 0))) };
  };
  const hi = io.outputs.map((_, k) => fit(k, true));
  const lo = io.outputs.map((_, k) => fit(k, false));
  const rIn = io.inputs.map((_, i) => {
    const amps = avg(rows.filter((r) => r.inputs[i]).map((r) => r.inAmps[i]), 0);
    return amps > 1e-9 ? clamp(V / amps) : MODEL_OFF;
  });
  // Ток покоя: от питания без токов входов (они тоже идут от «плюса» стенда)
  const iq = avg(rows.map((r) => Math.max(0, r.amps - r.inputs.reduce((sum, b, i) => sum + (b ? Math.max(0, r.inAmps[i]) : 0), 0))), 0);
  return { volts: V, rHigh: hi.map((x) => x.r), rLow: lo.map((x) => x.r), dHigh: hi.map((x) => x.d), dLow: lo.map((x) => x.d), rIn, iq };
}

setModelSource(characterize);
