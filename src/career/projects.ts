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
];
