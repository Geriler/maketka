/** Эталонный загрузчик для тестов и перебора обрывов. */
import { setLibrary, setReference } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Component, Endpoint, Scene } from "../src/model/types";
import { referenceChips } from "../src/career/build";
import { EEPROM_ID, SRAM_ID, memoryChips } from "../src/chips/memory";
import { BOOT_PROGRAM, CPU_PINS, PROJECTS } from "../src/career/projects";

setLibrary([]);
const refs = [...referenceChips(), ...memoryChips()];
setReference(refs);
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
export const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};
export const P = (id: string, p: number): Endpoint => ({ comp: id, pin: p - 1 });
const plus: Endpoint = { comp: "G1", pin: 1 };
export const minus: Endpoint = { comp: "G1", pin: 0 };
const CLK: Endpoint = { hole: CPU_PINS.clk };
const RST: Endpoint = { hole: CPU_PINS.rst };
export const proj = PROJECTS.find((p) => p.id === "proj-boot")!;

/**
 * Эталонный загрузчик: 4-битный процессор (PC, MX, AD, RA, RO) берёт команды с шины I/O0…I/O7,
 * общей у EEPROM (EE) и ОЗУ (RM). Флаг RUN (FF): сброс по RST, ставится по такту, когда счётчик
 * дошёл до 15 (RCO), дальше держит сам себя. Пока RUN = 0, шину ведёт EEPROM, ОЗУ пишет (W̅E̅ =
 * RUN + CLK — пока CLK = 0), разрешения процессора закрыты (И-НЕ с RUN); RUN = 1 — шину ведёт ОЗУ.
 */
export function boot(prog = BOOT_PROGRAM, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w, extra: Component[] = []): Scene {
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("MX", "ref:hc157"), chip("AD", "ref:hc283"), chip("RA", "ref:hc173"), chip("RO", "ref:hc173"),
    chip("EE", EEPROM_ID, prog), chip("RM", SRAM_ID), chip("FF", "ref:dffr"),
    chip("N1", "ref:not-cmos"), chip("N2", "ref:not-cmos"), chip("G1A", "ref:or"), chip("G1B", "ref:or"),
    chip("G2", "ref:nand-cmos"), chip("G3", "ref:nand-cmos"), chip("G4", "ref:nand-cmos"), ...extra,
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const c of comps) {
    if (c.id === "EE" || c.id === "RM") w.push([plus, P(c.id, 28)], [minus, P(c.id, 14)]);
    else if (c.id === "FF") w.push([plus, P(c.id, 5)], [minus, P(c.id, 2)]);
    else if (/^[NG]/.test(c.id)) w.push([plus, P(c.id, 5)], [minus, P(c.id, 3)]);
    else w.push([plus, P(c.id, 16)], [minus, P(c.id, 8)]);
  }
  const RUN = P("FF", 4), BOOT = P("N2", 4), nRST = P("N1", 4);
  // Шина: I/O0…I/O7 обеих памятей вместе
  const io = [11, 12, 13, 15, 16, 17, 18, 19];
  for (const p of io) w.push([P("EE", p), P("RM", p)]);
  const d = io.map((p) => P("EE", p));
  // Адрес обеих — из счётчика команд (A0…A3 — выводы 10, 9, 8, 7), старшие — к общему
  for (const m of ["EE", "RM"]) {
    [14, 13, 12, 11].forEach((q, k) => w.push([P("PC", q), P(m, 10 - k)]));
    for (const a of [6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1]) w.push([minus, P(m, a)]);
    w.push([minus, P(m, 20)]);
  }
  // EEPROM: только чтение, выходы — пока RUN = 0; ОЗУ: выходы — пока RUN = 1, запись — RUN + CLK
  w.push([plus, P("EE", 27)], [RUN, P("EE", 22)], [BOOT, P("RM", 22)]);
  w.push([RUN, P("G1A", 1)], [CLK, P("G1A", 2)], [P("G1A", 4), P("RM", 27)]);
  // Флаг RUN: D = RUN + RCO, такт — CLK, сброс — RST (через инвертор)
  w.push([CLK, P("FF", 1)], [nRST, P("FF", 6)], [RUN, P("G1B", 1)], [P("PC", 15), P("G1B", 2)], [P("G1B", 4), P("FF", 3)]);
  w.push([RUN, P("N2", 2)], [RST, P("N1", 2)]);
  // Счётчик команд: такт, сброс, счёт всегда, загрузка — бит 7 и RUN
  w.push([CLK, P("PC", 2)], [nRST, P("PC", 1)], [plus, P("PC", 7)], [plus, P("PC", 10)]);
  w.push([d[7], P("G2", 1)], [RUN, P("G2", 2)], [P("G2", 4), P("PC", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([d[k], P("PC", p)]));
  // Сумматор, мультиплексор, регистры — как у 4-битного
  [5, 3, 14, 12].forEach((p, k) => w.push([P("RA", 3 + k), P("AD", p)]));
  [6, 2, 15, 11].forEach((p, k) => w.push([d[k], P("AD", p)]));
  w.push([minus, P("AD", 7)]);
  const sum = [4, 1, 13, 10].map((p) => P("AD", p));
  w.push([d[4], P("MX", 1)], [minus, P("MX", 15)]);
  [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].forEach(([i0, i1, y], k) => w.push([d[k], P("MX", i0)], [sum[k], P("MX", i1)], [P("MX", y), P("RA", 14 - k)]));
  for (const r of ["RA", "RO"]) w.push([CLK, P(r, 7)], [RST, P(r, 15)], [minus, P(r, 1)], [minus, P(r, 2)], [minus, P(r, 10)]);
  w.push([d[5], P("G3", 1)], [RUN, P("G3", 2)], [P("G3", 4), P("RA", 9)]);
  w.push([d[6], P("G4", 1)], [RUN, P("G4", 2)], [P("G4", 4), P("RO", 9)]);
  [0, 1, 2, 3].forEach((k) => w.push([P("RA", 3 + k), P("RO", 14 - k)], [P("RO", 3 + k), { hole: CPU_PINS.out[k] }]));
  const sc = proj.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
