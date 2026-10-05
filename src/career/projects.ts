/**
 * Проекты: устройства из уже открытых микросхем, как на настоящем столе, — не корпус, а плата с
 * питанием. Проверка — по самому столу: нажимает кнопку, ждёт, смотрит, что показывает индикатор.
 * Открываются, когда открыты все микросхемы набора.
 */

import type { Component, Scene } from "../model/types";
import { DISPLAY_SEGMENTS } from "../model/types";
import { Simulation, heatThreshold } from "../sim/simulation";
import { segmentCurrent } from "../parts/display";
import { formatSI } from "../sim/resistorCodes";
import { HOLE_BY_ID, holeLabel } from "../model/breadboard";
import { foreignContacts, traceNodes } from "../model/copper";
import { endpointNode, pinNode } from "../sim/nodes";
import { pinsOf } from "../parts";
import { resolveChip } from "../chips/registry";
import { free, noHurt, of, type Lesson, type LessonStep } from "./lessons";
import { SEGMENTS, type KitItem, type LogicFunc } from "./levels";
import { EEPROM_ID, PROM_ID, SRAM_ID, eepromWord, promWord } from "../chips/memory";

/** Две макетки рядом и блок питания 5 В: плюс и минус — на верхние шины обеих. */
function projectBench(id: string): Scene {
  return {
    components: [{ id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free(-26, -6) }],
    wires: [
      { id: "W1", a: { comp: "G1", pin: 0 }, b: { hole: "top-1" }, color: "#1b1d20" },
      { id: "W2", a: { comp: "G1", pin: 1 }, b: { hole: "top+1" }, color: "#c8261f" },
      { id: "W3", a: { hole: "top-25" }, b: { hole: "2:top-1" }, color: "#1b1d20" },
      { id: "W4", a: { hole: "top+25" }, b: { hole: "2:top+1" }, color: "#c8261f" },
    ],
    boards: [
      { id: "BB1", kind: "breadboard", x: 0, z: 0 },
      { id: "BB2", kind: "breadboard", x: 32, z: 0 },
    ],
    career: { lesson: id },
  };
}

/** Какую цифру показывает индикатор: сегменты с током больше 2 мА; -1 — не цифра (пусто, лишние сегменты). */
export function shownDigit(disp: Extract<Component, { type: "display" }>, sim: Simulation): number {
  const lit = DISPLAY_SEGMENTS.slice(0, 7).map((_, k) => (segmentCurrent(disp, sim, k) > 0.002 ? "1" : "0")).join("");
  return SEGMENTS.indexOf(lit);
}

/** Самый большой ток сегмента за прогон, А. */
const worstSegment = (disp: Extract<Component, { type: "display" }>, sim: Simulation) => Math.max(0, ...DISPLAY_SEGMENTS.map((_, k) => segmentCurrent(disp, sim, k)));

/** Расчёт стола шагами dt: что сгорело или перегружено. */
function runner(scene: Scene) {
  const sim = new Simulation(JSON.parse(JSON.stringify(scene)) as Scene);
  const hurt = new Set<string>();
  let peak = 0;
  const disp = of(sim.scene, "display")[0];
  const run = (seconds: number, dt = 0.005) => {
    for (let t = 0; t < seconds; t += dt) {
      for (const c of sim.step(dt)) hurt.add(c.id);
      if (disp) peak = Math.max(peak, worstSegment(disp, sim));
    }
    for (const c of sim.scene.components) {
      const limit = heatThreshold(c);
      if (limit && sim.overload(c) > limit) hurt.add(c.id);
    }
  };
  return { sim, run, hurt, disp, peak: () => peak };
}

/**
 * Входы микросхем, которые висят в воздухе: в их цепи (провода, дорожки, перемычки, полосы макетки)
 * нет ничего, кроме таких же входов, — ни выхода, ни питания, ни резистора, ни кнопки. Вход КМОП
 * тогда уходит к середине питания, и что выйдет — не угадать; модель этого не всегда покажет.
 */
export function floatingInputs(scene: Scene): string[] {
  const find = netOf(scene);
  const driven = new Set<string>();
  const inputs: [string, string][] = [];
  // Вывод питания или общего, к которому ничего не подведено: микросхема без него иногда «работает»
  // через защитные диоды входов, но как попало
  const power: [string, string][] = [];
  const count = new Map<string, number>();
  for (const c of scene.components) {
    const def = c.type === "chip" ? resolveChip(scene, c.def) : undefined;
    for (let p = 0; p < pinsOf(c); p++) {
      const node = find(pinNode(c, p));
      count.set(node, (count.get(node) ?? 0) + 1);
      const role = def?.pinRoles?.[p];
      if (role === "in") inputs.push([node, `${c.id}.${p + 1}${def?.pinNames?.[p] ? ` (${def.pinNames[p]})` : ""}`]);
      else if (role !== "nc") driven.add(node);
      if (role === "vcc" || role === "gnd") power.push([node, `${c.id}.${p + 1} (${role === "vcc" ? "питание" : "общий"})`]);
    }
  }
  return [...inputs.filter(([n]) => !driven.has(n)), ...power.filter(([n]) => count.get(n) === 1)].map(([, name]) => name);
}

/** Объединение узлов в цепи: провода и дорожки (без обрывов). */
export function netOf(scene: Scene): (node: string) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => parent.set(find(a), find(b));
  for (const w of scene.wires) if (!w.fault) join(endpointNode(scene, w.a), endpointNode(scene, w.b));
  for (const t of scene.traces ?? []) {
    if (!HOLE_BY_ID.has(t.a) || !HOLE_BY_ID.has(t.b) || t.fault) continue;
    const [a, b] = traceNodes(t);
    join(a, b);
  }
  return find;
}

/**
 * Выходы, которые выводят на одну цепь разом: у цепи может быть только один говорящий — два
 * включённых выхода спорят (у памяти — пока у обеих открыт O̅E̅), даже если сейчас их уровни
 * совпали. Смотрит по установившемуся расчёту.
 */
export function busFights(sim: Simulation, find: (node: string) => string): string[] {
  const by = new Map<string, string[]>();
  for (const c of sim.scene.components) {
    if (c.type !== "chip") continue;
    const model = sim.modelOf(c.id);
    if (!model) continue;
    const def = resolveChip(sim.scene, c.def);
    const zm = sim.junction.get(`${c.id}:zm`) ?? 0;
    model.outputs.forEach((p, k) => {
      if (zm & (1 << k)) return;
      const n = find(pinNode(c, p - 1));
      by.set(n, [...(by.get(n) ?? []), `${c.id}.${p}${def?.pinNames?.[p - 1] ? ` (${def.pinNames[p - 1]})` : ""}`]);
    });
  }
  return [...by.values()].filter((xs) => xs.length > 1).map((xs) => xs.join(" и "));
}

/** Где светодиод по оси X стола: по отверстию первого вывода или по месту на столе. */
function ledX(c: Component): number {
  const p = c.placement;
  if (p.mode === "free") return p.x;
  return HOLE_BY_ID.get(p.holes[0])?.x ?? 0;
}

/** Шаги «сегменты горят в меру» и «ничего не сгорело». */
function displaySteps(peak: number, hurt: Set<string>): LessonStep[] {
  return [
    { text: `Сегменты горят в меру: самый яркий — 3–20 мА (по даташиту индикатора — до 30 мА) — сейчас ${formatSI(peak, "А")}`, ok: peak >= 0.003 && peak <= 0.02 },
    noHurt([...hurt]),
  ];
}

/** Сколько раз проверка нажимает кнопку: хватает, чтобы пройти 9 → 0 с любой начальной цифры. */
const PRESSES = 11;

// ─── ЦАП: вход кода выведен на макетку, выход — на столбец 30 под нагрузкой ────

/** Куда выведены входы кода (нижняя половина BB1, ряд j) и где выход ЦАП (верхняя, ряд a). */
export const DAC_PINS = { ser: "j2", srclk: "j4", rclk: "j6", out: "a30" };
/** Нагрузка на выходе ЦАП, Ом: без буфера лестница R-2R (10 кОм) под ней просядет. */
const DAC_LOAD = 10_000;

/** Стол ЦАП: тумблер SER и кнопки SRCLK, RCLK без дребезга (к +5 В, подтяжка 10 кОм к общему) и нагрузка на выходе. */
function dacBench(id: string): Scene {
  const s = projectBench(id);
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  const res = (rid: string, ohms: number, x: number, z: number): Component => ({ id: rid, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free(x, z), stock: true });
  const inputs: [string, "switch" | "button", string, number][] = [["SA1", "switch", DAC_PINS.ser, -8], ["SB1", "button", DAC_PINS.srclk, 0], ["SB2", "button", DAC_PINS.rclk, 8]];
  inputs.forEach(([cid, type, hole, x], i) => {
    s.components.push(
      (type === "switch" ? { id: cid, type, closed: false, placement: free(x, 22), stock: true } : { id: cid, type, placement: free(x, 22), stock: true }) as Component,
      res(`RS${i + 1}`, 10_000, x, 30),
    );
    s.wires.push(
      { id: `WI${i}a`, a: plus, b: { comp: cid, pin: 0 }, color: "#c8261f" },
      { id: `WI${i}b`, a: { comp: cid, pin: 1 }, b: { hole }, color: "#e3b21c" },
      { id: `WI${i}c`, a: { comp: cid, pin: 1 }, b: { comp: `RS${i + 1}`, pin: 0 }, color: "#e3b21c" },
      { id: `WI${i}d`, a: { comp: `RS${i + 1}`, pin: 1 }, b: minus, color: "#1b1d20" },
    );
  });
  s.components.push(res("RL", DAC_LOAD, 24, -18));
  s.wires.push({ id: "WL1", a: { hole: DAC_PINS.out }, b: { comp: "RL", pin: 0 }, color: "#2f9e5a" }, { id: "WL2", a: { comp: "RL", pin: 1 }, b: minus, color: "#1b1d20" });
  return s;
}

/** Коды проверки ЦАП: до 170 (3,3 В) — выше LM358 при 5 В не достаёт (по даташиту до питания − 1,5 В). */
export const DAC_CODES = [0, 1, 85, 128, 170];

/** Прогнать ЦАП: вдвинуть коды старшим битом вперёд, защёлкнуть и измерить выход. */
export function dacRun(scene: Scene) {
  const r = runner(scene);
  const ser = r.sim.scene.components.find((c) => c.id === "SA1") as Extract<Component, { type: "switch" }> | undefined;
  const g1 = r.sim.scene.components.find((c) => c.id === "G1")!;
  const out = () => (r.sim.solution.voltage.get(HOLE_BY_ID.get(DAC_PINS.out)!.node) ?? 0) - (r.sim.solution.voltage.get(pinNode(g1, 0)) ?? 0);
  const press = (id: string) => {
    r.sim.held.add(id);
    r.run(0.02);
    r.sim.held.delete(id);
    r.run(0.02);
  };
  r.run(0.2);
  const rows: { code: number; v: number; drift: number }[] = [];
  let last = out();
  for (const code of DAC_CODES) {
    let drift = 0;
    for (let bit = 7; bit >= 0; bit--) {
      if (ser) ser.closed = !!(code & (1 << bit));
      r.run(0.02);
      press("SB1");
      drift = Math.max(drift, Math.abs(out() - last));
    }
    press("SB2");
    r.run(0.03);
    last = out();
    rows.push({ code, v: last, drift });
  }
  return { rows, hurt: r.hurt };
}

// ─── АЦП последовательного счёта: вход — источник G2, сброс — кнопка ─────────

/** Куда выведены вход АЦП и кнопка сброса (нижняя половина BB1, ряд j). */
export const ADC_PINS = { vin: "j2", reset: "j4" };

/** Стол вольтметра: регулируемый источник G2 (измеряемое напряжение) и кнопка сброса SB1 без дребезга с подтяжкой. */
function adcBench(id: string): Scene {
  const s = projectBench(id);
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  s.components.push(
    { id: "G2", type: "psu", volts: 1, amps: 0.1, on: true, placement: free(-26, 18), stock: true } as Component,
    { id: "SB1", type: "button", placement: free(0, 22), stock: true } as Component,
    { id: "RS1", type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free(0, 30), stock: true },
  );
  s.wires.push(
    { id: "WV1", a: { comp: "G2", pin: 1 }, b: { hole: ADC_PINS.vin }, color: "#e3b21c" },
    { id: "WV2", a: { comp: "G2", pin: 0 }, b: minus, color: "#1b1d20" },
    { id: "WR1", a: plus, b: { comp: "SB1", pin: 0 }, color: "#c8261f" },
    { id: "WR2", a: { comp: "SB1", pin: 1 }, b: { hole: ADC_PINS.reset }, color: "#2f9e5a" },
    { id: "WR3", a: { comp: "SB1", pin: 1 }, b: { comp: "RS1", pin: 0 }, color: "#2f9e5a" },
    { id: "WR4", a: { comp: "RS1", pin: 1 }, b: minus, color: "#1b1d20" },
  );
  return s;
}

/** Ступенька АЦП, В: 4 бита от 5 В. */
export const ADC_LSB = 5 / 16;
/** Входные напряжения проверки (не у границ ступенек); после большого — меньшее: без сброса не сработает. */
export const ADC_POINTS = [1.0, 2.7, 0.5];

/** Прогнать вольтметр: на каждое напряжение — сброс кнопкой, 0,7 с счёта, цифра на индикаторе. */
export function adcRun(scene: Scene) {
  const r = runner(scene);
  const g2 = r.sim.scene.components.find((c) => c.id === "G2") as Extract<Component, { type: "psu" }> | undefined;
  r.run(0.3);
  const rows = ADC_POINTS.map((vin) => {
    if (g2) g2.volts = vin;
    r.run(0.05);
    r.sim.held.add("SB1");
    r.run(0.05);
    r.sim.held.delete("SB1");
    r.run(0.7);
    return { vin, digit: r.disp ? shownDigit(r.disp, r.sim) : -1 };
  });
  return { rows, peak: r.peak(), hurt: r.hurt };
}

// ─── Порог с гистерезисом: вход — источник G2, выход — столбец 30 ─────────────

/** Куда выведены вход (нижняя половина, ряд j) и где выход (верхняя, ряд a). */
export const HYST_PINS = { vin: "j2", out: "a30" };
/** Пороги: вверх — включение, вниз — выключение, В; допуск ± 0,15 В. */
export const HYST = { on: 3, off: 2, tol: 0.15 };

/** Стол: регулируемый источник G2 (0–5 В) на столбце 2. */
function hystBench(id: string): Scene {
  const s = projectBench(id);
  s.components.push({ id: "G2", type: "psu", volts: 1, amps: 0.1, on: true, placement: free(-26, 18), stock: true } as Component);
  s.wires.push(
    { id: "WV1", a: { comp: "G2", pin: 1 }, b: { hole: HYST_PINS.vin }, color: "#e3b21c" },
    { id: "WV2", a: { comp: "G2", pin: 0 }, b: { comp: "G1", pin: 0 }, color: "#1b1d20" },
  );
  return s;
}

/** Вход плавно от 1 до 4 В и обратно (шаг 50 мВ): где выход переключился и какие уровни. */
export function hystRun(scene: Scene) {
  const r = runner(scene);
  const g2 = r.sim.scene.components.find((c) => c.id === "G2") as Extract<Component, { type: "psu" }> | undefined;
  const g1 = r.sim.scene.components.find((c) => c.id === "G1")!;
  const out = () => (r.sim.solution.voltage.get(HOLE_BY_ID.get(HYST_PINS.out)!.node) ?? 0) - (r.sim.solution.voltage.get(pinNode(g1, 0)) ?? 0);
  const points: number[] = [];
  for (let v = 1; v <= 4.001; v += 0.05) points.push(v);
  const sweep = [...points, ...points.slice().reverse()];
  let up: number | undefined, down: number | undefined;
  let hi = 0, lo = 5;
  if (g2) g2.volts = sweep[0];
  r.run(0.1);
  let prev = out() > 2.5;
  sweep.forEach((v, i) => {
    if (g2) g2.volts = v;
    r.run(0.02);
    const o = out();
    const now = o > 2.5;
    if (now) hi = Math.max(hi, o);
    else lo = Math.min(lo, o);
    const rising = i < points.length;
    if (now !== prev) {
      if (rising && now && up === undefined) up = v;
      if (!rising && !now && down === undefined) down = v;
    }
    prev = now;
  });
  return { up, down, hi, lo, hurt: r.hurt };
}

/** АЦП последовательного приближения: вход — G2 (как у порога), индикатор; цифры для проверки. */
export const SAR_POINTS = [1.0, 2.7, 0.5];

/** На каждое напряжение — 1 с (преобразование идёт само, ≈ 0,4 с на одно), цифра на индикаторе. */
export function sarRun(scene: Scene) {
  const r = runner(scene);
  const g2 = r.sim.scene.components.find((c) => c.id === "G2") as Extract<Component, { type: "psu" }> | undefined;
  const rows = SAR_POINTS.map((vin) => {
    if (g2) g2.volts = vin;
    r.run(1);
    return { vin, digit: r.disp ? shownDigit(r.disp, r.sim) : -1 };
  });
  return { rows, peak: r.peak(), hurt: r.hurt };
}

// ─── Процессор: плата под SMD; питание, такт, сброс и выход — на площадках у края ────

/** Площадки у ближнего края платы: общий, +5 В, кнопки такта и сброса, выходы OUT0…OUT3. */
export const CPU_PINS = { gnd: "s:J1", vcc: "s:J2", clk: "s:J3", rst: "s:J5", out: ["s:J6", "s:J7", "s:J8", "s:J9"] };

/**
 * Команды процессора — байт ПЗУ: старшие четыре бита — что делать, младшие — число N.
 * Бит 7 — переход на N, 6 — вывести A, 5 — записать в A, 4 — в A пойдёт A + N (иначе N).
 */
export const CPU_OPS = { jmp: 0x80, out: 0x40, wa: 0x20, add: 0x10 };
/**
 * Программа проверки — каждый бит команды проявляется отдельно: загрузка числа при A ≠ 0, сложение
 * без вывода и с переносом за 15, вывод без записи и вместе с записью (выводится прежнее A), переход.
 * И каждый провод данных хоть раз несёт единицу: на выходе бывают 15 и нечётные, прямо в A грузятся
 * 10 и 5 (все четыре бита), складываются 10 + 5, 15 + 1 и 0 + 14 (все биты A, N и суммы), переход —
 * на 15 (все четыре бита загрузки счётчика). 0: A ← 10; 1: A ← A + 5; 2: вывести A, A ← A + 1 (= 0);
 * 3: A ← A + 14; 4: вывести A, A ← 5; 5: на 15; 15: вывести A, на 1.
 */
export const CPU_PROGRAM = [0x2a, 0x35, 0x71, 0x3e, 0x65, 0x8f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xc1];

/**
 * Что будет на выходе после каждого такта (от сброса): все регистры меняются разом по фронту,
 * каждый по тому, что было до фронта, — так и работает схема с общим тактом.
 */
export function cpuEmulate(rom: number[], clocks: number): number[] {
  let pc = 0, a = 0, out = 0;
  const outs: number[] = [];
  for (let i = 0; i < clocks; i++) {
    const w = rom[pc] ?? 0, n = w & 15;
    const next = w & CPU_OPS.add ? (a + n) & 15 : n;
    if (w & CPU_OPS.out) out = a;
    if (w & CPU_OPS.wa) a = next;
    pc = w & CPU_OPS.jmp ? n : (pc + 1) & 15;
    outs.push(out);
  }
  return outs;
}

// ─── Процессор 8 бит: два 4-битных среза, два ПЗУ — число и команда ─────────────

/** Площадки 8-битного: питание, CLK, RST — как у 4-битного; выходы OUT0…OUT7 — J6…J13. */
export const CPU8_OUT = ["s:J6", "s:J7", "s:J8", "s:J9", "s:J10", "s:J11", "s:J12", "s:J13"];
/** Плата 8-битного, шагов: пятнадцать микросхем и восемь светодиодов. */
export const CPU8_BOARD = { cols: 52, rows: 40 };

/**
 * Программа 8-битного: команда — 12 бит в двух ПЗУ по одному адресу. ПЗУ «число» — N (8 бит),
 * ПЗУ «команда» — биты 7…4 как у 4-битного (переход, вывод, запись в A, A + N), младшие — 0.
 * Переход — на N mod 16. Каждый провод данных хоть раз несёт единицу: в A грузятся A5 и 5A (все
 * восемь бит), складываются A5 + 5A = FF, FF + 1 = 0 (перенос через оба среза и за 255), 0 + FE;
 * на выходе FF; переход — на 15 (все биты загрузки счётчика).
 * 0: A ← A5; 1: A ← A + 5A; 2: вывести A, A ← A + 1; 3: A ← A + FE; 4: вывести A, A ← 5A; 5: на 15;
 * 15: вывести A, на 1.
 */
export const CPU8_PROGRAM = {
  n: [0xa5, 0x5a, 0x01, 0xfe, 0x5a, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01],
  op: [0x20, 0x30, 0x70, 0x30, 0x60, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xc0],
};

/** Что на выходе 8-битного после каждого такта (от сброса). */
export function cpu8Emulate(prog: { n: number[]; op: number[] }, clocks: number): number[] {
  let pc = 0, a = 0, out = 0;
  const outs: number[] = [];
  for (let i = 0; i < clocks; i++) {
    const w = prog.op[pc] ?? 0, n = prog.n[pc] ?? 0;
    const next = w & CPU_OPS.add ? (a + n) & 255 : n;
    if (w & CPU_OPS.out) out = a;
    if (w & CPU_OPS.wa) a = next;
    pc = w & CPU_OPS.jmp ? n & 15 : (pc + 1) & 15;
    outs.push(out);
  }
  return outs;
}

// ─── ISA «М2»: код операции в старшем байте слова, число N — в младшем ─────────────

/**
 * Коды операций М2 (биты 15…12 слова; в ПЗУ команд — старшая тетрада байта, младшая — 0):
 * NOP; LDI n: A ← n; LD n: A ← RAM[n]; ST n: RAM[n] ← A; ADDI n, SUBI n, ADD n, SUB n — A ← A ± n
 * (или ± RAM[n]), ставят флаг C (перенос; у вычитания — «не было заёма»); OUT: выход ← A; JMP n;
 * JC n — переход, если C = 1; JZ, JNZ n — если A = 0 (A ≠ 0) сейчас: отдельного флага нуля нет,
 * как у многих аккумуляторных машин; HLT — счётчик команд стоит.
 */
export const M2 = { NOP: 0, LDI: 1, LD: 2, ST: 3, ADDI: 4, SUBI: 5, ADD: 6, SUB: 7, OUT: 8, JMP: 9, JC: 10, JZ: 11, JNZ: 12, HLT: 15 } as const;

/** Что на выходе машины М2 после каждого такта (от сброса): op — байты кодов, n — числа; bits — разрядность, pcBits — счётчика команд. */
export function m2Emulate(prog: { op: number[]; n: number[] }, clocks: number, bits = 8, pcBits = 4): number[] {
  const mod = 2 ** bits, pcMod = 2 ** pcBits;
  const ram = new Map<number, number>();
  let pc = 0, a = 0, out = 0, c = false;
  const outs: number[] = [];
  for (let i = 0; i < clocks; i++) {
    const code = (prog.op[pc] ?? 0) >> 4, n = prog.n[pc] ?? 0;
    let next = (pc + 1) % pcMod;
    const arith = (b: number, sub: boolean) => {
      const r = sub ? a + (mod - 1 - b) + 1 : a + b;
      c = r >= mod;
      a = r % mod;
    };
    switch (code) {
      case M2.LDI: a = n; break;
      case M2.LD: a = ram.get(n) ?? 0; break;
      case M2.ST: ram.set(n, a); break;
      case M2.ADDI: arith(n, false); break;
      case M2.SUBI: arith(n, true); break;
      case M2.ADD: arith(ram.get(n) ?? 0, false); break;
      case M2.SUB: arith(ram.get(n) ?? 0, true); break;
      case M2.OUT: out = a; break;
      case M2.JMP: next = n % pcMod; break;
      case M2.JC: if (c) next = n % pcMod; break;
      case M2.JZ: if (a === 0) next = n % pcMod; break;
      case M2.JNZ: if (a !== 0) next = n % pcMod; break;
      case M2.HLT: next = pc; break;
    }
    pc = next;
    outs.push(out);
  }
  return outs;
}

/**
 * Программа «Декодера команд»: каждая из пяти команд и пустая NOP с ненулевым N (её ошибку видно
 * на выходе); у OUT тоже N ≠ 0 — переход или запись в A по ошибке видны. 0: LDI A5; 1: ADDI 5A (FF);
 * 2: OUT; 3: ADDI 01 (00 — перенос теряется); 4: OUT; 5: ADDI FE; 6: NOP; 7: OUT; 8: LDI 5A; 9: OUT;
 * 10: JMP 1; дальше — NOP.
 */
export const DEC_PROGRAM = {
  op: [0x10, 0x40, 0x80, 0x40, 0x80, 0x40, 0x00, 0x80, 0x10, 0x80, 0x90, 0, 0, 0, 0, 0],
  n: [0xa5, 0x5a, 0x00, 0x01, 0x0d, 0xfe, 0x33, 0x00, 0x5a, 0x00, 0x01, 0, 0, 0, 0, 0],
};

/** Проверка «Декодера команд»: программа в двух ПЗУ, EEPROM на месте, потом шаги процессора (микрокод — какой угодно). */
function decCheck(scene: Scene): LessonStep[] {
  const roms = scene.components.filter((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === PROM_ID);
  const hex = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
  const words = (c: (typeof roms)[number]) => DEC_PROGRAM.op.map((_, a) => promWord(c.data, a));
  const is = (c: (typeof roms)[number], want: number[]) => want.every((w, a) => words(c)[a] === w);
  if (!scene.components.some((c) => c.type === "chip" && c.def === EEPROM_ID)) return [{ text: "На плате EEPROM AT28C256 — декодер команд", ok: false }];
  if (roms.length < 2) return [{ text: "На плате два ПЗУ 74S288: одно — коды операций, другое — числа", ok: false }];
  const opRom = roms.find((c) => is(c, DEC_PROGRAM.op));
  const nRom = roms.find((c) => c !== opRom && is(c, DEC_PROGRAM.n));
  if (!nRom || !opRom) {
    const show = (c: (typeof roms)[number]) => `${c.id}: ${words(c).map((w, a) => `${a} → ${hex(w)}`).join(", ")}`;
    return [{ text: `В ПЗУ — программа из описания (${!opRom ? "не нашлось ПЗУ с кодами операций" : "не нашлось ПЗУ с числами"}): сейчас ${roms.map(show).join("; ")}`, ok: false }];
  }
  return [{ text: "В ПЗУ — программа из описания", ok: true }, ...cpuSteps(scene, CPU8_OUT, (k) => m2Emulate(DEC_PROGRAM, k), hex)];
}

/**
 * Программа «Переноса и условного перехода»: цикл счёта вниз с выходом по заёму, перенос из ADDI,
 * C не меняется от LDI и NOP, JC и в ту, и в другую сторону, HLT с N ≠ 0 в конце.
 * 0: LDI 02; 1: OUT; 2: SUBI 01; 3: JC 1 — выведет 2, 1, 0, потом A = FF, C = 0; 4: OUT (FF);
 * 5: ADDI 01 (00, C = 1); 6: LDI 5A; 7: JC 9 (C осталась); 8: HLT; 9: SUBI A5 (B5, заём — C = 0);
 * 10: OUT; 11: NOP; 12: JC 0 (не переходит); 13: ADDI 4B (00, C = 1); 14: OUT; 15: HLT.
 */
export const FLAGS_PROGRAM = {
  op: [0x10, 0x80, 0x50, 0xa0, 0x80, 0x40, 0x10, 0xa0, 0xf0, 0x50, 0x80, 0x00, 0xa0, 0x40, 0x80, 0xf0],
  n: [0x02, 0x00, 0x01, 0x01, 0x00, 0x01, 0x5a, 0x09, 0x00, 0xa5, 0x00, 0x33, 0x00, 0x4b, 0x0e, 0x02],
};

/** Проверка «Переноса и условного перехода»: как у «Декодера», программа — своя. */
function flagsCheck(scene: Scene): LessonStep[] {
  const roms = scene.components.filter((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === PROM_ID);
  const hex = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
  const words = (c: (typeof roms)[number]) => FLAGS_PROGRAM.op.map((_, a) => promWord(c.data, a));
  const is = (c: (typeof roms)[number], want: number[]) => want.every((w, a) => words(c)[a] === w);
  if (!scene.components.some((c) => c.type === "chip" && c.def === EEPROM_ID)) return [{ text: "На плате EEPROM AT28C256 — декодер команд", ok: false }];
  if (roms.length < 2) return [{ text: "На плате два ПЗУ 74S288: одно — коды операций, другое — числа", ok: false }];
  const opRom = roms.find((c) => is(c, FLAGS_PROGRAM.op));
  const nRom = roms.find((c) => c !== opRom && is(c, FLAGS_PROGRAM.n));
  if (!nRom || !opRom) {
    const show = (c: (typeof roms)[number]) => `${c.id}: ${words(c).map((w, a) => `${a} → ${hex(w)}`).join(", ")}`;
    return [{ text: `В ПЗУ — программа из описания (${!opRom ? "не нашлось ПЗУ с кодами операций" : "не нашлось ПЗУ с числами"}): сейчас ${roms.map(show).join("; ")}`, ok: false }];
  }
  return [{ text: "В ПЗУ — программа из описания", ok: true }, ...cpuSteps(scene, CPU8_OUT, (k) => m2Emulate(FLAGS_PROGRAM, k), hex)];
}

/**
 * Программа «Памяти и проверки на ноль»: в ОЗУ кладутся 5A и A5 по адресам A5 и 5A (каждый бит
 * данных и адреса — и ноль, и единица), читаются LD, ADD, SUB; JZ и JNZ — и переходят, и нет.
 * 0: LDI 5A; 1: ST A5; 2: LDI A5; 3: ST 5A; 4: LD A5 (5A); 5: ADD 5A (FF); 6: OUT; 7: SUB A5 (A5);
 * 8: OUT; 9: SUBI A5 (00); 10: JZ 12; 11: JNZ 0; 12: OUT; 13: JNZ 15 (не переходит); 14: ADDI 01;
 * 15: JNZ 6 — второй круг: выведет 01, A7, потом JZ не перейдёт, JNZ 0 — с начала.
 */
export const MEM_PROGRAM = {
  op: [0x10, 0x30, 0x10, 0x30, 0x20, 0x60, 0x80, 0x70, 0x80, 0x50, 0xb0, 0xc0, 0x80, 0xc0, 0x40, 0xc0],
  n: [0x5a, 0xa5, 0xa5, 0x5a, 0xa5, 0x5a, 0x00, 0xa5, 0x00, 0xa5, 0x0c, 0x00, 0x00, 0x0f, 0x01, 0x06],
};
/** Чем проверка заполняет ОЗУ после включения: не 5A и не A5 — незаписанная ячейка видна. */
export const MEM_FILL = 0x3c;

/** Проверка «Памяти и проверки на ноль». */
function memCheck(scene: Scene): LessonStep[] {
  const roms = scene.components.filter((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === PROM_ID);
  const hex = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
  const words = (c: (typeof roms)[number]) => MEM_PROGRAM.op.map((_, a) => promWord(c.data, a));
  const is = (c: (typeof roms)[number], want: number[]) => want.every((w, a) => words(c)[a] === w);
  if (!scene.components.some((c) => c.type === "chip" && c.def === EEPROM_ID)) return [{ text: "На плате EEPROM AT28C256 — декодер команд", ok: false }];
  if (!scene.components.some((c) => c.type === "chip" && c.def === SRAM_ID)) return [{ text: "На плате ОЗУ HM62256B — память данных", ok: false }];
  if (roms.length < 2) return [{ text: "На плате два ПЗУ 74S288: одно — коды операций, другое — числа", ok: false }];
  const opRom = roms.find((c) => is(c, MEM_PROGRAM.op));
  const nRom = roms.find((c) => c !== opRom && is(c, MEM_PROGRAM.n));
  if (!nRom || !opRom) {
    const show = (c: (typeof roms)[number]) => `${c.id}: ${words(c).map((w, a) => `${a} → ${hex(w)}`).join(", ")}`;
    return [{ text: `В ПЗУ — программа из описания (${!opRom ? "не нашлось ПЗУ с кодами операций" : "не нашлось ПЗУ с числами"}): сейчас ${roms.map(show).join("; ")}`, ok: false }];
  }
  return [{ text: "В ПЗУ — программа из описания", ok: true }, ...cpuSteps(scene, CPU8_OUT, (k) => m2Emulate(MEM_PROGRAM, k), hex, MEM_FILL)];
}

// ─── Процессор 32 бит: восемь модулей «Срез», число N — 4 байта в четырёх ПЗУ ─────

/** Выход OUT0…OUT31 — площадки J6…J37. */
export const CPU32_OUT = Array.from({ length: 32 }, (_, k) => `s:J${6 + k}`);
/** Плата 32-битного, шагов: восемь модулей на разъёмах, пять ПЗУ и 32 вывода у края. */
export const CPU32_BOARD = { cols: 96, rows: 56 };

/**
 * Программа 32-битного — та же, что у 8-битного, только числа 32-битные: в A грузятся A5A5A5A5 и
 * 5A5A5A5A (каждый бит — и ноль, и единица), A5A5A5A5 + 5A5A5A5A = FFFFFFFF, + 1 — перенос через все
 * 32 разряда и восемь модулей, + FFFFFFFE. Команды — как у 8-битного.
 */
export const CPU32_PROGRAM = {
  n: [0xa5a5a5a5, 0x5a5a5a5a, 0x01, 0xfffffffe, 0x5a5a5a5a, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01],
  op: CPU8_PROGRAM.op,
};
/** Байт k числа N по адресам — что лежит в k-м ПЗУ чисел. */
export const cpu32Byte = (k: number) => CPU32_PROGRAM.n.map((w) => Math.floor(w / 2 ** (8 * k)) % 256);

/** Что на выходе 32-битного после каждого такта (от сброса). */
export function cpu32Emulate(prog: { n: number[]; op: number[] }, clocks: number): number[] {
  let pc = 0, a = 0, out = 0;
  const outs: number[] = [];
  for (let i = 0; i < clocks; i++) {
    const w = prog.op[pc] ?? 0, n = prog.n[pc] ?? 0;
    const next = w & CPU_OPS.add ? (a + n) % 2 ** 32 : n;
    if (w & CPU_OPS.out) out = a;
    if (w & CPU_OPS.wa) a = next;
    pc = w & CPU_OPS.jmp ? n % 16 : (pc + 1) & 15;
    outs.push(out);
  }
  return outs;
}

/** Проверка 32-битного: пять ПЗУ — команды и четыре байта числа, потом шаги процессора. */
function cpu32Check(scene: Scene): LessonStep[] {
  const roms = scene.components.filter((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === PROM_ID);
  const hex2 = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
  const words = (c: (typeof roms)[number]) => CPU32_PROGRAM.op.map((_, a) => promWord(c.data, a));
  const want: [string, number[]][] = [["команды", CPU32_PROGRAM.op], ...[0, 1, 2, 3].map((k): [string, number[]] => [`байт ${k} числа`, cpu32Byte(k)])];
  if (roms.length < 5) return [{ text: `На столе пять ПЗУ 74S288: команды и четыре байта числа — сейчас ${roms.length}`, ok: false }];
  // Каждому содержимому — своё ПЗУ (у байтов 1…3 содержимое одинаковое: годится любое из них)
  const free = [...roms];
  const lost = want.filter(([, w]) => {
    const i = free.findIndex((c) => w.every((x, a) => words(c)[a] === x));
    if (i < 0) return true;
    free.splice(i, 1);
    return false;
  });
  if (lost.length) {
    const show = (c: (typeof roms)[number]) => `${c.id}: ${words(c).map(hex2).join(" ")}`;
    return [{ text: `В ПЗУ — программа из описания (не нашлось: ${lost.map(([l]) => l).join(", ")}): сейчас ${roms.map(show).join("; ")}`, ok: false }];
  }
  const hex = (w: number) => w.toString(16).toUpperCase().padStart(8, "0");
  return [{ text: "В ПЗУ — программа из описания", ok: true }, ...cpuSteps(scene, CPU32_OUT, (k) => cpu32Emulate(CPU32_PROGRAM, k), hex)];
}

/** Проверка 8-битного (из микросхем или из модулей): программа в двух ПЗУ, потом шаги процессора. */
function cpu8Check(scene: Scene): LessonStep[] {
  const roms = scene.components.filter((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === PROM_ID);
  const hex = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
  const words = (c: (typeof roms)[number]) => CPU8_PROGRAM.n.map((_, a) => promWord(c.data, a));
  const is = (c: (typeof roms)[number], want: number[]) => want.every((w, a) => words(c)[a] === w);
  const nRom = roms.find((c) => is(c, CPU8_PROGRAM.n));
  const opRom = roms.find((c) => c !== nRom && is(c, CPU8_PROGRAM.op));
  if (roms.length < 2) return [{ text: "На столе два ПЗУ 74S288: одно — числа, другое — команды", ok: false }];
  if (!nRom || !opRom) {
    const show = (c: (typeof roms)[number]) => `${c.id}: ${words(c).map((w, a) => `${a} → ${hex(w)}`).join(", ")}`;
    return [{ text: `В ПЗУ — программа из описания (${!nRom ? "не нашлось ПЗУ с числами" : "не нашлось ПЗУ с командами"}): сейчас ${roms.map(show).join("; ")}`, ok: false }];
  }
  return [{ text: "В ПЗУ — программа из описания", ok: true }, ...cpuSteps(scene, CPU8_OUT, (k) => cpu8Emulate(CPU8_PROGRAM, k), hex)];
}

/** Плата процессора под SMD, двусторонняя, шагов 2,54 мм: площадки для проводов J1…J35 — вдоль ближнего края. */
export const CPU_BOARD = { cols: 36, rows: 26 };

/**
 * Стол процессора: двусторонняя плата под SMD (микросхемы в SOIC, соединения — дорожками сверху,
 * где не развести — снизу, через переходы). Питание и кнопки CLK, RST без дребезга (к +5 В, подтяжка 10 кОм к общему) — на
 * площадках у края: J1 — общий, J2 — +5 В.
 */
function cpuBench(id: string, board = CPU_BOARD): Scene {
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  // Блок питания — слева от платы, кнопки — перед ней
  const left = -board.cols / 2, near = board.rows / 2;
  const s: Scene = {
    components: [{ id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free(left - 16, -4) }],
    wires: [
      { id: "W1", a: minus, b: { hole: CPU_PINS.gnd }, color: "#1b1d20" },
      { id: "W2", a: plus, b: { hole: CPU_PINS.vcc }, color: "#c8261f" },
    ],
    boards: [{ id: "S1", kind: "smd", x: 0, z: 0, cols: board.cols, rows: board.rows, seats: [], layers: 2 }],
    career: { lesson: id },
  };
  ([["SB1", CPU_PINS.clk, left + 6], ["SB2", CPU_PINS.rst, left + 14]] as const).forEach(([cid, hole, x], i) => {
    s.components.push(
      { id: cid, type: "button", placement: free(x, near + 7), stock: true } as Component,
      { id: `RS${i + 1}`, type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free(x, near + 13), stock: true },
    );
    s.wires.push(
      { id: `WI${i}a`, a: plus, b: { comp: cid, pin: 0 }, color: "#c8261f" },
      { id: `WI${i}b`, a: { comp: cid, pin: 1 }, b: { hole }, color: "#e3b21c" },
      { id: `WI${i}c`, a: { comp: cid, pin: 1 }, b: { comp: `RS${i + 1}`, pin: 0 }, color: "#e3b21c" },
      { id: `WI${i}d`, a: { comp: `RS${i + 1}`, pin: 1 }, b: minus, color: "#1b1d20" },
    );
  });
  return s;
}

/** Тактов в проверке: пять проходов цикла и ещё немного — через 15 и обратно через 0. */
export const CPU_CLOCKS = 24;

/** Прогнать процессор: сброс, такты по одному, после каждого — что на выходе; потом сброс посреди работы. */
export function cpuRun(scene: Scene, outPins: readonly string[] = CPU_PINS.out, ramFill?: number) {
  const r = runner(scene);
  const find = netOf(r.sim.scene);
  const fights = new Set<string>();
  const g1 = r.sim.scene.components.find((c) => c.id === "G1")!;
  const v = (hole: string) => (r.sim.solution.voltage.get(HOLE_BY_ID.get(hole)!.node) ?? 0) - (r.sim.solution.voltage.get(pinNode(g1, 0)) ?? 0);
  // Число — сложением, а не «|»: у 32-битного старший разряд «1 << 31» стал бы отрицательным
  const out = () => outPins.reduce((m, h, k) => m + (v(h) > 2.5 ? 2 ** k : 0), 0);
  // В схеме из одних моделей нет ничего, что меняется со временем, — шаг её не пересчитывает;
  // нажатие меняет схему, поэтому после него — пересчёт (как делает стол, когда жмут кнопку)
  const press = (id: string) => {
    r.sim.held.add(id);
    r.sim.solve();
    r.run(0.02);
    busFights(r.sim, find).forEach((f) => fights.add(f));
    r.sim.held.delete(id);
    r.sim.solve();
    r.run(0.02);
    busFights(r.sim, find).forEach((f) => fights.add(f));
  };
  r.run(0.1);
  // Мусор в ОЗУ после включения — какой выпадет; проверка может взять заведомо неверный
  if (ramFill !== undefined)
    for (const c of r.sim.scene.components) {
      const ram = c.type === "chip" && c.def === SRAM_ID ? (r.sim.memory.get(`${c.id}:ram`) as number[] | undefined) : undefined;
      if (ram) ram.fill(ramFill);
    }
  press("SB2");
  const afterReset = out();
  const outs: number[] = [];
  for (let i = 0; i < CPU_CLOCKS; i++) {
    press("SB1");
    outs.push(out());
  }
  // Сброс посреди работы — и снова с начала
  press("SB2");
  const again: number[] = [];
  for (let i = 0; i < 6; i++) {
    press("SB1");
    again.push(out());
  }
  return { afterReset, outs, again, fights: [...fights], hurt: r.hurt };
}

const chip = (func: LogicFunc, count = 1): KitItem => ({ part: "chip", func, count });
const DISPLAY_KIT: KitItem = { part: "other", type: "display", tool: "display", preset: {}, label: "индикатор SC56-11SRWA", count: 1 };
const SEG_RESISTORS: KitItem = { part: "resistor", ohms: 330, count: 7 };

// ─── Загрузчик: программа в EEPROM, при старте копируется в ОЗУ, исполняется из ОЗУ ─────────

/** Тактов загрузки: по одному на каждый из 16 адресов. */
export const BOOT_CLOCKS = 16;
/**
 * Программа загрузчика — как у 4-битного, но с A ← A + 10 в начале: после честной загрузки A = 0
 * и выход тот же; если команды исполнялись и во время загрузки, в A к запуску не 0 — видно сразу.
 */
export const BOOT_PROGRAM = [0x3a, ...CPU_PROGRAM.slice(1)];
/** Плата загрузчика, шагов: 4-битный процессор, две большие памяти и логика загрузки. */
export const BOOT_BOARD = { cols: 48, rows: 34 };

/**
 * Прогнать загрузчик: RST и 16 тактов загрузки (выход должен остаться нулём); потом EEPROM
 * стирается — дальше процессор может брать команды только из ОЗУ — и ещё CPU_CLOCKS тактов;
 * потом EEPROM возвращается, RST посреди работы — снова загрузка и 6 тактов.
 */
export function bootRun(scene: Scene) {
  const r = runner(scene);
  const g1 = r.sim.scene.components.find((c) => c.id === "G1")!;
  const v = (hole: string) => (r.sim.solution.voltage.get(HOLE_BY_ID.get(hole)!.node) ?? 0) - (r.sim.solution.voltage.get(pinNode(g1, 0)) ?? 0);
  const out = () => CPU_PINS.out.reduce((m, h, k) => m | (v(h) > 2.5 ? 1 << k : 0), 0);
  // Спор на шине — смотреть и при нажатой кнопке, и при отпущенной
  const find = netOf(r.sim.scene);
  const fights = new Set<string>();
  const look = () => busFights(r.sim, find).forEach((f) => fights.add(f));
  const press = (id: string) => {
    r.sim.held.add(id);
    r.sim.solve();
    r.run(0.02);
    look();
    r.sim.held.delete(id);
    r.sim.solve();
    r.run(0.02);
    look();
  };
  const ee = r.sim.scene.components.filter((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === EEPROM_ID);
  const saved = ee.map((c) => c.data);
  r.run(0.1);
  // Мусор в ОЗУ после включения — какой выпадет; проверка берёт худший: в каждом слове программы
  // все биты не те, — иначе незагруженный адрес мог бы случайно совпасть с нужной командой
  for (const c of r.sim.scene.components) {
    const ram = c.type === "chip" && c.def === SRAM_ID ? (r.sim.memory.get(`${c.id}:ram`) as number[] | undefined) : undefined;
    if (ram) BOOT_PROGRAM.forEach((w, a) => (ram[a] = ~w & 255));
  }
  press("SB2");
  const boot: number[] = [];
  for (let i = 0; i < BOOT_CLOCKS; i++) {
    press("SB1");
    boot.push(out());
  }
  // Стереть EEPROM: что дальше — только из ОЗУ
  for (const c of ee) delete c.data;
  r.sim.solve();
  const outs: number[] = [];
  for (let i = 0; i < CPU_CLOCKS; i++) {
    press("SB1");
    outs.push(out());
  }
  ee.forEach((c, i) => (saved[i] ? (c.data = saved[i]) : delete c.data));
  r.sim.solve();
  press("SB2");
  const again: number[] = [];
  for (let i = 0; i < BOOT_CLOCKS + 6; i++) {
    press("SB1");
    again.push(out());
  }
  return { boot, outs, again, fights: [...fights], hurt: r.hurt };
}

/**
 * Шаги проверки процессора после программы: висящие входы, медь, сброс, такт за тактом, сброс
 * посреди работы, перегрев. want(k) — что должно быть на выходе после k тактов (эмулятор).
 */
function cpuSteps(scene: Scene, outPins: readonly string[], want: (clocks: number) => number[], fmt: (v: number) => string, ramFill?: number): LessonStep[] {
  const { afterReset, outs, again, fights, hurt } = cpuRun(scene, outPins, ramFill);
  const w = want(CPU_CLOCKS);
  const bad = outs.findIndex((o, i) => o !== w[i]);
  const wAgain = want(again.length);
  const badAgain = again.findIndex((o, i) => o !== wAgain[i]);
  const floating = floatingInputs(scene);
  const shorts = foreignContacts(scene);
  const shortName = (k: (typeof shorts)[number]) => `${k.trace} × ${"trace" in k.other ? k.other.trace : holeLabel(k.other.hole)}`;
  const list = (xs: number[]) => xs.map(fmt).join(" ");
  return [
    { text: floating.length ? `Выводы висят в воздухе (ни к чему не подключены): ${floating.join(", ")}` : "Все входы и выводы питания микросхем куда-то подключены", ok: !floating.length },
    { text: shorts.length ? `Медь задевает чужую — цепи замкнуты: ${shorts.slice(0, 4).map(shortName).join("; ")}${shorts.length > 4 ? ` и ещё ${shorts.length - 4}` : ""}` : "Дорожки не задевают чужую медь", ok: !shorts.length },
    { text: fights.length ? `Две микросхемы выводят на одну цепь разом: ${fights.slice(0, 3).join("; ")}${fights.length > 3 ? ` и ещё ${fights.length - 3}` : ""}` : "На каждую цепь выводит только одна микросхема", ok: !fights.length },
    { text: `После RST на выходе 0 — сейчас ${fmt(afterReset)}`, ok: afterReset === 0 },
    { text: `Такт за тактом на выходе: ${list(outs)}${bad >= 0 ? ` (на ${bad + 1}-м такте нужно ${fmt(w[bad])})` : ""}`, ok: bad < 0 },
    { text: `RST посреди работы — и снова с начала: ${list(again)}${badAgain >= 0 ? ` (нужно ${list(wAgain)})` : ""}`, ok: badAgain < 0 },
    noHurt([...hurt]),
  ];
}

export const PROJECTS: Lesson[] = [
  {
    id: "proj-counter",
    project: true,
    title: "Счётчик нажатий",
    about:
      "Каждое нажатие кнопки — плюс один на индикаторе, после 9 — снова 0. Питание 5 В уже на верхних шинах обеих макеток. Проверка нажимает кнопку 11 раз (держит по 0,12 с) и смотрит на индикатор.",
    hints: [
      "Сначала добейтесь, чтобы индикатор вообще показывал цифру: какие управляющие входы 4511 должны стоять в покое — по таблице функций в его описании. Незанятые входы не оставляйте висеть.",
      "Одно нажатие считается за несколько? Посмотрите осциллографом на вход счётчика, пока нажимаете кнопку. А если счёт уходит за 9 — какое число первым лишнее и какие разряды у него в единице?",
    ],
    kit: [
      chip("debounce"),
      chip("cnt393"),
      chip("and"),
      chip("bcd7"),
      DISPLAY_KIT,
      SEG_RESISTORS,
      { part: "other", type: "button", tool: "button", preset: { bounce: true }, label: "кнопка (с дребезгом)", count: 1 },
    ],
    start: () => projectBench("proj-counter"),
    check(scene) {
      const btn = of(scene, "button")[0];
      if (!btn || !of(scene, "display").length) return [{ text: "На столе кнопка и индикатор", ok: false }];
      const r = runner(scene);
      r.run(0.4);
      const first = shownDigit(r.disp!, r.sim);
      const seen: number[] = [];
      for (let i = 0; i < PRESSES; i++) {
        r.sim.held.add(btn.id);
        r.run(0.12);
        r.sim.held.delete(btn.id);
        r.run(0.12);
        seen.push(shownDigit(r.disp!, r.sim));
      }
      const want = seen.map((_, i) => (first + i + 1) % 10);
      const bad = seen.findIndex((d, i) => d !== want[i]);
      const show = (d: number) => (d < 0 ? "?" : String(d));
      return [
        { text: `Индикатор показывает цифру — сейчас ${first < 0 ? "не цифра" : first}`, ok: first >= 0 },
        {
          text: `${PRESSES} нажатий с дребезгом — каждое ровно +1: ${seen.map(show).join(" ")}${first >= 0 && bad >= 0 ? ` (на ${bad + 1}-м нажатии нужно ${want[bad]})` : ""}`,
          ok: first >= 0 && bad < 0,
        },
        { text: "После 9 — снова 0", ok: first >= 0 && seen.some((d, i) => d === 0 && (i ? seen[i - 1] : first) === 9) && bad < 0 },
        ...displaySteps(r.peak(), r.hurt),
      ];
    },
  },
  {
    id: "proj-stopwatch",
    project: true,
    title: "Секундомер",
    about:
      "Индикатор сам отсчитывает секунды: 0, 1, 2 … 9, 0 … Питание 5 В уже на верхних шинах. Проверка смотрит на индикатор 5 секунд: цифры должны идти подряд, каждая — 0,85–1,15 с.",
    hints: [
      "Что в наборе умеет само давать импульсы? Вспомните, как проверяли NE555, — там же формула периода. Два резистора входят в неё неодинаково: посчитайте оба способа их поставить.",
      "Счётчик до 9 — как в счётчике нажатий.",
    ],
    kit: [
      chip("timer"),
      chip("cnt393"),
      chip("and"),
      chip("bcd7"),
      DISPLAY_KIT,
      SEG_RESISTORS,
      { part: "resistor", ohms: 10000, count: 1 },
      { part: "resistor", ohms: 680000, count: 1 },
      { part: "other", type: "capacitor", tool: "cap", preset: { variant: "ceramic", ceramicUF: 1, ceramicV: 50 }, match: { variant: "ceramic", uF: 1 }, label: "конденсатор 1 мкФ (керамический)", count: 1 },
    ],
    start: () => projectBench("proj-stopwatch"),
    check(scene) {
      if (!of(scene, "display").length) return [{ text: "На столе индикатор", ok: false }];
      const r = runner(scene);
      // Первый период 555 длиннее (конденсатор заряжается с нуля) — пропускаем
      r.run(1.5);
      const changes: { t: number; d: number }[] = [];
      let last = shownDigit(r.disp!, r.sim);
      const dt = 0.005;
      for (let t = 0; t < 5; t += dt) {
        r.run(dt, dt);
        const d = shownDigit(r.disp!, r.sim);
        if (d >= 0 && d !== last) {
          changes.push({ t, d });
          last = d;
        }
      }
      const gaps = changes.slice(1).map((c, i) => c.t - changes[i].t);
      const inOrder = changes.slice(1).every((c, i) => c.d === (changes[i].d + 1) % 10);
      const period = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
      const even = gaps.every((g) => g >= 0.85 && g <= 1.15);
      return [
        { text: `Цифры идут подряд: ${changes.map((c) => c.d).join(" ") || "индикатор не меняется"}`, ok: changes.length >= 4 && inOrder },
        { text: `Каждая цифра — 0,85–1,15 с — сейчас ${period ? `в среднем ${formatSI(period, "с")}` : "—"}`, ok: gaps.length >= 3 && even },
        ...displaySteps(r.peak(), r.hurt),
      ];
    },
  },
  {
    id: "proj-dac",
    project: true,
    title: "ЦАП на 8 бит",
    about:
      "Цифро-аналоговый преобразователь: восьмибитный код превращается в напряжение код/256 · 5 В. Код вдвигают по одному биту, старшим вперёд: SER — тумблер SA1 (столбец 2, ряды f–j), такт сдвига — кнопка SB1 (столбец 4), защёлка — кнопка SB2 (столбец 6); включено или нажато — 5 В, иначе 0. Выход — на столбец 30 (ряды a–e), там уже стоит нагрузка 10 кОм к общему. Питание 5 В — на верхних шинах. Проверка вдвигает коды 0, 1, 85, 128 и 170 и сравнивает выход с код/256 · 5 В: не дальше 20 мВ (чуть больше ступеньки в 19,5 мВ); пока вдвигается новый код, выход не должен меняться.",
    hints: [
      "Какая из открытых микросхем принимает код по одному биту и выдаёт его разом на восемь выводов? А как из восьми «да или нет» сложить напряжение, в котором старший бит весит вдвое больше соседнего, — в наборе только два номинала резисторов, 10 и 20 кОм.",
      "Выход лестницы резисторов слабый: нагрузка 10 кОм его заметно просадит. Что из набора повторяет напряжение и при этом даёт ток?",
    ],
    kit: [
      chip("sreg595"),
      chip("opamp2"),
      { part: "resistor", ohms: 10_000, count: 7 },
      { part: "resistor", ohms: 20_000, count: 9 },
    ],
    start: () => dacBench("proj-dac"),
    check(scene) {
      const { rows, hurt } = dacRun(scene);
      const want = (c: number) => (c / 256) * 5;
      const bad = rows.find((x) => Math.abs(x.v - want(x.code)) > 0.02);
      const drift = Math.max(...rows.map((x) => x.drift));
      const v = (x: number) => formatSI(x, "В");
      return [
        { text: `Выход = код/256 · 5 В ± 20 мВ: ${rows.map((x) => `${x.code} → ${v(x.v)}`).join(", ")}${bad ? ` (у ${bad.code} нужно ${v(want(bad.code))})` : ""}`, ok: !bad },
        { text: `Пока вдвигается код, выход не меняется (не больше чем на 20 мВ) — сейчас до ${formatSI(drift, "В")}`, ok: drift <= 0.02 },
        noHurt([...hurt]),
      ];
    },
  },
  {
    id: "proj-adc",
    project: true,
    title: "Вольтметр",
    about:
      "Индикатор показывает, сколько ступенек по 5/16 В (0,3125 В) нужно, чтобы дойти до входного напряжения, с округлением вверх: 1 В — 4 ступеньки (1,25 В). Вход — источник G2 на столбце 2 (ряды f–j), его напряжение можно крутить; кнопка SB1 на столбце 4 (нажата — 5 В) начинает измерение заново. Питание 5 В — на верхних шинах. Проверка ставит на G2 1; 2,7 и 0,5 В, каждый раз нажимает SB1, ждёт 0,7 с и читает цифру: должно быть 4, 9 и 2.",
    hints: [
      "Нужен источник напряжения, которое растёт ступеньками вместе со счётом, и то, что сравнит его с входом. Что из открытого считает, а что сравнивает два напряжения?",
      "Счёт должен идти, только пока своё напряжение ниже входного. Как разрешать и запрещать такты одним сигналом? И почему счёт не должен уходить за 9 при входе до 2,8 В?",
    ],
    kit: [
      chip("timer"),
      chip("cnt393"),
      chip("and"),
      chip("cmp"),
      chip("bcd7"),
      DISPLAY_KIT,
      SEG_RESISTORS,
      { part: "resistor", ohms: 10_000, count: 5 },
      { part: "resistor", ohms: 20_000, count: 5 },
      { part: "resistor", ohms: 33_000, count: 1 },
      { part: "other", type: "capacitor", tool: "cap", preset: { variant: "ceramic", ceramicUF: 1, ceramicV: 50 }, match: { variant: "ceramic", uF: 1 }, label: "конденсатор 1 мкФ (керамический)", count: 1 },
    ],
    start: () => adcBench("proj-adc"),
    check(scene) {
      if (!of(scene, "display").length) return [{ text: "На столе индикатор", ok: false }];
      const { rows, peak, hurt } = adcRun(scene);
      const want = (v: number) => Math.ceil(v / ADC_LSB);
      const bad = rows.find((x) => x.digit !== want(x.vin));
      const show = (d: number) => (d < 0 ? "?" : String(d));
      return [
        { text: `Показывает число ступенек: ${rows.map((x) => `${String(x.vin).replace(".", ",")} В → ${show(x.digit)}`).join(", ")}${bad ? ` (при ${String(bad.vin).replace(".", ",")} В нужно ${want(bad.vin)})` : ""}`, ok: !bad },
        ...displaySteps(peak, hurt),
      ];
    },
  },
  {
    id: "proj-lights",
    project: true,
    title: "Бегущие огни",
    about:
      "Десять светодиодов в ряд: горит один, и огонёк бежит слева направо, после крайнего правого — снова с левого. Каждый шаг — 0,1–0,5 с. «Слева направо» — по тому, как светодиоды стоят на столе. Питание 5 В — на верхних шинах. Проверка смотрит 4 секунды: в каждый момент горит не больше одного, по порядку, и огонёк проходит весь ряд.",
    hints: [
      "Что из открытого умеет само давать импульсы? А что по каждому импульсу переводит единицу на следующий выход из десяти?",
      "Выход логики даёт несколько миллиампер — светодиоду хватит через резистор. Входы, которыми не пользуетесь, куда-то подключите.",
    ],
    kit: [
      chip("timer"),
      chip("cnt4017"),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 10 },
      { part: "resistor", ohms: 1000, count: 10 },
      { part: "resistor", ohms: 10_000, count: 2 },
      { part: "other", type: "capacitor", tool: "cap", preset: { variant: "electrolytic", electrolyticUF: 10, electrolyticV: 16 }, match: { variant: "electrolytic", uF: 10 }, label: "конденсатор 10 мкФ", count: 1 },
    ],
    start: () => projectBench("proj-lights"),
    check(scene) {
      const leds = of(scene, "led");
      if (leds.length < 10) return [{ text: "На столе десять светодиодов", ok: false }];
      const order = [...leds].sort((a, b) => ledX(a) - ledX(b)).map((l) => l.id);
      const r = runner(scene);
      const me = order.map((id) => r.sim.scene.components.find((c) => c.id === id)!);
      r.run(0.5);
      const seen: { t: number; k: number }[] = [];
      let many = 0;
      const dt = 0.005;
      for (let t = 0; t < 4; t += dt) {
        r.run(dt, dt);
        const lit = me.map((c, k) => (Math.abs(r.sim.current(c)) > 0.001 ? k : -1)).filter((k) => k >= 0);
        if (lit.length > 1) many++;
        if (lit.length === 1 && seen.at(-1)?.k !== lit[0]) seen.push({ t, k: lit[0] });
      }
      const steps = seen.slice(1).map((s, i) => ({ ok: s.k === (seen[i].k + 1) % 10, dt: s.t - seen[i].t }));
      const inOrder = steps.length >= 8 && steps.every((s) => s.ok);
      const gaps = steps.slice(0, -1).map((s) => s.dt);
      const even = gaps.length > 0 && gaps.every((g) => g >= 0.1 && g <= 0.5);
      const all = new Set(seen.map((s) => s.k)).size === 10;
      return [
        { text: `Горят по одному, слева направо: ${seen.map((s) => s.k + 1).join(" ") || "ни один не загорается"}`, ok: inOrder && many < 4 },
        { text: `Огонёк проходит все десять — сейчас ${new Set(seen.map((s) => s.k)).size}`, ok: all },
        { text: `Шаг 0,1–0,5 с — сейчас ${gaps.length ? `${formatSI(Math.min(...gaps), "с")}…${formatSI(Math.max(...gaps), "с")}` : "—"}`, ok: even },
        noHurt([...r.hurt]),
      ];
    },
  },
  {
    id: "proj-hyst",
    project: true,
    title: "Порог с гистерезисом",
    about:
      "Выход включается, когда вход поднимется до 3 В, и выключается, только когда вход опустится до 2 В; между 2 и 3 В — остаётся каким был. Так порог не дребезжит, когда сигнал шумит около него. Вход — источник G2 на столбце 2 (ряды f–j), выход — на столбец 30 (ряды a–e): включён — не ниже 4 В, выключен — не выше 0,4 В. Питание 5 В — на верхних шинах. Проверка плавно поднимает вход от 1 до 4 В и опускает обратно; пороги — с точностью 0,15 В.",
    hints: [
      "Один компаратор сравнивает вход с одним порогом. Как сделать, чтобы порог сам сдвигался, когда выход переключился?",
      "Опорные 2,5 В удобно взять с делителя. Разница между порогами — 1 В: от чего она будет зависеть? И у LMV331 выход — открытый коллектор.",
    ],
    kit: [chip("cmp"), { part: "resistor", ohms: 10_000, count: 3 }, { part: "resistor", ohms: 20_000, count: 1 }, { part: "resistor", ohms: 100_000, count: 1 }],
    start: () => hystBench("proj-hyst"),
    check(scene) {
      const { up, down, hi, lo, hurt } = hystRun(scene);
      const v = (x: number | undefined) => (x === undefined ? "не переключился" : formatSI(x, "В"));
      return [
        { text: `Вход вверх: включается при ${HYST.on} ± ${HYST.tol} В — сейчас ${v(up)}`, ok: up !== undefined && Math.abs(up - HYST.on) <= HYST.tol },
        { text: `Вход вниз: выключается при ${HYST.off} ± ${HYST.tol} В — сейчас ${v(down)}`, ok: down !== undefined && Math.abs(down - HYST.off) <= HYST.tol },
        { text: `Уровни выхода: включён — не ниже 4 В, выключен — не выше 0,4 В — сейчас ${formatSI(hi, "В")} и ${formatSI(lo, "В")}`, ok: hi >= 4 && lo <= 0.4 },
        noHurt([...hurt]),
      ];
    },
  },
  {
    id: "proj-sar",
    project: true,
    title: "АЦП последовательного приближения",
    about:
      "Тот же вольтметр на 4 бита, но устроенный как в настоящих АЦП: ступенька 5/16 В, результат — сколько ступенек целиком укладывается во входное напряжение (округление вниз: 1 В — 3). Измерение идёт само, раз за разом, и индикатор показывает последний результат — между измерениями он не мигает. Вход — источник G2 на столбце 2 (ряды f–j). Питание 5 В — на верхних шинах. Проверка ставит на G2 1; 2,7 и 0,5 В, ждёт по секунде и читает цифру: 3, 8 и 1.",
    hints: [
      "Последовательное приближение — как угадывать число вопросами «больше или меньше?»: сначала старший бит, потом следующий. Сколько шагов нужно на 4 бита, и что должно отмечать, какой сейчас шаг?",
      "На каждом шаге пробный бит включён, а решение по нему запоминается в конце шага. Что умеет запомнить бит по фронту? И когда индикатору можно показывать результат?",
    ],
    kit: [
      chip("timer"),
      chip("cnt393"),
      chip("dec3"),
      chip("dffr", 4),
      chip("not", 4),
      chip("or", 4),
      chip("cmp"),
      chip("bcd7"),
      DISPLAY_KIT,
      SEG_RESISTORS,
      { part: "resistor", ohms: 10_000, count: 5 },
      { part: "resistor", ohms: 20_000, count: 5 },
      { part: "resistor", ohms: 33_000, count: 1 },
      { part: "other", type: "capacitor", tool: "cap", preset: { variant: "ceramic", ceramicUF: 1, ceramicV: 50 }, match: { variant: "ceramic", uF: 1 }, label: "конденсатор 1 мкФ (керамический)", count: 1 },
    ],
    start: () => hystBench("proj-sar"),
    check(scene) {
      if (!of(scene, "display").length) return [{ text: "На столе индикатор", ok: false }];
      const { rows, peak, hurt } = sarRun(scene);
      const want = (v: number) => Math.floor(v / ADC_LSB);
      const bad = rows.find((x) => x.digit !== want(x.vin));
      const show = (d: number) => (d < 0 ? "?" : String(d));
      return [
        { text: `Показывает число ступенек: ${rows.map((x) => `${String(x.vin).replace(".", ",")} В → ${show(x.digit)}`).join(", ")}${bad ? ` (при ${String(bad.vin).replace(".", ",")} В нужно ${want(bad.vin)})` : ""}`, ok: !bad },
        ...displaySteps(peak, hurt),
      ];
    },
  },
  {
    id: "proj-cpu",
    project: true,
    title: "Процессор",
    about:
      "Четырёхразрядный процессор на двусторонней плате под SMD: по каждому нажатию CLK (кнопка, площадка J3 у ближнего края) выполняет одну команду из ПЗУ, RST (площадка J5) — сброс: счётчик команд, регистр A и выход — в ноль. Команда — байт ПЗУ по адресу из счётчика команд (адрес 0…15). Младшие четыре бита — число N, старшие — что делать, биты можно сочетать: бит 7 — перейти на адрес N (иначе — на следующий), бит 6 — вывести A на выход, бит 5 — записать в A, бит 4 — записывается A + N (без него — само N; перенос за 15 теряется). Всё меняется разом по фронту CLK, каждый — по тому, что было до фронта. Выход OUT0…OUT3 — площадки J6…J9 (OUT0 — младший); светодиоды — чтобы видеть. Питание 5 В — J1 (общий) и J2 (+5 В). Соединения — дорожками. Плата двусторонняя: где сверху не пройти, не задев чужую медь, дорожка уходит вниз через переход (V на узле) и возвращается так же; можно и перемычкой. Программа проверки — впишите в ПЗУ: 0 → 2A (A ← 10), 1 → 35 (A ← A + 5), 2 → 71 (вывести A и A ← A + 1 — перенос за 15 теряется, получится 0), 3 → 3E (A ← A + 14), 4 → 65 (вывести A и A ← 5), 5 → 8F (перейти на 15), с 6 по 14 — 00, 15 → C1 (вывести A и перейти на 1). Проверка сверяет программу, смотрит, что ни один вход микросхем не висит в воздухе, жмёт RST, потом 24 раза CLK и смотрит выход после каждого, потом RST посреди работы. ",
    hints: [
      "Разберите одну команду: откуда берётся адрес, куда идёт слово из ПЗУ, что из него решает, что сделать. Какая открытая микросхема сама идёт по адресам подряд, но умеет и загрузить новый адрес?",
      "Регистрам нужны: что записать, разрешение записи и такт. Разрешения у регистров и загрузка счётчика — активным нулём, а биты команды — единицей. И что выбирает между «N» и «A + N»?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 1 },
      chip("reg173", 2),
      chip("add4"),
      chip("mux4q"),
      chip("not", 4),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 4 },
      { part: "resistor", ohms: 1000, count: 4 },
    ],
    start: () => cpuBench("proj-cpu"),
    check(scene) {
      const rom = scene.components.find((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === PROM_ID);
      const words = CPU_PROGRAM.map((_, a) => promWord(rom?.data, a));
      const hex = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
      const progOk = !!rom && CPU_PROGRAM.every((w, a) => words[a] === w);
      if (!progOk) return [{ text: rom ? `В ПЗУ — программа из описания: сейчас ${words.map((w, a) => `${a} → ${hex(w)}`).join(", ")}` : "На столе ПЗУ 74S288", ok: false }];
      return [{ text: "В ПЗУ — программа из описания", ok: true }, ...cpuSteps(scene, CPU_PINS.out, (k) => cpuEmulate(CPU_PROGRAM, k), String)];
    },
  },
  {
    id: "proj-cpu8",
    project: true,
    after: "proj-cpu",
    title: "Процессор 8 бит",
    about:
      "Тот же процессор, но числа — восьмиразрядные (0…255): регистр A, сумматор и выход — по 8 бит, перенос за 255 теряется. Команда — 12 бит по одному адресу в двух ПЗУ: в одном — число N (8 бит), в другом — что делать, биты 7…4 как у четырёхразрядного (бит 7 — перейти на адрес N mod 16, бит 6 — вывести A, бит 5 — записать в A, бит 4 — записывается A + N, иначе само N), младшие биты — 0. Адресов по-прежнему 16. Плата двусторонняя под SMD: CLK — J3, RST — J5, питание 5 В — J1 (общий) и J2 (+5 В), выход OUT0…OUT7 — площадки J6…J13 (OUT0 — младший); светодиоды — чтобы видеть. Программа проверки — числа: 0 → A5, 1 → 5A, 2 → 01, 3 → FE, 4 → 5A, 5 → 0F, 15 → 01; команды: 0 → 20 (A ← N), 1 → 30 (A ← A + N), 2 → 70 (вывести A и A ← A + N), 3 → 30, 4 → 60 (вывести A и A ← N), 5 → 80 (перейти на N), 15 → C0 (вывести A и перейти на N); остальные адреса в обоих — 00. Проверка сверяет программу, смотрит, что ни один вход не висит в воздухе и медь нигде не задевает чужую, жмёт RST, потом 24 раза CLK и смотрит выход после каждого, потом RST посреди работы. Выход в проверке — в шестнадцатеричном виде.",
    hints: [
      "Восемь бит — это два четырёхбитных среза рядом: у каждого свой сумматор, мультиплексор и регистры. Что у срезов общее, а что — своё? И как младший сумматор сообщает старшему, что сумма перевалила за 15?",
      "Оба ПЗУ читают один и тот же адрес. Какие выводы у них соединить вместе, а какие ведут в разные места? Регистры двух срезов записываются всегда одновременно — нужен ли каждому свой инвертор разрешения?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 2 },
      chip("reg173", 4),
      chip("add4", 2),
      chip("mux4q", 2),
      chip("not", 4),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 8 },
      { part: "resistor", ohms: 1000, count: 8 },
    ],
    start: () => cpuBench("proj-cpu8", CPU8_BOARD),
    check: cpu8Check,
  },
  {
    id: "proj-cpu8m",
    project: true,
    after: "proj-cpu8",
    title: "8 бит из модулей",
    about:
      "Тот же восьмиразрядный процессор и та же программа, но всё, что работает с числами, — на двух ваших модулях «Срез». Модуль ставится на плату штыревым разъёмом в ряд отверстий и стоит вертикально. Команда — 12 бит по одному адресу в двух ПЗУ: в одном — число N (8 бит), в другом — что делать, биты 7…4 (бит 7 — перейти на адрес N mod 16, бит 6 — вывести A, бит 5 — записать в A, бит 4 — записывается A + N, иначе само N). Плата двусторонняя под SMD: CLK — J3, RST — J5, питание 5 В — J1 (общий) и J2 (+5 В), выход OUT0…OUT7 — площадки J6…J13 (OUT0 — младший). Программа проверки — как у «Процессора 8 бит»: числа 0 → A5, 1 → 5A, 2 → 01, 3 → FE, 4 → 5A, 5 → 0F, 15 → 01; команды 0 → 20, 1 → 30, 2 → 70, 3 → 30, 4 → 60, 5 → 80, 15 → C0, остальные адреса — 00. Проверка та же: висящие входы, медь, RST, 24 такта CLK, RST посреди работы. Выход — в шестнадцатеричном виде.",
    hints: [
      "Сколько выводов разъёма у двух модулей подключаются к одному и тому же, а сколько — у каждого к своему? Какие из них — биты числа, какие — управление?",
      "Перенос — единственное, что модули передают друг другу. Откуда младший модуль берёт свой CI и куда уходит CO старшего?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 2 },
      chip("slice4", 2),
      chip("not", 4),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 8 },
      { part: "resistor", ohms: 1000, count: 8 },
    ],
    start: () => cpuBench("proj-cpu8m", CPU8_BOARD),
    check: cpu8Check,
  },
  {
    id: "proj-dec",
    project: true,
    after: "proj-cpu8m",
    title: "Декодер команд",
    about:
      "Восьмиразрядный процессор с настоящими командами вместо битов управления. Команда — 16 бит по одному адресу в двух ПЗУ 74S288: в одном — код операции (старшая тетрада байта, младшая — 0), в другом — число N. Коды: 0 — NOP (ничего не делать), 1 — LDI (A ← N), 4 — ADDI (A ← A + N, перенос за 255 теряется), 8 — OUT (вывести A), 9 — JMP (перейти на адрес N mod 16); остальные коды в программе не встречаются. Каждая команда — за один такт CLK, по тому, что было до фронта. Какие сигналы схемы включить для какого кода, решает декодер — EEPROM AT28C256: код операции — её адрес, байт по этому адресу — сигналы управления; таблицу вписываете вы. Числа — на двух ваших модулях «Срез». Плата двусторонняя под SMD: CLK — J3, RST — J5, питание 5 В — J1 (общий) и J2 (+5 В), выход OUT0…OUT7 — J6…J13. Программа проверки — коды: 0 → 10, 1 → 40, 2 → 80, 3 → 40, 4 → 80, 5 → 40, 6 → 00, 7 → 80, 8 → 10, 9 → 80, 10 → 90, с 11 по 15 — 00; числа: 0 → A5, 1 → 5A, 2 → 00, 3 → 01, 4 → 0D, 5 → FE, 6 → 33, 7 → 00, 8 → 5A, 9 → 00, 10 → 01, остальные — 00. Проверка сверяет ПЗУ (EEPROM — нет: таблица ваша), смотрит висящие входы и медь, жмёт RST, 24 раза CLK и RST посреди работы. Выход — в шестнадцатеричном виде.",
    hints: [
      "Выпишите для каждой из пяти команд, что должно случиться по такту: пишется ли A и что именно, меняется ли выход, грузится ли счётчик команд. Сколько получилось разных сигналов — и сколько бит в байте EEPROM?",
      "Разрешения записи у модуля и загрузка счётчика — активным нулём. Нужен ли инвертор, если байт в таблице можно вписать любой? И что сделает команда, если её ячейку оставить пустой?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 2 },
      { part: "other", type: "chip", tool: `chip:${EEPROM_ID}`, preset: { smd: true }, match: { def: EEPROM_ID }, label: "EEPROM AT28C256", count: 1 },
      chip("slice4", 2),
      chip("not", 1),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 8 },
      { part: "resistor", ohms: 1000, count: 8 },
    ],
    start: () => cpuBench("proj-dec", CPU8_BOARD),
    check: decCheck,
  },
  {
    id: "proj-flags",
    project: true,
    after: "proj-dec",
    title: "Перенос и условный переход",
    about:
      "«Декодер команд», которому есть из чего выбирать: у процессора появляется флаг C — перенос — и переход по нему. Новые команды: 5 — SUBI (A ← A − N), A — JC (перейти на адрес N mod 16, если C = 1, иначе — на следующий), F — HLT (стоять на месте: счётчик команд не меняется, пока не нажат RST). ADDI и SUBI ставят C: у сложения — 1, если сумма перевалила за 255, у вычитания — 1, если вычитаемое не больше уменьшаемого (заёма не было); остальные команды C не трогают. RST обнуляет и C. Прежние команды — как в «Декодере»: 0 — NOP, 1 — LDI, 4 — ADDI, 8 — OUT, 9 — JMP. Каждая — за один такт CLK, по тому, что было до фронта. Решает, что делать, по-прежнему EEPROM AT28C256 — таблицу вписываете вы. Плата двусторонняя под SMD: CLK — J3, RST — J5, питание 5 В — J1 (общий) и J2 (+5 В), выход OUT0…OUT7 — J6…J13. Программа проверки — коды: 0 → 10, 1 → 80, 2 → 50, 3 → A0, 4 → 80, 5 → 40, 6 → 10, 7 → A0, 8 → F0, 9 → 50, 10 → 80, 11 → 00, 12 → A0, 13 → 40, 14 → 80, 15 → F0; числа: 0 → 02, 1 → 00, 2 → 01, 3 → 01, 4 → 00, 5 → 01, 6 → 5A, 7 → 09, 8 → 00, 9 → A5, 10 → 00, 11 → 33, 12 → 00, 13 → 4B, 14 → 0E, 15 → 02. Проверка сверяет ПЗУ, смотрит висящие входы и медь, жмёт RST, 24 раза CLK и RST посреди работы. Выход — в шестнадцатеричном виде.",
    hints: [
      "Модуль умеет только складывать. Чему равно A − N в восьми битах, если вспомнить, как записываются отрицательные числа? Что для этого сделать с N и с переносом на входе младшего модуля?",
      "Триггер запоминает по каждому фронту. Как сделать, чтобы C менялся только от ADDI и SUBI, а остальные команды его не трогали? И откуда декодер узнает, надо ли переходить по JC, — что ещё можно подать ему на адрес?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 2 },
      { part: "other", type: "chip", tool: `chip:${EEPROM_ID}`, preset: { smd: true }, match: { def: EEPROM_ID }, label: "EEPROM AT28C256", count: 1 },
      chip("slice4", 2),
      chip("xor", 8),
      chip("dffr"),
      chip("mux"),
      chip("not", 1),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 8 },
      { part: "resistor", ohms: 1000, count: 8 },
    ],
    start: () => cpuBench("proj-flags", CPU8_BOARD),
    check: flagsCheck,
  },
  {
    id: "proj-mem",
    project: true,
    after: "proj-flags",
    title: "Память и проверка на ноль",
    about:
      "Процессор получает память данных — ОЗУ HM62256B — и переходы по нулю. Новые команды: 2 — LD (A ← RAM[N]), 3 — ST (RAM[N] ← A), 6 — ADD (A ← A + RAM[N]), 7 — SUB (A ← A − RAM[N]), B — JZ (перейти на N mod 16, если A = 0), C — JNZ (если A ≠ 0). ADD и SUB ставят флаг C, как ADDI и SUBI. Отдельного флага нуля нет: JZ и JNZ смотрят, что в A сейчас. Адрес в ОЗУ — само N (младшие 8 разрядов адреса; старшие — 0). Прежние команды — как раньше: 0 NOP, 1 LDI, 4 ADDI, 5 SUBI, 8 OUT, 9 JMP, A JC, F HLT. Каждая — за один такт CLK, по тому, что было до фронта; ST записывает в ОЗУ то, что было в A. Декодер — EEPROM AT28C256, таблицу вписываете вы. Числа — на двух ваших модулях «Срез 2». ОЗУ после включения полно мусора: проверка заполняет его заведомо неверным. Плата двусторонняя под SMD: CLK — J3, RST — J5, питание 5 В — J1 (общий) и J2 (+5 В), выход OUT0…OUT7 — J6…J13. Программа проверки — коды: 0 → 10, 1 → 30, 2 → 10, 3 → 30, 4 → 20, 5 → 60, 6 → 80, 7 → 70, 8 → 80, 9 → 50, 10 → B0, 11 → C0, 12 → 80, 13 → C0, 14 → 40, 15 → C0; числа: 0 → 5A, 1 → A5, 2 → A5, 3 → 5A, 4 → A5, 5 → 5A, 6 → 00, 7 → A5, 8 → 00, 9 → A5, 10 → 0C, 11 → 00, 12 → 00, 13 → 0F, 14 → 01, 15 → 06. Проверка сверяет ПЗУ, смотрит висящие входы, медь и чтобы на шину не выводили две микросхемы разом, жмёт RST, 24 раза CLK и RST посреди работы. Выход — в шестнадцатеричном виде.",
    hints: [
      "У ОЗУ выводы данных — и вход, и выход по одним проводам. Кто ставит на них число, когда ОЗУ читают, и кто — когда в него пишут? Что должно молчать в каждом случае?",
      "Второе слагаемое теперь берётся то из ПЗУ, то из ОЗУ. Что выбирает между ними? А «A = 0» — это сколько бит, и как свести их к одному сигналу для декодера?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 2 },
      { part: "other", type: "chip", tool: `chip:${EEPROM_ID}`, preset: { smd: true }, match: { def: EEPROM_ID }, label: "EEPROM AT28C256", count: 2 },
      { part: "other", type: "chip", tool: `chip:${SRAM_ID}`, preset: { smd: true }, match: { def: SRAM_ID }, label: "ОЗУ HM62256B", count: 1 },
      chip("slice4a", 2),
      chip("mux4q", 2),
      chip("buf8z"),
      chip("xor", 8),
      chip("or", 7),
      chip("nor"),
      chip("dffr"),
      chip("mux"),
      chip("not", 2),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 8 },
      { part: "resistor", ohms: 1000, count: 8 },
    ],
    start: () => cpuBench("proj-mem", CPU8_BOARD),
    check: memCheck,
  },
  {
    id: "proj-cpu32",
    project: true,
    after: "proj-cpu8m",
    title: "Процессор 32 бит",
    about:
      "Тот же процессор, но числа — тридцатидвухразрядные (0…4 294 967 295): регистр A, сумматор и выход по 32 бита, перенос за старший разряд теряется. Всё, что работает с числами, — на восьми ваших модулях «Срез». Команда — 40 бит по одному адресу в пяти ПЗУ 74S288: в четырёх — число N по байтам (байт 0 — младший), в пятом — что делать, биты 7…4 как у восьмиразрядного (бит 7 — перейти на адрес N mod 16, бит 6 — вывести A, бит 5 — записать в A, бит 4 — записывается A + N, иначе само N), младшие — 0. Адресов по-прежнему 16. Плата двусторонняя под SMD: CLK — J3, RST — J5, питание 5 В — J1 (общий) и J2 (+5 В), выход OUT0…OUT31 — площадки J6…J37 (OUT0 — младший). Программа проверки — числа N: 0 → A5A5A5A5, 1 → 5A5A5A5A, 2 → 00000001, 3 → FFFFFFFE, 4 → 5A5A5A5A, 5 → 0000000F, 15 → 00000001, остальные — 0 (по байтам: в ПЗУ байта 0 — A5, 5A, 01, FE, 5A, 0F, …, 01; в ПЗУ байтов 1, 2 и 3 — A5, 5A, 00, FF, 5A, 00, …, 00); команды — как у восьмиразрядного: 0 → 20, 1 → 30, 2 → 70, 3 → 30, 4 → 60, 5 → 80, 15 → C0, остальные — 00. Проверка та же: висящие входы, медь, RST, 24 такта CLK, RST посреди работы. Выход — в шестнадцатеричном виде.",
    hints: [
      "Восемь модулей — восемь одинаковых кусков по 4 бита. Какие выводы разъёма у всех восьми общие, а какие у каждого свои? Сколько проводов уходит к каждому ПЗУ чисел?",
      "Перенос идёт по цепочке от младшего модуля к старшему. Сколько ему нужно пройти, чтобы FFFFFFFF + 1 стало нулём, — и что будет, если где-то в цепочке он оборвётся?",
    ],
    kit: [
      chip("cnt161"),
      { part: "other", type: "chip", tool: `chip:${PROM_ID}`, preset: {}, match: { def: PROM_ID }, label: "ПЗУ 74S288", count: 5 },
      chip("slice4", 8),
      chip("not", 4),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 32 },
      { part: "resistor", ohms: 1000, count: 32 },
    ],
    start: () => cpuBench("proj-cpu32", CPU32_BOARD),
    check: cpu32Check,
  },
  {
    id: "proj-boot",
    project: true,
    after: "proj-cpu",
    title: "Загрузчик",
    about:
      "Тот же четырёхразрядный процессор, но команды он берёт не из ПЗУ, а из ОЗУ HM62256B — как настоящие компьютеры. Программа хранится в EEPROM AT28C256 (без питания не пропадает), а ОЗУ после включения полно мусора. Поэтому после RST сначала идёт загрузка: 16 тактов CLK — по одному на адрес 0…15 — байт из EEPROM переписывается в ОЗУ по тому же адресу; выход в это время — 0, и команды не исполняются. На 17-м такте процессор начинает работать: адрес 0, 1, 2… — и команды из ОЗУ, как у четырёхразрядного (бит 7 — переход на N, бит 6 — вывести A, бит 5 — записать в A, бит 4 — A + N). Плата двусторонняя под SMD: CLK — J3, RST — J5, питание — J1 (общий) и J2 (+5 В), выход OUT0…OUT3 — J6…J9. Программа в EEPROM: 0 → 3A (A ← A + 10), 1 → 35, 2 → 71, 3 → 3E, 4 → 65, 5 → 8F, 15 → C1, остальные — 00. Проверка сверяет EEPROM, смотрит, что ни один вход не висит и медь не задевает чужую, жмёт RST и 16 раз CLK (выход должен остаться 0), потом стирает EEPROM — дальше работать можно только из ОЗУ — и ещё 24 раза CLK, сверяя выход; потом возвращает EEPROM, жмёт RST посреди работы и проверяет, что загрузка и запуск повторились. Всё это время на каждую цепь должна выводить только одна микросхема.",
    hints: [
      "Процессор берёт команды с одной шины данных. Кто выставляет на неё байт во время загрузки и кто — во время работы? Кому надо помнить, что загрузка уже закончилась, и по какому сигналу счётчика это узнать?",
      "Во время загрузки на шине — байты программы, то есть команды. Что не даст процессору их исполнить? И в какой половине такта писать в ОЗУ, чтобы адрес в этот момент уже не менялся?",
    ],
    kit: [
      chip("cnt161"),
      chip("reg173", 2),
      chip("add4"),
      chip("mux4q"),
      { part: "other", type: "chip", tool: `chip:${EEPROM_ID}`, preset: { smd: true }, match: { def: EEPROM_ID }, label: "EEPROM AT28C256", count: 1 },
      { part: "other", type: "chip", tool: `chip:${SRAM_ID}`, preset: { smd: true }, match: { def: SRAM_ID }, label: "ОЗУ HM62256B", count: 1 },
      chip("dffr"),
      chip("nand", 3),
      chip("or", 2),
      chip("not", 2),
      { part: "other", type: "led", tool: "led", preset: { color: "red", size: "5mm" }, label: "светодиод красный", count: 4 },
      { part: "resistor", ohms: 1000, count: 4 },
    ],
    start: () => cpuBench("proj-boot", BOOT_BOARD),
    check(scene) {
      const ee = scene.components.find((c): c is Extract<Component, { type: "chip" }> => c.type === "chip" && c.def === EEPROM_ID);
      const hex = (w: number) => w.toString(16).toUpperCase().padStart(2, "0");
      const words = BOOT_PROGRAM.map((_, a) => eepromWord(ee?.data, a));
      if (!ee || !BOOT_PROGRAM.every((w, a) => words[a] === w)) return [{ text: ee ? `В EEPROM — программа из описания: сейчас ${words.map((w, a) => `${a} → ${hex(w)}`).join(", ")}` : "На плате EEPROM AT28C256", ok: false }];
      const { boot, outs, again, fights, hurt } = bootRun(scene);
      const want = cpuEmulate(BOOT_PROGRAM, CPU_CLOCKS);
      const bad = outs.findIndex((o, i) => o !== want[i]);
      const wantAgain = [...Array(BOOT_CLOCKS).fill(0), ...cpuEmulate(BOOT_PROGRAM, 6)];
      const badAgain = again.findIndex((o, i) => o !== wantAgain[i]);
      const floating = floatingInputs(scene);
      const shorts = foreignContacts(scene);
      const shortName = (k: (typeof shorts)[number]) => `${k.trace} × ${"trace" in k.other ? k.other.trace : holeLabel(k.other.hole)}`;
      return [
        { text: "В EEPROM — программа из описания", ok: true },
        { text: floating.length ? `Выводы висят в воздухе (ни к чему не подключены): ${floating.join(", ")}` : "Все входы и выводы питания микросхем куда-то подключены", ok: !floating.length },
        { text: shorts.length ? `Медь задевает чужую — цепи замкнуты: ${shorts.slice(0, 4).map(shortName).join("; ")}${shorts.length > 4 ? ` и ещё ${shorts.length - 4}` : ""}` : "Дорожки не задевают чужую медь", ok: !shorts.length },
        { text: fights.length ? `Две микросхемы выводят на одну цепь разом: ${fights.slice(0, 3).join("; ")}${fights.length > 3 ? ` и ещё ${fights.length - 3}` : ""}` : "На каждую цепь выводит только одна микросхема", ok: !fights.length },
        { text: `Загрузка — 16 тактов после RST, выход 0: ${boot.join(" ")}`, ok: boot.every((o) => o === 0) },
        { text: `EEPROM стёрта — работа из ОЗУ, такт за тактом: ${outs.join(" ")}${bad >= 0 ? ` (на ${bad + 1}-м такте нужно ${want[bad]})` : ""}`, ok: bad < 0 },
        { text: `RST посреди работы — снова загрузка и запуск: ${again.join(" ")}${badAgain >= 0 ? ` (нужно ${wantAgain.join(" ")})` : ""}`, ok: badAgain < 0 },
        noHurt([...hurt]),
      ];
    },
  },
];
