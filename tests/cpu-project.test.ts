import { describe, expect, it } from "vitest";
import { setLibrary, setReference } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Component, Endpoint, Scene } from "../src/model/types";
import { referenceChips } from "../src/career/build";
import { memoryChips, PROM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU_PROGRAM, PROJECTS, cpuEmulate } from "../src/career/projects";
import { kitTools } from "../src/career/session";
import cpuSmd from "./fixtures/cpu-smd.json";

setLibrary([]);
const refs = [...referenceChips(), ...memoryChips()];
setReference(refs);
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};
const P = (id: string, p: number): Endpoint => ({ comp: id, pin: p - 1 });
const plus: Endpoint = { comp: "G1", pin: 1 };
const minus: Endpoint = { comp: "G1", pin: 0 };
const CLK: Endpoint = { hole: CPU_PINS.clk };
const RST: Endpoint = { hole: CPU_PINS.rst };

/** Процессор из описания; mutate — поправить провода (для неверных сборок). */
function cpu(program: number[], mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("ROM", PROM_ID, program), chip("RA", "ref:hc173"), chip("RO", "ref:hc173"),
    chip("AD", "ref:hc283"), chip("MX", "ref:hc157"), chip("N1", "ref:not-cmos"), chip("N2", "ref:not-cmos"), chip("N3", "ref:not-cmos"), chip("N4", "ref:not-cmos"),
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const id of ["PC", "ROM", "RA", "RO", "AD", "MX"]) w.push([plus, P(id, 16)], [minus, P(id, 8)]);
  for (const id of ["N1", "N2", "N3", "N4"]) w.push([plus, P(id, 5)], [minus, P(id, 3)]);
  const imm = [1, 2, 3, 4].map((p) => P("ROM", p));
  // Счётчик команд: такт, сброс (через инвертор), счёт всегда, загрузка — по биту 7
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [plus, P("PC", 7)], [plus, P("PC", 10)]);
  w.push([P("ROM", 9), P("N2", 2)], [P("N2", 4), P("PC", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([imm[k], P("PC", p)]));
  // ПЗУ: адрес от счётчика, A4 и G̅ — к общему
  [14, 13, 12, 11].forEach((q, k) => w.push([P("PC", q), P("ROM", 10 + k)]));
  w.push([minus, P("ROM", 14)], [minus, P("ROM", 15)]);
  // Сумматор: A + N, перенос на входе — ноль
  [5, 3, 14, 12].forEach((p, k) => w.push([P("RA", 3 + k), P("AD", p)]));
  [6, 2, 15, 11].forEach((p, k) => w.push([imm[k], P("AD", p)]));
  w.push([minus, P("AD", 7)]);
  const sum = [4, 1, 13, 10].map((p) => P("AD", p));
  // Мультиплексор: S — бит 4; I0 — N, I1 — сумма; выход — на D регистра A
  w.push([P("ROM", 5), P("MX", 1)], [minus, P("MX", 15)]);
  [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].forEach(([i0, i1, y], k) => w.push([imm[k], P("MX", i0)], [sum[k], P("MX", i1)], [P("MX", y), P("RA", 14 - k)]));
  // Регистры: такт, сброс, выходы всегда включены; запись A — по биту 5, вывод — по биту 6
  for (const id of ["RA", "RO"]) w.push([CLK, P(id, 7)], [RST, P(id, 15)], [minus, P(id, 1)], [minus, P(id, 2)], [minus, P(id, 10)]);
  w.push([P("ROM", 6), P("N3", 2)], [P("N3", 4), P("RA", 9)]);
  w.push([P("ROM", 7), P("N4", 2)], [P("N4", 4), P("RO", 9)]);
  [0, 1, 2, 3].forEach((k) => w.push([P("RA", 3 + k), P("RO", 14 - k)], [P("RO", 3 + k), { hole: CPU_PINS.out[k] }]));
  const s = PROJECTS.find((p) => p.id === "proj-cpu")!.start();
  s.components.push(...comps);
  s.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  s.chips = allChips;
  applyBoards(s.boards!);
  return s;
}
const check = (s: Scene) => PROJECTS.find((p) => p.id === "proj-cpu")!.check(s);
const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const same = (a: Endpoint, b: Endpoint) => JSON.stringify(a) === JSON.stringify(b);

describe("проект «Процессор»", () => {
  it("эмулятор: по командам вручную", () => {
    // 1: A=10; 2: A=15; 3: вывод 15, A=0 (перенос); 4: A=14; 5: вывод 14, A=5; 6: на 15; 7: вывод 5, на 1; 8: A=10; 9: вывод 10, A=11
    expect(cpuEmulate(CPU_PROGRAM, 9)).toEqual([0, 0, 15, 15, 14, 14, 5, 5, 10]);
  });
  it("эталон проходит", () => {
    const t0 = performance.now();
    const steps = check(cpu(CPU_PROGRAM));
    console.log(Math.round(performance.now() - t0), "мс\n" + text(steps));
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
  }, 300000);
  it("не та программа — сразу говорит об этом", () => {
    const steps = check(cpu(CPU_PROGRAM.map((w, a) => (a === 2 ? 0x70 : w))));
    expect(steps[0].ok).toBe(false);
    expect(steps[0].text).toContain("2 → 70");
  }, 60000);
  it("разрешение записи A без инвертора — не проходит", () => {
    const steps = check(cpu(CPU_PROGRAM, (w) => w.map(([a, b]): [Endpoint, Endpoint] => (same(a, P("N3", 4)) && same(b, P("RA", 9)) ? [P("ROM", 6), b] : [a, b]))));
    expect(steps.every((x) => x.ok), text(steps)).toBe(false);
  }, 300000);
  // Выводы ПЗУ 1…7 — Q0…Q6: бит 4 — вывод 5, бит 5 — вывод 6, бит 6 — вывод 7, бит 7 — вывод 9
  for (const [bit, pin] of [[5, 6], [6, 7], [7, 9]]) {
    it(`выбор «N или A + N» по биту ${bit} вместо 4 — не проходит`, () => {
      const steps = check(cpu(CPU_PROGRAM, (w) => w.map(([a, b]): [Endpoint, Endpoint] => (same(a, P("ROM", 5)) && same(b, P("MX", 1)) ? [P("ROM", pin), b] : [a, b]))));
      expect(steps.every((x) => x.ok), text(steps)).toBe(false);
    }, 300000);
  }
  // Обрывы, которых прежняя программа не замечала: младший бит, биты загрузки счётчика, висящее разрешение
  const drop = (a: Endpoint, b: Endpoint) => (w: [Endpoint, Endpoint][]) => w.filter(([x, y]) => !(same(x, a) && same(y, b)));
  for (const [what, a, b] of [
    ["D3 загрузки счётчика (PC.6)", P("ROM", 4), P("PC", 6)],
    ["выход OUT0", P("RO", 3), { hole: CPU_PINS.out[0] }],
    ["A0 на вход сумматора", P("RA", 3), P("AD", 5)],
    ["N2 на вход мультиплексора", P("ROM", 3), P("MX", 11)],
  ] as [string, Endpoint, Endpoint][]) {
    it(`без провода «${what}» — не проходит`, () => {
      // Висящий вход ловит свой шаг; здесь важно, что и сама программа замечает обрыв
      const steps = check(cpu(CPU_PROGRAM, drop(a, b)));
      expect(steps.find((x) => x.text.startsWith("Такт за тактом"))?.ok, text(steps)).toBe(false);
    }, 300000);
  }
  it("разрешение выхода регистра не подключено — вход висит в воздухе, не проходит", () => {
    const steps = check(cpu(CPU_PROGRAM, drop(minus, P("RA", 1))));
    const step = steps.find((x) => x.text.includes("висят"));
    expect(step?.ok).toBe(false);
    expect(step?.text).toContain("RA.1");
  }, 300000);
  it("вывод по биту записи (5 вместо 6) — не проходит", () => {
    const steps = check(cpu(CPU_PROGRAM, (w) => w.map(([a, b]): [Endpoint, Endpoint] => (same(a, P("ROM", 7)) && same(b, P("N4", 2)) ? [P("ROM", 6), b] : [a, b]))));
    expect(steps.every((x) => x.ok), text(steps)).toBe(false);
  }, 300000);

  // Разводка на двусторонней плате под SMD (сделана скриптом-трассировщиком): дорожки сверху, где
  // сверху не пройти — снизу, между сторонами — переходы. Микросхемы в ней — «career:…» (открытые
  // игроком), здесь — эталонные «ref:…».
  const smdBuild = (drop?: string): Scene => {
    const s = PROJECTS.find((p) => p.id === "proj-cpu")!.start();
    s.boards = [structuredClone(cpuSmd.board) as NonNullable<Scene["boards"]>[number]];
    s.components.push(...(structuredClone(cpuSmd.components) as Component[]).map((c) => (c.type === "chip" ? { ...c, def: c.def.replace(/^career:/, "ref:") } : c)));
    s.traces = (structuredClone(cpuSmd.traces) as NonNullable<Scene["traces"]>).filter((t) => t.id !== drop);
    s.wires.push(...(structuredClone(cpuSmd.wires) as Scene["wires"]).filter((w) => w.id !== drop));
    s.chips = allChips;
    applyBoards(s.boards!);
    return s;
  };
  it("разводка: плата двусторонняя, микросхемы в SOIC/SOT-23, перемычек нет, нижние дорожки — между переходами, выходы — на J6…J9", () => {
    const s = smdBuild();
    expect(s.boards![0].kind).toBe("smd");
    expect(s.boards![0].layers).toBe(2);
    const chips = s.components.filter((c) => c.type === "chip") as (Component & { package: string; smd?: boolean })[];
    expect(chips.length).toBe(10);
    expect(chips.every((c) => c.placement.mode === "board" && (c.package !== "DIP" || c.smd === true))).toBe(true);
    expect(cpuSmd.wires).toEqual([]);
    const bottom = s.traces!.filter((t) => t.side === "bottom");
    expect(bottom.length).toBeGreaterThan(0);
    const vias = new Set(s.boards![0].seats!.filter((x) => x.fp === "VIA").map((x) => `s:${x.id}.1`));
    expect(bottom.every((t) => vias.has(t.a) && vias.has(t.b))).toBe(true);
    expect(CPU_PINS.out).toEqual(["s:J6", "s:J7", "s:J8", "s:J9"]);
  });
  it("разводка на плате под SMD проходит проверку", () => {
    const steps = check(smdBuild());
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
  }, 300000);
  it("разводка без одной нижней дорожки — не проходит", () => {
    const steps = check(smdBuild("TB5"));
    expect(steps.every((x) => x.ok), text(steps)).toBe(false);
  }, 300000);
  it("дорожка поперёк чужой площадки (J1 → J3 через J2) — медь замкнула цепи, не проходит", () => {
    const s = smdBuild();
    s.traces!.push({ id: "TRX", a: "s:J1", b: "s:J3" });
    const steps = check(s);
    const step = steps.find((x) => x.text.startsWith("Медь"));
    expect(step?.ok, text(steps)).toBe(false);
    expect(step?.text).toContain("J2");
  }, 300000);
  it("набор проекта на плате под SMD: резисторы 0805, ПЗУ — в SOIC", () => {
    const s = PROJECTS.find((p) => p.id === "proj-cpu")!.start();
    applyBoards(s.boards!);
    const made = kitTools(s).map((t) => t.def.create(t.def.settings) as Component & { smd?: boolean; variant?: string; smdSize?: string });
    const res = made.filter((c) => c.type === "resistor");
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((c) => c.variant === "smd" && c.smdSize === "0805")).toBe(true);
    const prom = made.filter((c) => c.type === "chip" && c.def === PROM_ID);
    expect(prom.length).toBe(1);
    expect(prom[0].smd).toBe(true);
  });
});
