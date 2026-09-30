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
import { HOLE_BY_ID } from "../model/breadboard";
import { pinNode } from "../sim/nodes";
import { free, noHurt, of, type Lesson, type LessonStep } from "./lessons";
import { SEGMENTS, type KitItem, type LogicFunc } from "./levels";
import { PROM_ID, promWord } from "../chips/memory";

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
 * 0: A ← 9; 1: A ← A + 7 (= 0); 2: вывести A; 3: A ← A + 10; 4: вывести A, A ← 2; 5: вывести A, на 3.
 */
export const CPU_PROGRAM = [0x29, 0x37, 0x50, 0x3a, 0x62, 0xc3];

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

/** Плата процессора под SMD, шагов 2,54 мм: площадки для проводов J1…J35 — вдоль ближнего края. */
export const CPU_BOARD = { cols: 36, rows: 26 };

/**
 * Стол процессора: плата под SMD (микросхемы в SOIC, соединения — дорожками, где не развести —
 * перемычками). Питание и кнопки CLK, RST без дребезга (к +5 В, подтяжка 10 кОм к общему) — на
 * площадках у края: J1 — общий, J2 — +5 В.
 */
function cpuBench(id: string): Scene {
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  const s: Scene = {
    components: [{ id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: free(-34, -4) }],
    wires: [
      { id: "W1", a: minus, b: { hole: CPU_PINS.gnd }, color: "#1b1d20" },
      { id: "W2", a: plus, b: { hole: CPU_PINS.vcc }, color: "#c8261f" },
    ],
    boards: [{ id: "S1", kind: "smd", x: 0, z: 0, cols: CPU_BOARD.cols, rows: CPU_BOARD.rows, seats: [] }],
    career: { lesson: id },
  };
  ([["SB1", CPU_PINS.clk, -12], ["SB2", CPU_PINS.rst, -4]] as const).forEach(([cid, hole, x], i) => {
    s.components.push(
      { id: cid, type: "button", placement: free(x, 20), stock: true } as Component,
      { id: `RS${i + 1}`, type: "resistor", variant: "tht", ohms: 10_000, smdSize: "0805", placement: free(x, 26), stock: true },
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
export function cpuRun(scene: Scene) {
  const r = runner(scene);
  const g1 = r.sim.scene.components.find((c) => c.id === "G1")!;
  const v = (hole: string) => (r.sim.solution.voltage.get(HOLE_BY_ID.get(hole)!.node) ?? 0) - (r.sim.solution.voltage.get(pinNode(g1, 0)) ?? 0);
  const out = () => CPU_PINS.out.reduce((m, h, k) => m | (v(h) > 2.5 ? 1 << k : 0), 0);
  // В схеме из одних моделей нет ничего, что меняется со временем, — шаг её не пересчитывает;
  // нажатие меняет схему, поэтому после него — пересчёт (как делает стол, когда жмут кнопку)
  const press = (id: string) => {
    r.sim.held.add(id);
    r.sim.solve();
    r.run(0.02);
    r.sim.held.delete(id);
    r.sim.solve();
    r.run(0.02);
  };
  r.run(0.1);
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
  return { afterReset, outs, again, hurt: r.hurt };
}

const chip = (func: LogicFunc, count = 1): KitItem => ({ part: "chip", func, count });
const DISPLAY_KIT: KitItem = { part: "other", type: "display", tool: "display", preset: {}, label: "индикатор SC56-11SRWA", count: 1 };
const SEG_RESISTORS: KitItem = { part: "resistor", ohms: 330, count: 7 };

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
      "Четырёхразрядный процессор на плате под SMD: по каждому нажатию CLK (кнопка, площадка J3 у ближнего края) выполняет одну команду из ПЗУ, RST (площадка J5) — сброс: счётчик команд, регистр A и выход — в ноль. Команда — байт ПЗУ по адресу из счётчика команд (адрес 0…15). Младшие четыре бита — число N, старшие — что делать, биты можно сочетать: бит 7 — перейти на адрес N (иначе — на следующий), бит 6 — вывести A на выход, бит 5 — записать в A, бит 4 — записывается A + N (без него — само N; перенос за 15 теряется). Всё меняется разом по фронту CLK, каждый — по тому, что было до фронта. Выход OUT0…OUT3 — площадки J6…J9 (OUT0 — младший); светодиоды — чтобы видеть. Питание 5 В — J1 (общий) и J2 (+5 В). Соединения — дорожками; где дорожке не пройти, не пересекая другие, — перемычкой. Программа проверки — впишите в ПЗУ: 0 → 29 (A ← 9), 1 → 37 (A ← A + 7, получится 0), 2 → 50 (вывести A), 3 → 3A (A ← A + 10), 4 → 62 (вывести A и A ← 2), 5 → C3 (вывести A и перейти на 3). Проверка сверяет программу, жмёт RST, потом 24 раза CLK и смотрит выход после каждого, потом RST посреди работы. ",
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
      const { afterReset, outs, again, hurt } = cpuRun(scene);
      const want = cpuEmulate(CPU_PROGRAM, CPU_CLOCKS);
      const bad = outs.findIndex((o, i) => o !== want[i]);
      const wantAgain = cpuEmulate(CPU_PROGRAM, again.length);
      const badAgain = again.findIndex((o, i) => o !== wantAgain[i]);
      return [
        { text: "В ПЗУ — программа из описания", ok: true },
        { text: `После RST на выходе 0 — сейчас ${afterReset}`, ok: afterReset === 0 },
        { text: `Такт за тактом на выходе: ${outs.join(" ")}${bad >= 0 ? ` (на ${bad + 1}-м такте нужно ${want[bad]})` : ""}`, ok: bad < 0 },
        { text: `RST посреди работы — и снова с начала: ${again.join(" ")}${badAgain >= 0 ? ` (нужно ${wantAgain.join(" ")})` : ""}`, ok: badAgain < 0 },
        noHurt([...hurt]),
      ];
    },
  },
];
