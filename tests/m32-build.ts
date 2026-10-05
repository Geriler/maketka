/** Эталон «М2 на 32 бита»: «Длинные программы», где всё, что с данными, — вчетверо шире. */
import type { Component, Endpoint, Scene } from "../src/model/types";
import { applyBoards } from "../src/model/breadboard";
import { EEPROM_ID, SRAM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU32_OUT, M32_PROGRAM, PROJECTS } from "../src/career/projects";
import { MICROCODE } from "./mem-build";
import { P, allChips } from "./module-build";

export const proj = PROJECTS.find((p) => p.id === "proj-m32")!;
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};
const ADDR28 = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO28 = [11, 12, 13, 15, 16, 17, 18, 19];
const MUXC = [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]];
const BUF = [[2, 18], [4, 16], [6, 14], [8, 12], [17, 3], [15, 5], [13, 7], [11, 9]];
const byte = (k: number) => M32_PROGRAM.n.map((w) => Math.floor(w / 2 ** (8 * k)) % 256);

export function m32(microcode: number[] = MICROCODE, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const CLK: Endpoint = { hole: CPU_PINS.clk }, RST: Endpoint = { hole: CPU_PINS.rst };
  const B = [0, 1, 2, 3];
  const ors = Array.from({ length: 30 }, (_, k) => `Z${k}`);
  const xors = Array.from({ length: 32 }, (_, k) => `X${k}`);
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("PH", "ref:hc161"), chip("RO", EEPROM_ID, M32_PROGRAM.op), ...B.map((k) => chip(`RN${k}`, EEPROM_ID, byte(k))), chip("DE", EEPROM_ID, microcode),
    ...B.map((k) => chip(`RM${k}`, SRAM_ID)), ...B.map((k) => chip(`BF${k}`, "ref:hc244")), ...Array.from({ length: 8 }, (_, k) => chip(`MX${k}`, "ref:hc157")),
    chip("FC", "ref:dffr"), chip("MC", "ref:mux"), chip("N1", "ref:not-cmos"), chip("N2", "ref:not-cmos"), chip("O1", "ref:or"), ...ors.map((id) => chip(id, "ref:or")), chip("ZN", "ref:nor-cmos"), ...xors.map((id) => chip(id, "ref:xor")),
    ...Array.from({ length: 8 }, (_, s): Component => ({ id: `M${s}`, type: "chip", def: "ref:slice2", name: "Срез 2", package: "SIP", pins: 24, placement: f }) as Component),
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const id of ["PC", "PH", ...Array.from({ length: 8 }, (_, k) => `MX${k}`)]) w.push([plus, P(id, 16)], [minus, P(id, 8)]);
  for (const id of ["RO", "DE", ...B.map((k) => `RN${k}`), ...B.map((k) => `RM${k}`)]) w.push([plus, P(id, 28)], [minus, P(id, 14)]);
  for (const k of B) w.push([plus, P(`BF${k}`, 20)], [minus, P(`BF${k}`, 10)]);
  for (const id of ["N1", "N2", "O1", ...ors, "ZN", ...xors]) w.push([plus, P(id, 5)], [minus, P(id, 3)]);
  for (const id of ["FC", "MC"]) w.push([plus, P(id, 5)], [minus, P(id, 2)]);
  const io = IO28.map((p) => P("DE", p));
  const [nWA, nWO, SEL, nLD, SUB, CNT, MEM, nST] = io;
  const nq = (k: number) => P(`RN${k >> 3}`, IO28[k & 7]);
  // Счётчик команд — как в «Длинных программах»: адрес перехода — младший байт N
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [CNT, P("PC", 7)], [plus, P("PC", 10)], [nLD, P("PC", 9)]);
  w.push([CLK, P("PH", 2)], [P("N1", 4), P("PH", 1)], [CNT, P("PH", 7)], [P("PC", 15), P("PH", 10)], [nLD, P("PH", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([nq(k), P("PC", p)], [nq(4 + k), P("PH", p)]));
  for (const r of ["RO", ...B.map((k) => `RN${k}`)]) {
    [14, 13, 12, 11].forEach((qp, k) => w.push([P("PC", qp), P(r, ADDR28[k])], [P("PH", qp), P(r, ADDR28[4 + k])]));
    for (const a of ADDR28.slice(8)) w.push([minus, P(r, a)]);
    w.push([minus, P(r, 20)], [minus, P(r, 22)], [plus, P(r, 27)]);
  }
  // Декодер
  [4, 5, 6, 7].forEach((k, i) => w.push([P("RO", IO28[k]), P("DE", ADDR28[i])]));
  w.push([P("FC", 4), P("DE", ADDR28[4])], [P("ZN", 4), P("DE", ADDR28[5])]);
  for (const a of ADDR28.slice(6)) w.push([minus, P("DE", a)]);
  w.push([minus, P("DE", 20)], [minus, P("DE", 22)], [plus, P("DE", 27)]);
  // Флаг C — перенос из старшего модуля
  w.push([P("M7", 12), P("MC", 1)], [P("FC", 4), P("MC", 3)], [SEL, P("MC", 6)], [P("MC", 4), P("FC", 3)], [CLK, P("FC", 1)], [P("N1", 4), P("FC", 6)]);
  // ОЗУ: четыре по байту, адрес — младший байт N, управление общее
  w.push([nST, P("N2", 2)], [CLK, P("O1", 1)], [nST, P("O1", 2)]);
  const aBit = (k: number) => P(`M${k >> 2}`, 17 + (k & 3));
  for (const b of B) {
    const rm = `RM${b}`, bf = `BF${b}`;
    for (let k = 0; k < 8; k++) w.push([nq(k), P(rm, ADDR28[k])]);
    for (const a of ADDR28.slice(8)) w.push([minus, P(rm, a)]);
    w.push([minus, P(rm, 20)], [P("N2", 4), P(rm, 22)], [P("O1", 4), P(rm, 27)], [nST, P(bf, 1)], [nST, P(bf, 19)]);
    BUF.forEach(([a, y], k) => w.push([aBit(8 * b + k), P(bf, a)], [P(bf, y), P(rm, IO28[k])]));
  }
  // Второе слагаемое и вычитание — по 32 разрядам
  for (let k = 0; k < 32; k++) {
    const m = `MX${k >> 2}`, [i0, i1, y] = MUXC[k & 3];
    w.push([nq(k), P(m, i0)], [P(`RM${k >> 3}`, IO28[k & 7]), P(m, i1)], [P(m, y), P(`X${k}`, 1)], [SUB, P(`X${k}`, 2)]);
  }
  for (let k = 0; k < 8; k++) w.push([MEM, P(`MX${k}`, 1)], [minus, P(`MX${k}`, 15)]);
  // «A = 0»: дерево ИЛИ 32 → 16 → 8 → 4 → 2, ИЛИ-НЕ
  let level: Endpoint[] = Array.from({ length: 32 }, (_, k) => aBit(k));
  let g = 0;
  while (level.length > 2) {
    const next: Endpoint[] = [];
    for (let i = 0; i < level.length; i += 2) { const id = `Z${g++}`; w.push([level[i], P(id, 1)], [level[i + 1], P(id, 2)]); next.push(P(id, 4)); }
    level = next;
  }
  w.push([level[0], P("ZN", 1)], [level[1], P("ZN", 2)]);
  // Модули
  for (let s = 0; s < 8; s++) {
    const m = `M${s}`;
    [0, 1, 2, 3].forEach((k) => w.push([P(`X${4 * s + k}`, 4), P(m, k + 1)], [P(m, 13 + k), { hole: CPU32_OUT[4 * s + k] }]));
    w.push([SEL, P(m, 5)], [CLK, P(m, 6)], [RST, P(m, 7)], [nWA, P(m, 8)], [nWO, P(m, 9)], [minus, P(m, 10)], [plus, P(m, 24)]);
    if (s) w.push([P(`M${s - 1}`, 12), P(m, 11)]);
  }
  w.push([SUB, P("M0", 11)]);
  const sc = proj.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
