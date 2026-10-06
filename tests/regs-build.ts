/**
 * Эталон «Регистров»: «Подпрограммы», где A — рабочий регистр, а Rr — в третьем ОЗУ на общей шине
 * данных. Номер такта — третий 74HC161 (0, 1, 2, загрузка 0 по E̅N̅D̅), он — на адресе обеих EEPROM
 * декодера (A6, A7). Вторая EEPROM: 0 RET, 1 W̅S̅P̅, 2 P̅U̅S̅H̅, 3 E̅N̅D̅, 4 R̅R̅D̅ (регистры на шину),
 * 5 R̅W̅R̅ (запись регистра), 6 M̅R̅D̅ (ОЗУ данных на шину), 7 A̅B̅U̅S̅ (A на шину); R̅E̅T̅ — инвертор.
 */
import type { Component, Endpoint, Scene } from "../src/model/types";
import { applyBoards } from "../src/model/breadboard";
import { EEPROM_ID, SRAM_ID } from "../src/chips/memory";
import { CPU_PINS, CPU8_OUT, PROJECTS, REGS_PROGRAM, RR_PROGRAM } from "../src/career/projects";
import { MICROCODE } from "./mem-build";
import { P, allChips } from "./module-build";

export const proj = PROJECTS.find((p) => p.id === "proj-regs")!;
export const projRR = PROJECTS.find((p) => p.id === "proj-rr")!;
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string, data?: number[]): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) };
};

/**
 * Первая EEPROM: такт 0 — A ← шина (CA); такт 1 — действие из «Длинных программ» без счёта и
 * загрузки счётчика команд; такт 2 — счёт и переходы оттуда же, но A, выход, флаг и ОЗУ не трогает.
 */
const BY_OP = (op: number, c: number, z: number) => MICROCODE[op + 16 * c + 32 * z];
export const REGS_MICROCODE = Array.from({ length: 256 }, (_, a) => {
  const op = a & 15, c = (a >> 4) & 1, z = (a >> 5) & 1, step = a >> 6;
  const w = op === 13 || op === 14 ? 0xa3 : BY_OP(op, c, z);
  if (step === 0) return 0xca;
  if (step === 1) return (w | 0x08) & ~0x20;
  if (step === 2) return (w | 0x83) & ~0x04;
  return 0x8b;
});
/** Вторая EEPROM: такт 0 — регистры на шину; 1 — ОЗУ на шину (при ST — A на шину); 2 — запись Rr, стек, конец. */
export const REGS_STACK = Array.from({ length: 256 }, (_, a) => {
  const op = a & 15, step = a >> 6;
  if (step === 0) return 0xee;
  if (step === 1) return op === 3 ? 0x7e : 0xbe;
  if (step === 2) return op === 13 ? 0x50 : op === 14 ? 0x55 : 0x56;
  return 0xb6;
});

const ADDR28 = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO28 = [11, 12, 13, 15, 16, 17, 18, 19];
/** 74HC157: каналы (I0, I1, Y). */
const MUXC = [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]];
/** 74HC244: бит k (0…7) — вход A, выход Y. */
const BUF = [[2, 18], [4, 16], [6, 14], [8, 12], [17, 3], [15, 5], [13, 7], [11, 9]];
/** 74HC283: разряд k — (A, B, Σ). */
const ADD = [[5, 6, 4], [3, 2, 1], [14, 15, 13], [12, 11, 10]];
/** 74HC161: Q0…Q3, D0…D3. */
const CQ = [14, 13, 12, 11], CD = [3, 4, 5, 6];
/** 74HC173: Q0…Q3, D0…D3. */
const RQ = [3, 4, 5, 6], RD = [14, 13, 12, 11];

/**
 * «Регистр с регистром»: на адресе декодера ещё f (A8…A11 — старшая тетрада N); код 0 во втором
 * такте: f = 0 — A ← шина (CA), 1 — A + шина (CE), 2 — A − шина (DE), регистры на шину (EE).
 */
const RR_STEP1 = [0xca, 0xce, 0xde];
export const RR_MICROCODE = Array.from({ length: 4096 }, (_, a) => ((a & 15) === 0 && ((a >> 6) & 3) === 1 && a >> 8 <= 2 ? RR_STEP1[a >> 8] : REGS_MICROCODE[a & 255]));
export const RR_STACK = Array.from({ length: 4096 }, (_, a) => ((a & 15) === 0 && ((a >> 6) & 3) === 1 && a >> 8 <= 2 ? 0xee : REGS_STACK[a & 255]));

/** rr — «Регистр с регистром»: адрес ОЗУ регистров — 74HC157 (r, во втором такте — s из N), f — на декодер. */
export function regs(microcode?: number[], stack?: number[], mutate: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][] = (w) => w, rr = false): Scene {
  microcode ??= rr ? RR_MICROCODE : REGS_MICROCODE;
  stack ??= rr ? RR_STACK : REGS_STACK;
  const prog = rr ? RR_PROGRAM : REGS_PROGRAM;
  const plus: Endpoint = { comp: "G1", pin: 1 }, minus: Endpoint = { comp: "G1", pin: 0 };
  const CLK: Endpoint = { hole: CPU_PINS.clk }, RST: Endpoint = { hole: CPU_PINS.rst };
  const gates = ["N1", "N2", "O1", "O2", "O3", ...Array.from({ length: 6 }, (_, k) => `Z${k}`), "ZN", ...Array.from({ length: 8 }, (_, k) => `X${k}`)];
  const comps: Component[] = [
    chip("PC", "ref:hc161"), chip("PH", "ref:hc161"), chip("SC", "ref:hc161"), chip("RO", EEPROM_ID, prog.op), chip("RN", EEPROM_ID, prog.n), ...(rr ? [chip("MR", "ref:hc157")] : []), chip("RR", SRAM_ID),
    chip("DE", EEPROM_ID, microcode), chip("DS", EEPROM_ID, stack), chip("RM", SRAM_ID), chip("RS", SRAM_ID),
    chip("BF", "ref:hc244"), chip("BS", "ref:hc244"), chip("MA", "ref:hc157"), chip("MB", "ref:hc157"), chip("MS", "ref:hc157"), chip("ML", "ref:hc157"), chip("MH", "ref:hc157"),
    chip("SP", "ref:hc173"), chip("AS", "ref:hc283"), chip("I0", "ref:hc283"), chip("I1", "ref:hc283"),
    chip("FC", "ref:dffr"), chip("MC", "ref:mux"),
    chip("N1", "ref:not-cmos"), chip("N2", "ref:not-cmos"), chip("O1", "ref:or"), chip("O2", "ref:or"), chip("O3", "ref:or"), ...Array.from({ length: 6 }, (_, k) => chip(`Z${k}`, "ref:or")), chip("ZN", "ref:nor-cmos"),
    ...Array.from({ length: 8 }, (_, k) => chip(`X${k}`, "ref:xor")),
    ...[0, 1].map((s): Component => ({ id: `M${s}`, type: "chip", def: "ref:slice2", name: "Срез 2", package: "SIP", pins: 24, placement: f }) as Component),
  ];
  const w: [Endpoint, Endpoint][] = [];
  for (const id of [...(rr ? ["MR"] : []), "SC", "PC", "PH", "MA", "MB", "MS", "ML", "MH", "SP", "AS", "I0", "I1"]) w.push([plus, P(id, 16)], [minus, P(id, 8)]);
  for (const id of ["DE", "DS", "RM", "RS", "RR", "RO", "RN"]) w.push([plus, P(id, 28)], [minus, P(id, 14)]);
  for (const id of ["BF", "BS"]) w.push([plus, P(id, 20)], [minus, P(id, 10)]);
  for (const id of gates) w.push([plus, P(id, 5)], [minus, P(id, 3)]);
  for (const id of ["FC", "MC"]) w.push([plus, P(id, 5)], [minus, P(id, 2)]);
  const nq = (k: number) => P("RN", IO28[k]);
  const oq = (k: number) => P("RO", IO28[k]);
  const [nWA, nWO, SEL, nLD, SUB, CNT, MEM, nST] = IO28.map((p) => P("DE", p));
  const [RET, nWSP, nPUSH, nEND, nRRD, nRWR, nMRD, nABUS] = IO28.map((p) => P("DS", p));
  const nRET = P("N2", 4);
  w.push([RET, P("N2", 2)]);
  // Номер такта: считает всегда, E̅N̅D̅ грузит 0, RST сбрасывает
  w.push([CLK, P("SC", 2)], [P("N1", 4), P("SC", 1)], [plus, P("SC", 7)], [plus, P("SC", 10)], [nEND, P("SC", 9)]);
  for (const d of CD) w.push([minus, P("SC", d)]);
  // Счётчик команд: два 74HC161, адрес загрузки — через 74HC157 (N или стек)
  w.push([CLK, P("PC", 2)], [RST, P("N1", 2)], [P("N1", 4), P("PC", 1)], [CNT, P("PC", 7)], [plus, P("PC", 10)], [nLD, P("PC", 9)]);
  w.push([CLK, P("PH", 2)], [P("N1", 4), P("PH", 1)], [CNT, P("PH", 7)], [P("PC", 15), P("PH", 10)], [nLD, P("PH", 9)]);
  for (let k = 0; k < 8; k++) {
    const m = k < 4 ? "ML" : "MH", [i0, i1, y] = MUXC[k & 3];
    w.push([nq(k), P(m, i0)], [P("RS", IO28[k]), P(m, i1)], [P(m, y), P(k < 4 ? "PC" : "PH", CD[k & 3])]);
  }
  for (const m of ["ML", "MH"]) w.push([RET, P(m, 1)], [minus, P(m, 15)]);
  for (const r of ["RO", "RN"]) {
    CQ.forEach((qp, k) => w.push([P("PC", qp), P(r, ADDR28[k])], [P("PH", qp), P(r, ADDR28[4 + k])]));
    for (const a of ADDR28.slice(8)) w.push([minus, P(r, a)]);
    w.push([minus, P(r, 20)], [minus, P(r, 22)], [plus, P(r, 27)]);
  }
  // Декодер — две EEPROM с одним адресом: код операции, C, «A = 0»
  for (const d of ["DE", "DS"]) {
    [4, 5, 6, 7].forEach((k, i) => w.push([oq(k), P(d, ADDR28[i])]));
    w.push([P("FC", 4), P(d, ADDR28[4])], [P("ZN", 4), P(d, ADDR28[5])], [P("SC", CQ[0]), P(d, ADDR28[6])], [P("SC", CQ[1]), P(d, ADDR28[7])]);
    if (rr) [4, 5, 6, 7].forEach((k, i) => w.push([nq(k), P(d, ADDR28[8 + i])]));
    for (const a of ADDR28.slice(rr ? 12 : 8)) w.push([minus, P(d, a)]);
    w.push([minus, P(d, 20)], [minus, P(d, 22)], [plus, P(d, 27)]);
  }
  // Флаг C
  w.push([P("M1", 12), P("MC", 1)], [P("FC", 4), P("MC", 3)], [SEL, P("MC", 6)], [P("MC", 4), P("FC", 3)], [CLK, P("FC", 1)], [P("N1", 4), P("FC", 6)]);
  // ОЗУ данных: адрес — N, читается всегда, кроме ST; пишется при ST, пока CLK = 0
  for (let k = 0; k < 8; k++) w.push([nq(k), P("RM", ADDR28[k])]);
  for (const a of ADDR28.slice(8)) w.push([minus, P("RM", a)]);
  w.push([minus, P("RM", 20)], [nMRD, P("RM", 22)], [CLK, P("O1", 1)], [nST, P("O1", 2)], [P("O1", 4), P("RM", 27)]);
  w.push([nABUS, P("BF", 1)], [nABUS, P("BF", 19)]);
  // Регистры: адрес — номер r из байта кода, данные — на общей шине с ОЗУ данных
  if (rr) {
    // Во втором такте (Q0 номера такта = 1) — номер s из N, в остальных — r
    for (let k = 0; k < 4; k++) {
      const [i0, i1, y] = MUXC[k];
      w.push([oq(k), P("MR", i0)], [nq(k), P("MR", i1)], [P("MR", y), P("RR", ADDR28[k])]);
    }
    w.push([P("SC", CQ[0]), P("MR", 1)], [minus, P("MR", 15)]);
  } else for (let k = 0; k < 4; k++) w.push([oq(k), P("RR", ADDR28[k])]);
  for (const a of ADDR28.slice(4)) w.push([minus, P("RR", a)]);
  for (let k = 0; k < 8; k++) w.push([P("RM", IO28[k]), P("RR", IO28[k])]);
  w.push([minus, P("RR", 20)], [nRRD, P("RR", 22)], [CLK, P("O3", 1)], [nRWR, P("O3", 2)], [P("O3", 4), P("RR", 27)]);
  const aBit = (k: number) => P(`M${k >> 2}`, 17 + (k & 3));
  BUF.forEach(([a, y], k) => w.push([aBit(k), P("BF", a)], [P("BF", y), P("RM", IO28[k])]));
  // Второе слагаемое: N или RAM[N]; потом XOR (вычитание)
  for (let k = 0; k < 8; k++) {
    const m = k < 4 ? "MA" : "MB", [i0, i1, y] = MUXC[k & 3];
    w.push([nq(k), P(m, i0)], [P("RM", IO28[k]), P(m, i1)], [P(m, y), P(`X${k}`, 1)], [SUB, P(`X${k}`, 2)]);
  }
  for (const m of ["MA", "MB"]) w.push([MEM, P(m, 1)], [minus, P(m, 15)]);
  // «A = 0»
  [0, 1, 2, 3].forEach((g) => w.push([aBit(2 * g), P(`Z${g}`, 1)], [aBit(2 * g + 1), P(`Z${g}`, 2)]));
  w.push([P("Z0", 4), P("Z4", 1)], [P("Z1", 4), P("Z4", 2)], [P("Z2", 4), P("Z5", 1)], [P("Z3", 4), P("Z5", 2)], [P("Z4", 4), P("ZN", 1)], [P("Z5", 4), P("ZN", 2)]);
  // Указатель стека: 74HC173 грузит SP ± 1 при W̅S̅P̅ = 0, сброс — RST
  w.push([minus, P("SP", 1)], [minus, P("SP", 2)], [CLK, P("SP", 7)], [nWSP, P("SP", 9)], [nWSP, P("SP", 10)], [RST, P("SP", 15)]);
  ADD.forEach(([a, b, s], k) => w.push([P("SP", RQ[k]), P("AS", a)], [k ? nRET : plus, P("AS", b)], [P("AS", s), P("SP", RD[k])]));
  w.push([minus, P("AS", 7)]);
  // Адрес ОЗУ стека: SP или SP + 1
  ADD.forEach(([, , s], k) => {
    const [i0, i1, y] = MUXC[k];
    w.push([P("SP", RQ[k]), P("MS", i0)], [P("AS", s), P("MS", i1)], [P("MS", y), P("RS", ADDR28[k])]);
  });
  w.push([RET, P("MS", 1)], [minus, P("MS", 15)]);
  for (const a of ADDR28.slice(4)) w.push([minus, P("RS", a)]);
  // ОЗУ стека: читается при RET, пишется при CALL, пока CLK = 0
  w.push([minus, P("RS", 20)], [nRET, P("RS", 22)], [CLK, P("O2", 1)], [nPUSH, P("O2", 2)], [P("O2", 4), P("RS", 27)]);
  // «Адрес + 1»: два 74HC283 от счётчиков команд, перенос младшего — в старший
  for (const [i, c] of [["I0", "PC"], ["I1", "PH"]] as const) ADD.forEach(([a, b], k) => w.push([P(c, CQ[k]), P(i, a)], [minus, P(i, b)]));
  w.push([plus, P("I0", 7)], [P("I0", 9), P("I1", 7)]);
  w.push([nPUSH, P("BS", 1)], [nPUSH, P("BS", 19)]);
  BUF.forEach(([a, y], k) => w.push([P(k < 4 ? "I0" : "I1", ADD[k & 3][2]), P("BS", a)], [P("BS", y), P("RS", IO28[k])]));
  // Модули «Срез 2»
  for (let s = 0; s < 2; s++) {
    const m = `M${s}`;
    [0, 1, 2, 3].forEach((k) => w.push([P(`X${4 * s + k}`, 4), P(m, k + 1)], [P(m, 13 + k), { hole: CPU8_OUT[4 * s + k] }]));
    w.push([SEL, P(m, 5)], [CLK, P(m, 6)], [RST, P(m, 7)], [nWA, P(m, 8)], [nWO, P(m, 9)], [minus, P(m, 10)], [plus, P(m, 24)]);
  }
  w.push([SUB, P("M0", 11)], [P("M0", 12), P("M1", 11)]);
  const sc = (rr ? projRR : proj).start();
  sc.components.push(...comps);
  sc.wires.push(...mutate(w).map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  sc.chips = allChips;
  applyBoards(sc.boards!);
  return sc;
}
