/**
 * Эталон «Памяти и проверки на ноль»: «Перенос и условный переход» плюс ОЗУ данных (адрес — N),
 * 74HC244 выдаёт A на шину ОЗУ при ST, два 74HC157 выбирают второе слагаемое (ПЗУ или ОЗУ),
 * «A = 0» — дерево ИЛИ и ИЛИ-НЕ на адрес декодера.
 */
import type { Component, Endpoint, Scene } from "../src/model/types";
import { applyBoards } from "../src/model/breadboard";
import { EEPROM_ID, PROM_ID, SRAM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU8_OUT, MEM_PROGRAM, PROJECTS } from "../src/career/projects";
import { P, allChips } from "./module-build";

export const proj = PROJECTS.find((p) => p.id === "proj-mem")!;
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};

/** Биты микрокода: 0 W̅A̅, 1 W̅O̅, 2 SEL (и запись флага C), 3 L̅O̅A̅D̅, 4 SUB, 5 счёт, 6 операнд из ОЗУ, 7 S̅T̅. Адрес: код + 16 × C + 32 × (A = 0). */
export const IDLE = 0b10101011;
const BY_OP: Record<number, number> = { 0: IDLE, 1: 0xaa, 2: 0xea, 3: 0x2b, 4: 0xae, 5: 0xbe, 6: 0xee, 7: 0xfe, 8: 0xa9, 9: 0xa3, 15: 0x8b };
export const MICROCODE = Array.from({ length: 64 }, (_, a) => {
  const op = a & 15, c = (a >> 4) & 1, z = a >> 5;
  if (op === 10) return c ? 0xa3 : IDLE;
  if (op === 11) return z ? 0xa3 : IDLE;
  if (op === 12) return z ? IDLE : 0xa3;
  return BY_OP[op] ?? IDLE;
});

const ADDR28 = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO28 = [11, 12, 13, 15, 16, 17, 18, 19];
const Q = [1, 2, 3, 4, 5, 6, 7, 9];
/** 74HC157: каналы (I0, I1, Y). */
const MUXC = [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]];
/** 74HC244: бит k (0…7) — вход A, выход Y. */
const BUF = [[2, 18], [4, 16], [6, 14], [8, 12], [17, 3], [15, 5], [13, 7], [11, 9]];

export function mem(microcode: number[] = MICROCODE, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const CLK: Endpoint = { hole: CPU_PINS.clk }, RST: Endpoint = { hole: CPU_PINS.rst };
  const gates = ["N1", "N2", "O1", ...Array.from({ length: 6 }, (_, k) => `Z${k}`), "ZN", ...Array.from({ length: 8 }, (_, k) => `X${k}`)];
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("RO", PROM_ID, MEM_PROGRAM.op), chip("RN", PROM_ID, MEM_PROGRAM.n), chip("DE", EEPROM_ID, microcode), chip("RM", SRAM_ID),
    chip("BF", "ref:hc244"), chip("MA", "ref:hc157"), chip("MB", "ref:hc157"), chip("FC", "ref:dffr"), chip("MC", "ref:mux"),
    chip("N1", "ref:not-cmos"), chip("N2", "ref:not-cmos"), chip("O1", "ref:or"), ...Array.from({ length: 6 }, (_, k) => chip(`Z${k}`, "ref:or")), chip("ZN", "ref:nor-cmos"),
    ...Array.from({ length: 8 }, (_, k) => chip(`X${k}`, "ref:xor")),
    ...[0, 1].map((s): Component => ({ id: `M${s}`, type: "chip", def: "ref:slice2", name: "Срез 2", package: "SIP", pins: 24, placement: f }) as Component),
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const id of ["PC", "RO", "RN", "MA", "MB"]) w.push([plus, P(id, 16)], [minus, P(id, 8)]);
  for (const id of ["DE", "RM"]) w.push([plus, P(id, 28)], [minus, P(id, 14)]);
  w.push([plus, P("BF", 20)], [minus, P("BF", 10)]);
  for (const id of gates) w.push([plus, P(id, 5)], [minus, P(id, 3)]);
  for (const id of ["FC", "MC"]) w.push([plus, P(id, 5)], [minus, P(id, 2)]);
  const io = IO28.map((p) => P("DE", p));
  const [nWA, nWO, SEL, nLD, SUB, CNT, MEM, nST] = io;
  // Счётчик команд
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [CNT, P("PC", 7)], [plus, P("PC", 10)], [nLD, P("PC", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([P("RN", Q[k]), P("PC", p)]));
  for (const r of ["RO", "RN"]) {
    [14, 13, 12, 11].forEach((qp, k) => w.push([P("PC", qp), P(r, 10 + k)]));
    w.push([minus, P(r, 14)], [minus, P(r, 15)]);
  }
  // Декодер: код операции, C, «A = 0»
  [4, 5, 6, 7].forEach((k, i) => w.push([P("RO", Q[k]), P("DE", ADDR28[i])]));
  w.push([P("FC", 4), P("DE", ADDR28[4])], [P("ZN", 4), P("DE", ADDR28[5])]);
  for (const a of ADDR28.slice(6)) w.push([minus, P("DE", a)]);
  w.push([minus, P("DE", 20)], [minus, P("DE", 22)], [plus, P("DE", 27)]);
  // Флаг C
  w.push([P("M1", 12), P("MC", 1)], [P("FC", 4), P("MC", 3)], [SEL, P("MC", 6)], [P("MC", 4), P("FC", 3)], [CLK, P("FC", 1)], [P("N1", 4), P("FC", 6)]);
  // ОЗУ: адрес — N, читается всегда, кроме ST; пишется при ST, пока CLK = 0
  Q.forEach((q, k) => w.push([P("RN", q), P("RM", ADDR28[k])]));
  for (const a of ADDR28.slice(8)) w.push([minus, P("RM", a)]);
  w.push([minus, P("RM", 20)], [nST, P("N2", 2)], [P("N2", 4), P("RM", 22)], [CLK, P("O1", 1)], [nST, P("O1", 2)], [P("O1", 4), P("RM", 27)]);
  // 74HC244: A на шину ОЗУ при ST
  w.push([nST, P("BF", 1)], [nST, P("BF", 19)]);
  const aBit = (k: number) => P(`M${k >> 2}`, 17 + (k & 3));
  BUF.forEach(([a, y], k) => w.push([aBit(k), P("BF", a)], [P("BF", y), P("RM", IO28[k])]));
  // Второе слагаемое: N или RAM[N]; потом XOR (вычитание)
  for (let k = 0; k < 8; k++) {
    const m = k < 4 ? "MA" : "MB", [i0, i1, y] = MUXC[k & 3];
    w.push([P("RN", Q[k]), P(m, i0)], [P("RM", IO28[k]), P(m, i1)], [P(m, y), P(`X${k}`, 1)], [SUB, P(`X${k}`, 2)]);
  }
  for (const m of ["MA", "MB"]) w.push([MEM, P(m, 1)], [minus, P(m, 15)]);
  // «A = 0»: ИЛИ по парам, по четвёркам, ИЛИ-НЕ всех
  [0, 1, 2, 3].forEach((g) => w.push([aBit(2 * g), P(`Z${g}`, 1)], [aBit(2 * g + 1), P(`Z${g}`, 2)]));
  w.push([P("Z0", 4), P("Z4", 1)], [P("Z1", 4), P("Z4", 2)], [P("Z2", 4), P("Z5", 1)], [P("Z3", 4), P("Z5", 2)], [P("Z4", 4), P("ZN", 1)], [P("Z5", 4), P("ZN", 2)]);
  // Модули «Срез 2»
  for (let s = 0; s < 2; s++) {
    const m = `M${s}`;
    [0, 1, 2, 3].forEach((k) => w.push([P(`X${4 * s + k}`, 4), P(m, k + 1)], [P(m, 13 + k), { hole: CPU8_OUT[4 * s + k] }]));
    w.push([SEL, P(m, 5)], [CLK, P(m, 6)], [RST, P(m, 7)], [nWA, P(m, 8)], [nWO, P(m, 9)], [minus, P(m, 10)], [plus, P(m, 24)]);
  }
  w.push([SUB, P("M0", 11)], [P("M0", 12), P("M1", 11)]);
  const sc = proj.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
