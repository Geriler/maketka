/** Эталон «Переноса и условного перехода»: «Декодер» плюс вычитание (XOR на N и CI), флаг C и HLT. */
import type { Component, Endpoint, Scene } from "../src/model/types";
import { applyBoards } from "../src/model/breadboard";
import { EEPROM_ID, PROM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU8_OUT, FLAGS_PROGRAM, PROJECTS } from "../src/career/projects";
import { P, allChips } from "./module-build";

export const proj = PROJECTS.find((p) => p.id === "proj-flags")!;
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};

/** Биты микрокода: 0 W̅A̅, 1 W̅O̅, 2 SEL, 3 L̅O̅A̅D̅, 4 SUB, 5 запись флага, 6 счёт (ENP). Адрес: код операции + 16 × C. */
export const IDLE = 0b1001011;
const BY_OP: Record<number, number> = { 0: IDLE, 1: 0b1001010, 4: 0b1101110, 5: 0b1111110, 8: 0b1001001, 9: 0b1000011, 15: 0b0001011 };
export const MICROCODE = Array.from({ length: 32 }, (_, a) => {
  const op = a & 15, c = a >> 4;
  if (op === 10) return c ? 0b1000011 : IDLE;
  return BY_OP[op] ?? IDLE;
});

const ADDR28 = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO28 = [11, 12, 13, 15, 16, 17, 18, 19];
const Q = [1, 2, 3, 4, 5, 6, 7, 9];

export function flags(microcode: number[] = MICROCODE, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const CLK: Endpoint = { hole: CPU_PINS.clk }, RST: Endpoint = { hole: CPU_PINS.rst };
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("RO", PROM_ID, FLAGS_PROGRAM.op), chip("RN", PROM_ID, FLAGS_PROGRAM.n), chip("DE", EEPROM_ID, microcode), chip("N1", "ref:not-cmos"),
    chip("FC", "ref:dffr"), chip("MC", "ref:mux"), ...Array.from({ length: 8 }, (_, k) => chip(`X${k}`, "ref:xor")),
    ...[0, 1].map((s): Component => ({ id: `M${s}`, type: "chip", def: "ref:slice", name: "Срез 4 бит", package: "SIP", pins: 20, placement: f }) as Component),
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const id of ["PC", "RO", "RN"]) w.push([plus, P(id, 16)], [minus, P(id, 8)]);
  w.push([plus, P("DE", 28)], [minus, P("DE", 14)]);
  for (const id of ["N1", ...Array.from({ length: 8 }, (_, k) => `X${k}`)]) w.push([plus, P(id, 5)], [minus, P(id, 3)]);
  for (const id of ["FC", "MC"]) w.push([plus, P(id, 5)], [minus, P(id, 2)]);
  const io = IO28.map((p) => P("DE", p));
  // Счётчик команд: счёт — по разрешению из декодера (HLT его снимает), загрузка — из декодера
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [io[6], P("PC", 7)], [plus, P("PC", 10)], [io[3], P("PC", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([P("RN", Q[k]), P("PC", p)]));
  for (const r of ["RO", "RN"]) {
    [14, 13, 12, 11].forEach((qp, k) => w.push([P("PC", qp), P(r, 10 + k)]));
    w.push([minus, P(r, 14)], [minus, P(r, 15)]);
  }
  // Декодер: адрес — код операции и флаг C
  [4, 5, 6, 7].forEach((k, i) => w.push([P("RO", Q[k]), P("DE", ADDR28[i])]));
  w.push([P("FC", 4), P("DE", ADDR28[4])]);
  for (const a of ADDR28.slice(5)) w.push([minus, P("DE", a)]);
  w.push([minus, P("DE", 20)], [minus, P("DE", 22)], [plus, P("DE", 27)]);
  // Флаг C: по такту берёт перенос, если запись разрешена, иначе себя; RST обнуляет
  w.push([P("M1", 12), P("MC", 1)], [P("FC", 4), P("MC", 3)], [io[5], P("MC", 6)], [P("MC", 4), P("FC", 3)], [CLK, P("FC", 1)], [P("N1", 4), P("FC", 6)]);
  // Вычитание: N через XOR с SUB, перенос в младший модуль — SUB
  for (let k = 0; k < 8; k++) w.push([P("RN", Q[k]), P(`X${k}`, 1)], [io[4], P(`X${k}`, 2)]);
  for (let s = 0; s < 2; s++) {
    const m = `M${s}`;
    [0, 1, 2, 3].forEach((k) => w.push([P(`X${4 * s + k}`, 4), P(m, k + 1)], [P(m, 13 + k), { hole: CPU8_OUT[4 * s + k] }]));
    w.push([io[2], P(m, 5)], [CLK, P(m, 6)], [RST, P(m, 7)], [io[0], P(m, 8)], [io[1], P(m, 9)], [minus, P(m, 10)], [plus, P(m, 20)]);
  }
  w.push([io[4], P("M0", 11)], [P("M0", 12), P("M1", 11)]);
  const sc = proj.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
