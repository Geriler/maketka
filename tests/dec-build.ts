/** Эталон «Декодера команд»: программа М2 в двух ПЗУ, микрокод в EEPROM, числа — на двух модулях «Срез». */
import type { Component, Endpoint, Scene } from "../src/model/types";
import { applyBoards } from "../src/model/breadboard";
import { EEPROM_ID, PROM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU8_OUT, DEC_PROGRAM, PROJECTS } from "../src/career/projects";
import { P, allChips } from "./module-build";

export const proj = PROJECTS.find((p) => p.id === "proj-dec")!;
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};

/** Сигналы в байте микрокода: бит 0 — W̅A̅, 1 — W̅O̅, 2 — SEL (A + N), 3 — L̅O̅A̅D̅ счётчика; все — какими идут на выводы. */
export const IDLE = 0b1011;
/** Микрокод по коду операции: NOP, LDI, ADDI, OUT, JMP; остальные — покой. */
export const MICROCODE = Array.from({ length: 16 }, (_, op) => ({ 0: IDLE, 1: 0b1010, 4: 0b1110, 8: 0b1001, 9: 0b0011 })[op] ?? IDLE);

const ADDR28 = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO28 = [11, 12, 13, 15, 16, 17, 18, 19];
const Q = [1, 2, 3, 4, 5, 6, 7, 9];

export function dec(microcode: number[] | undefined = MICROCODE, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const CLK: Endpoint = { hole: CPU_PINS.clk }, RST: Endpoint = { hole: CPU_PINS.rst };
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("RO", PROM_ID, DEC_PROGRAM.op), chip("RN", PROM_ID, DEC_PROGRAM.n), chip("DE", EEPROM_ID, microcode), chip("N1", "ref:not-cmos"),
    ...[0, 1].map((s): Component => ({ id: `M${s}`, type: "chip", def: "ref:slice", name: "Срез 4 бит", package: "SIP", pins: 20, placement: f }) as Component),
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const id of ["PC", "RO", "RN"]) w.push([plus, P(id, 16)], [minus, P(id, 8)]);
  w.push([plus, P("DE", 28)], [minus, P("DE", 14)], [plus, P("N1", 5)], [minus, P("N1", 3)]);
  // Счётчик команд: такт, сброс через инвертор, счёт всегда, загрузка — от декодера, адрес перехода — N0…N3
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [plus, P("PC", 7)], [plus, P("PC", 10)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([P("RN", Q[k]), P("PC", p)]));
  // Оба ПЗУ — по адресу из счётчика
  for (const r of ["RO", "RN"]) {
    [14, 13, 12, 11].forEach((qp, k) => w.push([P("PC", qp), P(r, 10 + k)]));
    w.push([minus, P(r, 14)], [minus, P(r, 15)]);
  }
  // Декодер: адрес — код операции (Q4…Q7 ПЗУ команд), всегда читается
  [4, 5, 6, 7].forEach((k, i) => w.push([P("RO", Q[k]), P("DE", ADDR28[i])]));
  for (const a of ADDR28.slice(4)) w.push([minus, P("DE", a)]);
  w.push([minus, P("DE", 20)], [minus, P("DE", 22)], [plus, P("DE", 27)]);
  const io = IO28.map((p) => P("DE", p));
  w.push([io[3], P("PC", 9)]);
  // Модули: N, управление от декодера, такт, сброс, перенос цепочкой, выход
  for (let s = 0; s < 2; s++) {
    const m = `M${s}`;
    [0, 1, 2, 3].forEach((k) => w.push([P("RN", Q[4 * s + k]), P(m, k + 1)], [P(m, 13 + k), { hole: CPU8_OUT[4 * s + k] }]));
    w.push([io[2], P(m, 5)], [CLK, P(m, 6)], [RST, P(m, 7)], [io[0], P(m, 8)], [io[1], P(m, 9)], [minus, P(m, 10)], [plus, P(m, 20)]);
  }
  w.push([minus, P("M0", 11)], [P("M0", 12), P("M1", 11)]);
  const sc = proj.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
