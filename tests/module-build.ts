/** Срез процессора (4 бит) на модуле SIP-20 и процессор из таких модулей — для тестов. */
import { setLibrary, setReference } from "../src/chips/registry";
import { applyBoards, newChipBoard, type BoardSpec, type ChipPinRole } from "../src/model/breadboard";
import type { ChipDef, Component, Endpoint, Scene } from "../src/model/types";
import { referenceChips } from "../src/career/build";
import { memoryChips, PROM_ID } from "../src/chips/memory";
import { packageChip } from "../src/chips/package";
import { CPU_PINS, CPU8_OUT, CPU8_PROGRAM, PROJECTS } from "../src/career/projects";

setLibrary([]);
const refs = [...referenceChips(), ...memoryChips()];
setReference(refs);
export const allChips: Record<string, ChipDef> = Object.fromEntries(refs.map((d) => [d.id, d]));
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
export const P = (id: string, p: number): Endpoint => ({ comp: id, pin: p - 1 });
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};

/** Выводы среза: 1–4 N0…N3, 5 выбор «A + N», 6 CLK, 7 RST, 8 W̅A̅, 9 W̅O̅, 10 общий, 11 перенос в, 12 перенос из, 13–16 выход, 20 питание. */
export const SLICE_PINS = ["N0", "N1", "N2", "N3", "SEL", "CLK", "RST", "WA", "WO", "", "CI", "CO", "O0", "O1", "O2", "O3", "", "", "", ""];
export const SLICE_ROLES: ChipPinRole[] = [..."iiiiiiiiig".split(""), "i", "o", "o", "o", "o", "o", "n", "n", "n", "v"].map((r) => ({ i: "in", o: "out", g: "gnd", v: "vcc", n: "nc" })[r] as ChipPinRole);

/** Разводка среза: MX — 74HC157, AD — 74HC283, RA, RO — 74HC173; X(n) — вывод модуля n. */
export function sliceWires(M: (id: string, p: number) => Endpoint, X: (n: number) => Endpoint): [Endpoint, Endpoint][] {
  const w: [Endpoint, Endpoint][] = [];
  for (const id of ["MX", "AD", "RA", "RO"]) w.push([X(20), M(id, 16)], [X(10), M(id, 8)]);
  const nb = [1, 2, 3, 4].map(X);
  [5, 3, 14, 12].forEach((p, k) => w.push([M("RA", 3 + k), M("AD", p)]));
  [6, 2, 15, 11].forEach((p, k) => w.push([nb[k], M("AD", p)]));
  const sum = [4, 1, 13, 10].map((p) => M("AD", p));
  w.push([X(5), M("MX", 1)], [X(10), M("MX", 15)], [X(11), M("AD", 7)], [M("AD", 9), X(12)]);
  [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].forEach(([i0, i1, y], k) => w.push([nb[k], M("MX", i0)], [sum[k], M("MX", i1)], [M("MX", y), M("RA", 14 - k)]));
  for (const r of ["RA", "RO"]) w.push([X(6), M(r, 7)], [X(7), M(r, 15)], [X(10), M(r, 1)], [X(10), M(r, 2)], [X(10), M(r, 10)]);
  w.push([X(8), M("RA", 9)], [X(9), M("RO", 9)]);
  [0, 1, 2, 3].forEach((k) => w.push([M("RA", 3 + k), M("RO", 14 - k)], [M("RO", 3 + k), X(13 + k)]));
  return w;
}

/** Где на поле модуля стоят микросхемы среза (SO-16), относительно центра платы. */
export const SLICE_SEATS: [string, number, number][] = [["MX", -6, -3], ["AD", 5, -3], ["RA", -6, 4], ["RO", 5, 4]];
const REFS: Record<string, string> = { MX: "ref:hc157", AD: "ref:hc283", RA: "ref:hc173", RO: "ref:hc173" };

/** Стол с корпусом pkg-20 и срезом на нём (SOIC на поле под SMD, соединения проводами). */
export function sliceCase(pkg: "SIP" | "DIP" = "SIP"): Scene {
  const box: BoardSpec = { ...newChipBoard(20, 0, 0, "K1", pkg), smd: true, roles: SLICE_ROLES, names: SLICE_PINS, label: "Срез", seats: SLICE_SEATS.map(([id, x, z]) => ({ id, fp: "SO-16" as const, x, z, rot: 0 })) };
  const comps: Component[] = SLICE_SEATS.map(([id]) => {
    const d = allChips[REFS[id]];
    return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: 16, smd: true, placement: { mode: "board", holes: Array.from({ length: 16 }, (_, i) => `k:${id}.${i + 1}`) } } as Component;
  });
  const s: Scene = { components: comps, wires: [], boards: [box], chips: allChips };
  applyBoards(s.boards!);
  s.wires = sliceWires(P, (n) => ({ hole: `k:${n}` })).map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" }));
  return s;
}

/** 8-битный процессор на двух модулях-срезах (по 4 бита), def — упакованный срез. */
export function cpuOfModules(def: ChipDef, mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w): Scene {
  const W = 2;
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const CLK: Endpoint = { hole: CPU_PINS.clk }, RST: Endpoint = { hole: CPU_PINS.rst };
  const romsN = 1;
  const outs = CPU8_OUT;
  const comps: Component[] = [chip("PC", "ref:hc161"), chip("RC", PROM_ID, CPU8_PROGRAM.op), ...["N1", "N2", "N3", "N4"].map((id) => chip(id, "ref:not-cmos"))];
  for (let r = 0; r < romsN; r++) comps.push(chip(`RN${r}`, PROM_ID, CPU8_PROGRAM.n));
  const w: [Endpoint, Endpoint][] = [];
  for (const c of comps) if (c.id.startsWith("N")) w.push([plus, P(c.id, 5)], [minus, P(c.id, 3)]); else w.push([plus, P(c.id, 16)], [minus, P(c.id, 8)]);
  const q = [1, 2, 3, 4, 5, 6, 7, 9];
  const nbit = (b: number) => P(`RN${b >> 3}`, q[b & 7]);
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [plus, P("PC", 7)], [plus, P("PC", 10)]);
  w.push([P("RC", 9), P("N2", 2)], [P("N2", 4), P("PC", 9)]);
  [3, 4, 5, 6].forEach((p, k) => w.push([nbit(k), P("PC", p)]));
  for (const r of ["RC", ...Array.from({ length: romsN }, (_, i) => `RN${i}`)]) {
    [14, 13, 12, 11].forEach((qp, k) => w.push([P("PC", qp), P(r, 10 + k)]));
    w.push([minus, P(r, 14)], [minus, P(r, 15)]);
  }
  w.push([P("RC", 6), P("N3", 2)], [P("RC", 7), P("N4", 2)]);
  for (let s = 0; s < W; s++) {
    const id = `M${s}`;
    comps.push({ id, type: "chip", def: def.id, name: def.name, package: def.package, pins: def.pins, placement: f } as Component);
    const outer: Record<number, Endpoint> = { 5: P("RC", 5), 6: CLK, 7: RST, 8: P("N3", 4), 9: P("N4", 4), 10: minus, 20: plus };
    [0, 1, 2, 3].forEach((k) => (outer[k + 1] = nbit(4 * s + k)));
    [0, 1, 2, 3].forEach((k) => { if (4 * s + k < outs.length) outer[13 + k] = { hole: outs[4 * s + k] }; });
    if (s === 0) outer[11] = minus;
    else w.push([P(`M${s - 1}`, 12), P(id, 11)]);
    for (const [n, e] of Object.entries(outer)) w.push([e, P(id, +n)]);
  }
  const sc = PROJECTS.find((p) => p.id === "proj-cpu8")!.start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = { ...allChips, [def.id]: def };
  applyBoards(sc.boards!);
  return sc;
}

/** Упаковать срез модулем SIP-20. */
export function sliceModule(): ChipDef {
  return packageChip(sliceCase("SIP"), "Срез", "user:slice", 1);
}
