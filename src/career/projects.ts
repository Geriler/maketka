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

const chip = (func: LogicFunc, count = 1): KitItem => ({ part: "chip", func, count });
const DISPLAY_KIT: KitItem = { part: "other", type: "display", tool: "display", preset: {}, label: "индикатор SC56-11SRWA", count: 1 };
const SEG_RESISTORS: KitItem = { part: "resistor", ohms: 330, count: 7 };

export const PROJECTS: Lesson[] = [
  {
    id: "proj-counter",
    project: true,
    title: "Счётчик нажатий",
    about:
      "Кнопка, индикатор и то, что между ними: каждое нажатие — плюс один, после 9 — снова 0. Кнопка настоящая, с дребезгом: без подавителя счётчик насчитает лишнее. Питание 5 В уже на верхних шинах обеих макеток. Проверка нажимает кнопку 11 раз (держит по 0,12 с) и смотрит на индикатор.",
    hints: [
      "Цепочка: кнопка → MAX6816 (кнопка между IN и общим) → счёт по спаду у 74HC393 → 74HC4511 → через резисторы на сегменты. У 4511 LT̅ и BL̅ — к питанию, LE̅ — к общему; у 393 второй счётчик не нужен — держите его в сбросе.",
      "393 считает до 15, а нужно до 9: какое число первым лишнее и какие разряды у него в единице? Сброс у 393 — по высокому уровню.",
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
      "Индикатор сам отсчитывает секунды: 0, 1, 2 … 9, 0 … Генератор на 555 даёт импульс раз в секунду, счётчик считает до 9, дешифратор зажигает цифру. Питание 5 В уже на верхних шинах. Проверка смотрит на индикатор 5 секунд: цифры должны идти подряд, каждая — 0,85–1,15 с.",
    hints: [
      "Генератор на 555 — как в проверке NE555 (схема «астабильный режим» есть в даташите). Период ≈ 0,693·(RA + 2RB)·C: посчитайте, какой резистор из набора куда.",
      "Счётчик до 9 — как в счётчике нажатий. Такт — с выхода таймера.",
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
];
