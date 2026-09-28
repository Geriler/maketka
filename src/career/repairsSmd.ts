/**
 * Ремонты на плате под SMD и в схемах поздних цепочек: трещина тонкой дорожки, транзистор не
 * того типа в том же корпусе SOT-23, мост припоя между выводами SOIC, перегоревший сегмент
 * индикатора, конденсатор не того номинала у 555. Описания — только про симптом.
 */

import type { BoardSpec, Seat } from "../model/breadboard";
import { DISPLAY_SEGMENTS, padNumbers, type ChipDef, type Component, type Scene } from "../model/types";
import { chipsUsed } from "../chips/registry";
import { Simulation } from "../sim/simulation";
import { formatSI } from "../sim/resistorCodes";
import { segmentCurrent } from "../parts/display";
import { free, ledOk, mA, noHurt, of, settle, type Lesson, type LessonStep } from "./lessons";
import { referenceChips } from "./build";
import type { KitItem } from "./levels";

/** Стол ремонта: показаний деталей не видно, всё стоящее — не из набора. */
const repair = (s: Scene): Scene => ({
  ...s,
  components: s.components.map((c) => ({ ...c, stock: true as const })),
  career: { ...s.career, repair: true },
});

const psu = (): Component => ({ id: "G1", type: "psu", volts: 5, amps: 0.5, on: true, placement: free(-30, -4) });
const meter = (): Component => ({ id: "P1", type: "meter", mode: "V", placement: free(32, 14) });
const smdRes = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "smd", ohms, smdSize: "0805", placement: free(0, 0) });

let refs: Record<string, ChipDef> | undefined;
/** Заводские микросхемы со всем, что у них внутри (для сцены ремонта). */
function chipsFor(ids: string[]): Record<string, ChipDef> {
  refs ??= Object.fromEntries(referenceChips().map((d) => [d.id, d]));
  const scene: Scene = { components: ids.map((def, i) => ({ id: `X${i}`, type: "chip", def, name: "", package: refs![def].package, pins: refs![def].pins, placement: free(0, 0) }) as Component), wires: [], chips: refs };
  return chipsUsed(scene);
}
const refChip = (id: string, def: string, smd: boolean): Component => {
  refs ??= Object.fromEntries(referenceChips().map((d) => [d.id, d]));
  const d = refs[def];
  return { id, type: "chip", def, name: d.name, package: d.package, pins: d.pins, ...(smd ? { smd: true } : {}), placement: free(0, 0) } as Component;
};

// ─── Плата под SMD: детали на посадочных местах, дорожки между площадками ───

/** Деталь и центр её посадочного места (шаги 2,54 мм от центра платы), поворот 0. */
type Placed = [Component, number, number];

/**
 * Плата 24 × 15 под SMD в центре стола. Детали встают на свои места, узлы дорожек — точки
 * [x, z]; дорожки — между «R1.2», «n3» (узел) и «J5» (площадка для провода у края).
 */
function smdBoard(parts: Placed[], nodes: Record<string, [number, number]>, traces: [string, string][]): { board: BoardSpec; components: Component[]; traces: Scene["traces"] } {
  const seats: Seat[] = [];
  const components = parts.map(([c, x, z]) => {
    const fp = footprintOfPlaced(c);
    seats.push({ id: c.id, fp, x, z, rot: 0 });
    const n = fp === "SOT-23" ? 3 : fp.startsWith("SO-") ? Number(fp.slice(3)) : fp === "DISP-10" ? 10 : 2;
    return { ...c, placement: { mode: "board" as const, holes: padNumbers(c, n).map((k) => `s:${c.id}.${k}`) } } as Component;
  });
  for (const [id, [x, z]] of Object.entries(nodes)) seats.push({ id, fp: "NODE", x, z, rot: 0 });
  const hole = (e: string) => (/^J\d+$/.test(e) ? `s:${e}` : e.includes(".") ? `s:${e}` : `s:${e}.1`);
  return {
    board: { id: "S1", kind: "smd", x: 0, z: 0, cols: 24, rows: 15, seats },
    components,
    traces: traces.map(([a, b], i) => ({ id: `T${i + 1}`, a: hole(a), b: hole(b) })),
  };
}

function footprintOfPlaced(c: Component): Seat["fp"] {
  if (c.type === "resistor") return c.smdSize;
  if (c.type === "led") return "TH2-1";
  if (c.type === "mosfet" || c.type === "transistor") return "SOT-23";
  if (c.type === "chip") return `SO-${c.pins}` as Seat["fp"];
  throw new Error(`нет посадочного места для ${c.type}`);
}

const hole = (h: string) => ({ hole: h });
const pin = (comp: string, p: number) => ({ comp, pin: p });

/** Два светодиода с резисторами 330 Ом на плате под SMD; trouble — трещина во второй цепочке. */
export function smdLedScene(id: string): Scene {
  const led = (lid: string, color: "green" | "red"): Component => ({ id: lid, type: "led", color, placement: free(0, 0) });
  const b = smdBoard(
    [
      [smdRes("R1", 330), -3, -2],
      [led("HL1", "green"), 1, -2],
      [smdRes("R2", 330), -3, 2],
      [led("HL2", "red"), 1, 2],
    ],
    { n1: [-7, -2], n2: [-7, 2], n3: [5, -2], n4: [5, 2] },
    [
      ["J5", "n2"], ["n2", "n1"], ["n1", "R1.1"], ["n2", "R2.1"],
      ["R1.2", "HL1.1"], ["R2.2", "HL2.1"],
      ["HL1.2", "n3"], ["HL2.2", "n4"], ["n3", "n4"], ["n4", "J17"],
    ],
  );
  for (const t of b.traces ?? []) if (t.a === "s:R2.2" && t.b === "s:HL2.1") t.fault = { open: true };
  return repair({
    components: [psu(), ...b.components, meter()],
    wires: [
      { id: "W1", a: pin("G1", 1), b: hole("s:J5"), color: "#c8261f" },
      { id: "W2", a: pin("G1", 0), b: hole("s:J17"), color: "#1b1d20" },
    ],
    traces: b.traces,
    boards: [b.board],
    career: { lesson: id },
  });
}

/** Ключ на полевом транзисторе в SOT-23: тумблер на затвор, светодиод в стоке. В схеме должен стоять 2N7002. */
export function smdSwitchScene(id: string, kind: "2N7002" | "BSS84"): Scene {
  const b = smdBoard(
    [
      [smdRes("R1", 330), -3, -2],
      [{ id: "HL1", type: "led", color: "green", placement: free(0, 0) }, 1, -2],
      [{ id: "VT1", type: "mosfet", kind, placement: free(0, 0) }, 4, -1.5],
      [smdRes("R2", 100_000), 5, 3],
    ],
    { n1: [-9, -2], n2: [3.5, 1], n3: [7, -1], n4: [7, 3] },
    [
      ["J3", "n1"], ["n1", "R1.1"], ["R1.2", "HL1.1"], ["HL1.2", "VT1.3"],
      ["VT1.1", "n2"], ["n2", "R2.1"], ["n2", "J12"],
      ["VT1.2", "n3"], ["R2.2", "n4"], ["n3", "n4"], ["n4", "J19"],
    ],
  );
  return repair({
    components: [psu(), { id: "SA1", type: "switch", closed: false, placement: free(-20, 12) } as Component, ...b.components, meter()],
    wires: [
      { id: "W1", a: pin("G1", 1), b: hole("s:J3"), color: "#c8261f" },
      { id: "W2", a: pin("G1", 0), b: hole("s:J19"), color: "#1b1d20" },
      { id: "W3", a: pin("G1", 1), b: pin("SA1", 0), color: "#c8261f" },
      { id: "W4", a: pin("SA1", 1), b: hole("s:J12"), color: "#e3b21c" },
    ],
    traces: b.traces,
    boards: [b.board],
    career: { lesson: id },
  });
}

/**
 * Индикатор порога на LM393 в SO-8: второй канал сравнивает вход (тумблер, подтяжка 10 кОм к
 * общему) с половиной питания; вход ниже — выход прижат, светодиод горит. Первый канал не занят,
 * его входы — на общий. bridge — капля припоя между выводами 7 и 8.
 */
export function smdComparatorScene(id: string, bridge: boolean): Scene {
  const b = smdBoard(
    [
      [refChip("DA1", "ref:lm393", true), 0, 0],
      [{ id: "HL1", type: "led", color: "red", placement: free(0, 0) }, -2.5, -3.5],
      [smdRes("R4", 330), -5, -3.5],
      [smdRes("R1", 10_000), 2, -5.5],
      [smdRes("R2", 10_000), 2.5, -2.5],
      [smdRes("R3", 10_000), 5.5, 3],
    ],
    {
      v1: [-7, -1], v2: [-7, -3.5], v3: [-7, -5.5],
      o7: [-0.25, -3.5], m: [0.25, -2.5],
      i5: [3.5, -1], i6: [3.5, 3],
      g1: [8, -2.5], g2: [8, 3], g3: [8, 5], g4: [0.75, 5], u2: [-0.25, 4],
    },
    [
      // Питание: J5 → вывод 8, светодиод, делитель
      ["J5", "v1"], ["v1", "v2"], ["v2", "v3"], ["DA1.8", "v1"],
      ["R4.1", "v2"], ["R4.2", "HL1.1"], ["HL1.2", "o7"], ["DA1.7", "o7"],
      ["v3", "R1.1"], ["R1.2", "m"], ["m", "DA1.6"], ["m", "R2.1"], ["R2.2", "g1"],
      // Вход: вывод 5, подтяжка к общему, провод от тумблера — на узел i6
      ["DA1.5", "i5"], ["i5", "i6"], ["i6", "R3.1"], ["R3.2", "g2"],
      // Общий: вывод 4, незанятые входы первого канала (2 и 3), J20
      ["g1", "g2"], ["g2", "g3"], ["g3", "J20"], ["DA1.4", "g4"], ["g4", "g3"],
      ["DA1.3", "u2"], ["DA1.2", "u2"], ["u2", "g4"],
      ...(bridge ? ([["DA1.7", "DA1.8"]] as [string, string][]) : []),
    ],
  );
  return repair({
    components: [psu(), { id: "SA1", type: "switch", closed: false, placement: free(-20, 12) } as Component, ...b.components, meter()],
    wires: [
      { id: "W1", a: pin("G1", 1), b: hole("s:J5"), color: "#c8261f" },
      { id: "W2", a: pin("G1", 0), b: hole("s:J20"), color: "#1b1d20" },
      { id: "W3", a: pin("G1", 1), b: pin("SA1", 0), color: "#c8261f" },
      { id: "W4", a: pin("SA1", 1), b: hole("s:i6.1"), color: "#e3b21c" },
    ],
    traces: b.traces,
    boards: [b.board],
    chips: chipsFor(["ref:lm393"]),
    career: { lesson: id },
  });
}

/** Светодиод при тумблере выключенном и включённом: [ток при выкл., ток при вкл., что сгорело]. */
function switchLed(scene: Scene): { off: number; on: number; hurt: string[] } | undefined {
  const led = of(scene, "led")[0];
  if (!led || !of(scene, "switch").length) return undefined;
  const at = (closed: boolean) => {
    const s: Scene = JSON.parse(JSON.stringify(scene));
    for (const c of s.components) if (c.type === "switch") c.closed = closed;
    const r = settle(s);
    return { i: Math.abs(r.sim.current(r.sim.scene.components.find((c) => c.id === led.id)!)), hurt: r.hurt };
  };
  const a = at(false), b = at(true);
  return { off: a.i, on: b.i, hurt: [...new Set([...a.hurt, ...b.hurt])] };
}

// ─── Индикатор на макетке: все сегменты через резисторы к плюсу — «8» ───────

/** Столбцы сегментов: выводы 1–5 — ряд h столбцы 10–14, выводы 6–10 — ряд d столбцы 14…10. */
const DISP_COL = 10;
export function displayScene(id: string, dead?: number): Scene {
  const holes = [0, 1, 2, 3, 4].map((k) => `h${DISP_COL + k}`).concat([4, 3, 2, 1, 0].map((k) => `d${DISP_COL + k}`));
  const colOf = (p: number) => (p <= 5 ? { col: DISP_COL + p - 1, top: false } : { col: DISP_COL + 10 - p, top: true });
  const res: Component[] = [];
  DISPLAY_SEGMENTS.slice(0, 7).forEach((s, k) => {
    const { col, top } = colOf(s.pin);
    res.push({ id: `R${k + 1}`, type: "resistor", variant: "tht", ohms: 330, smdSize: "0805", placement: { mode: "board", holes: top ? [`top+${col - 2}`, `a${col}`] : [`bot+${col - 2}`, `j${col}`] } });
  });
  return repair({
    components: [
      psu(),
      { id: "HG1", type: "display", placement: { mode: "board", holes }, ...(dead !== undefined ? { fault: { segment: dead } } : {}) },
      ...res,
      { id: "P1", type: "meter", mode: "V", placement: free(36, 20) },
    ],
    wires: [
      { id: "W1", a: pin("G1", 0), b: hole("top-1"), color: "#1b1d20" },
      { id: "W2", a: pin("G1", 1), b: hole("top+1"), color: "#c8261f" },
      { id: "W3", a: hole("top+25"), b: hole("bot+25"), color: "#c8261f" },
      // Общий катод (выводы 3 и 8 соединены внутри) — на минус
      { id: "W4", a: hole("b12"), b: hole("top-10"), color: "#1b1d20" },
    ],
    boards: [{ id: "BB1", kind: "breadboard", x: 0, z: 0 }],
    career: { lesson: id },
  });
}

// ─── Мигалка на 555 ─────────────────────────────────────────────────────────

/** 555 генератором: RA 10 кОм, RB 68 кОм, C 10 мкФ (wrong — вместо него керамический 1 мкФ), светодиод через 330 Ом на выходе. */
export function blinker555Scene(id: string, wrong: boolean): Scene {
  const chip = refChip("DA1", "ref:ne555", false);
  const r = (rid: string, ohms: number, x: number, z: number): Component => ({ id: rid, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: free(x, z) });
  const P = (p: number) => pin("DA1", p - 1);
  const plus = pin("G1", 1), minus = pin("G1", 0);
  const w = (n: number, a: { comp: string; pin: number }, b: { comp: string; pin: number }, color = "#2f9e5a") => ({ id: `W${n}`, a, b, color });
  return repair({
    components: [
      { ...psu(), placement: free(-44, -4) },
      chip,
      r("R1", 10_000, -16, -12),
      r("R2", 68_000, -16, -2),
      { id: "C1", type: "capacitor", ...(wrong ? { variant: "ceramic" as const, uF: 1, volts: 50 } : { variant: "electrolytic" as const, uF: 10, volts: 16 }), placement: free(-14, 10) },
      r("R3", 330, 14, -6),
      { id: "HL1", type: "led", color: "red", placement: free(24, -6) },
      { id: "P1", type: "scope", timeDiv: 0.5, voltsDiv: [0, 0], placement: free(-4, 40) } as Component,
      { id: "P2", type: "meter", mode: "V", placement: free(36, 18) },
    ],
    wires: [
      w(1, plus, P(8), "#c8261f"), w(2, minus, P(1), "#1b1d20"), w(3, plus, P(4), "#c8261f"),
      w(4, plus, pin("R1", 0), "#c8261f"), w(5, pin("R1", 1), P(7)), w(6, P(7), pin("R2", 0)),
      w(7, pin("R2", 1), P(6)), w(8, P(6), P(2)), w(9, P(6), pin("C1", 0)), w(10, pin("C1", 1), minus, "#1b1d20"),
      w(11, P(3), pin("R3", 0), "#e3b21c"), w(12, pin("R3", 1), pin("HL1", 0), "#e3b21c"), w(13, pin("HL1", 1), minus, "#1b1d20"),
    ],
    boards: [],
    chips: chipsFor(["ref:ne555"]),
    career: { lesson: id },
  });
}

/** Период мигания светодиода (по току, с 1-й по 6-ю секунду), с; 0 — не мигает. */
export function ledPeriod(scene: Scene): number {
  const led = of(scene, "led")[0];
  if (!led) return 0;
  const sim = new Simulation(JSON.parse(JSON.stringify(scene)) as Scene);
  const me = sim.scene.components.find((c) => c.id === led.id)!;
  const dt = 0.005;
  const on: boolean[] = [];
  for (let t = 0; t < 6; t += dt) {
    sim.step(dt);
    on.push(Math.abs(sim.current(me)) > 0.002);
  }
  const tail = on.slice(Math.round(1 / dt));
  const rises: number[] = [];
  for (let i = 1; i < tail.length; i++) if (!tail[i - 1] && tail[i]) rises.push(i * dt);
  return rises.length >= 2 ? (rises.at(-1)! - rises[0]) / (rises.length - 1) : 0;
}

export const SMD_REPAIRS: Lesson[] = [
  {
    id: "fix-smd-crack",
    repair: true,
    title: "SMD-плата: не горит красный",
    about: "Плата под SMD, два одинаковых канала: резистор 0805 и светодиод. Зелёный горит, красный — нет. Детали исправны. Найдите место и почините.",
    hints: [
      "Пройдите вольтметром по цепи красного от плюса к минусу и сравните с зелёной: где напряжение ведёт себя иначе?",
      "Тонкая дорожка ломается от изгиба платы или перегрева при пайке — трещину не видно. Чем соединяют разорванную медь?",
    ],
    kit: [],
    start: () => smdLedScene("fix-smd-crack"),
    check(scene) {
      const { sim, hurt } = settle(scene);
      const leds = of(scene, "led");
      return [
        ...leds.map((l) => ({ text: `${l.id} горит нормально, 5–25 мА — сейчас ${mA(sim.current(l))}`, ok: ledOk(sim.current(l)) })),
        ...(leds.length === 2 ? [] : [{ text: "Оба светодиода на месте", ok: false }]),
        noHurt(hurt),
      ];
    },
  },
  {
    id: "fix-smd-fet",
    repair: true,
    title: "SMD-ключ не гаснет",
    about: "Ключ на полевом транзисторе в корпусе SOT-23: тумблер включён — светодиод горит, выключен — не горит. А он горит всегда, и тумблер ничего не меняет. Найдите причину и исправьте: в наборе есть запасное.",
    hints: [
      "Измерьте напряжение между затвором и истоком и между стоком и истоком при обоих положениях тумблера. Что из этого похоже на работающий ключ?",
      "Корпус SOT-23 у многих транзисторов одинаковый — различает их только код на корпусе. Сверьте с тем, что должно стоять в такой схеме.",
    ],
    kit: [{ part: "mosfet", kind: "2N7002", count: 1 }],
    start: () => smdSwitchScene("fix-smd-fet", "BSS84"),
    check(scene) {
      const r = switchLed(scene);
      if (!r) return [{ text: "Светодиод и тумблер на месте", ok: false }];
      return [
        { text: `Тумблер выключен — светодиод не горит (${mA(r.off)})`, ok: r.off < 0.001 },
        { text: `Тумблер включён — горит нормально, 5–25 мА (${mA(r.on)})`, ok: ledOk(r.on) },
        noHurt(r.hurt),
      ];
    },
  },
  {
    id: "fix-soic-bridge",
    repair: true,
    title: "Индикатор порога не горит",
    about: "Индикатор порога на LM393 (SO-8): светодиод должен гореть, пока на входе меньше половины питания (тумблер выключен — 0 В), и гаснуть при 5 В. А он не горит никогда. Микросхема и светодиод исправны.",
    hints: [
      "Измерьте напряжения на выводах второго канала (5, 6, 7) при обоих положениях тумблера. Каким должно быть напряжение на выходе, чтобы светодиод горел, и какое оно на самом деле?",
      "Выводы SOIC — через 1,27 мм. Посмотрите на плату поближе: всё ли соединено только так, как задумано?",
    ],
    kit: [],
    start: () => smdComparatorScene("fix-soic-bridge", true),
    check(scene) {
      const r = switchLed(scene);
      if (!r) return [{ text: "Светодиод и тумблер на месте", ok: false }];
      return [
        { text: `На входе 0 В — светодиод горит, 5–25 мА (${mA(r.off)})`, ok: ledOk(r.off) },
        { text: `На входе 5 В — не горит (${mA(r.on)})`, ok: r.on < 0.001 },
        noHurt(r.hurt),
      ];
    },
  },
  {
    id: "fix-display",
    repair: true,
    title: "Вместо 8 — девятка",
    about: "Все семь сегментов индикатора подключены через резисторы к плюсу — он должен показывать 8. А показывает 9. Найдите неисправность и устраните её: в наборе есть запасное.",
    hints: [
      "Сравните напряжения на резисторах и на сегментах у горящего и у тёмного сегмента.",
      "Если на резисторе ноль, а на сегменте — почти всё питание, ток через сегмент не идёт. Где тогда обрыв?",
    ],
    kit: [{ part: "other", type: "display", tool: "display", preset: {}, label: "индикатор SC56-11SRWA", count: 1 }],
    start: () => displayScene("fix-display", DISPLAY_SEGMENTS.findIndex((s) => s.name === "e")),
    check(scene) {
      const disp = of(scene, "display")[0];
      if (!disp) return [{ text: "Индикатор на месте", ok: false }];
      const { sim, hurt } = settle(scene);
      const me = sim.scene.components.find((c) => c.id === disp.id) as typeof disp;
      const steps: LessonStep[] = DISPLAY_SEGMENTS.slice(0, 7).map((s, k) => {
        const i = segmentCurrent(me, sim, k);
        return { text: `Сегмент ${s.name}: 3–20 мА — сейчас ${formatSI(Math.max(0, i), "А")}`, ok: i >= 0.003 && i <= 0.02 };
      });
      return [...steps, noHurt(hurt)];
    },
  },
  {
    id: "fix-555",
    repair: true,
    title: "Мигалка торопится",
    about: "Мигалка на 555 должна мигать раз в секунду, а мигает в несколько раз чаще. Все детали исправны. Найдите причину и исправьте: в наборе есть запасное.",
    hints: [
      "Посмотрите осциллографом на THRES и TRIG (выводы 6 и 2) и на выход: какой период получается, и от чего он зависит по даташиту?",
      "Период ≈ 0,693·(RA + 2RB)·C. Сверьте номиналы на столе с тем, что нужно для одной секунды.",
    ],
    kit: [{ part: "other", type: "capacitor", tool: "cap", preset: { variant: "electrolytic", electrolyticUF: 10, electrolyticV: 16 }, match: { variant: "electrolytic", uF: 10 }, label: "конденсатор 10 мкФ", count: 1 }] satisfies KitItem[],
    start: () => blinker555Scene("fix-555", true),
    check(scene) {
      const period = ledPeriod(scene);
      return [
        { text: `Мигает раз в 0,8–1,3 с — сейчас ${period ? formatSI(period, "с") : "не мигает"}`, ok: period >= 0.8 && period <= 1.3 },
        noHurt(settle(scene).hurt),
      ];
    },
  },
];
