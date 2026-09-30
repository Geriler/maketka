/** Эталонный 8-битный процессор для тестов и перебора обрывов. */
import { setLibrary, setReference } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Component, Endpoint, Scene } from "../src/model/types";
import { referenceChips } from "../src/career/build";
import { memoryChips, PROM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU8_OUT, CPU8_PROGRAM, PROJECTS } from "../src/career/projects";

setLibrary([]);
const refs = [...referenceChips(), ...memoryChips()];
setReference(refs);
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};
export const P = (id: string, p: number): Endpoint => ({ comp: id, pin: p - 1 });
const plus: Endpoint = { comp: "G1", pin: 1 };
export const minus: Endpoint = { comp: "G1", pin: 0 };
const CLK: Endpoint = { hole: CPU_PINS.clk };
const RST: Endpoint = { hole: CPU_PINS.rst };
export const proj = PROJECTS.find((p) => p.id === "proj-cpu8")!;

/**
 * Эталонный 8-битный: два среза (L — биты 0…3, H — 4…7): мультиплексор MX, сумматор AD, регистр A (RA),
 * регистр выхода (RO). ПЗУ RN — число N, RC — команда. Микросхемы на столе, соединены проводами.
 */
export function cpu8(prog = CPU8_PROGRAM, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const slices = ["L", "H"] as const;
  const comps: Component[] = [chip("PC", "ref:hc161"), chip("RN", PROM_ID, prog.n), chip("RC", PROM_ID, prog.op), chip("N1", "ref:not-cmos"), chip("N2", "ref:not-cmos"), chip("N3", "ref:not-cmos"), chip("N4", "ref:not-cmos")];
  for (const s of slices) comps.push(chip(`MX${s}`, "ref:hc157"), chip(`AD${s}`, "ref:hc283"), chip(`RA${s}`, "ref:hc173"), chip(`RO${s}`, "ref:hc173"));
  const w: [Endpoint, Endpoint][] = [];
  for (const c of comps) if (c.id.startsWith("N")) w.push([plus, P(c.id, 5)], [minus, P(c.id, 3)]);
  else w.push([plus, P(c.id, 16)], [minus, P(c.id, 8)]);
  // Выводы ПЗУ Q0…Q7 — 1…7, 9
  const q = [1, 2, 3, 4, 5, 6, 7, 9];
  const n = q.map((p) => P("RN", p));
  // Счётчик команд: такт, сброс через инвертор, счёт всегда, загрузка — по биту 7 команды (через инвертор)
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [plus, P("PC", 7)], [plus, P("PC", 10)]);
  w.push([P("RC", 9), P("N2", 2)], [P("N2", 4), P("PC", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([n[k], P("PC", p)]));
  // Оба ПЗУ — по одному адресу
  for (const r of ["RN", "RC"]) {
    [14, 13, 12, 11].forEach((qp, k) => w.push([P("PC", qp), P(r, 10 + k)]));
    w.push([minus, P(r, 14)], [minus, P(r, 15)]);
  }
  // Разрешения записи: A — по биту 5, выход — по биту 6 (активным нулём — через инверторы)
  w.push([P("RC", 6), P("N3", 2)], [P("RC", 7), P("N4", 2)]);
  slices.forEach((s, i) => {
    const nb = n.slice(4 * i, 4 * i + 4);
    [5, 3, 14, 12].forEach((p, k) => w.push([P(`RA${s}`, 3 + k), P(`AD${s}`, p)]));
    [6, 2, 15, 11].forEach((p, k) => w.push([nb[k], P(`AD${s}`, p)]));
    const sum = [4, 1, 13, 10].map((p) => P(`AD${s}`, p));
    w.push([P("RC", 5), P(`MX${s}`, 1)], [minus, P(`MX${s}`, 15)]);
    [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].forEach(([i0, i1, y], k) => w.push([nb[k], P(`MX${s}`, i0)], [sum[k], P(`MX${s}`, i1)], [P(`MX${s}`, y), P(`RA${s}`, 14 - k)]));
    for (const r of [`RA${s}`, `RO${s}`]) w.push([CLK, P(r, 7)], [RST, P(r, 15)], [minus, P(r, 1)], [minus, P(r, 2)], [minus, P(r, 10)]);
    w.push([P("N3", 4), P(`RA${s}`, 9)], [P("N4", 4), P(`RO${s}`, 9)]);
    [0, 1, 2, 3].forEach((k) => w.push([P(`RA${s}`, 3 + k), P(`RO${s}`, 14 - k)], [P(`RO${s}`, 3 + k), { hole: CPU8_OUT[4 * i + k] }]));
  });
  // Перенос: младший сумматор — C0 к общему, его C4 — на C0 старшего
  w.push([minus, P("ADL", 7)], [P("ADL", 9), P("ADH", 7)]);
  const sc = proj.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
