import { describe, expect, it } from "vitest";
import { setLibrary, setReference } from "../src/chips/registry";
import { EEPROM_ID, SRAM_ID, eepromDef, memoryChips, sramDef } from "../src/chips/memory";
import type { ChipDef } from "../src/model/types";
import { Simulation } from "../src/sim/simulation";
import { pinNode } from "../src/sim/nodes";
import "../src/career/build";

setLibrary([]);
setReference(memoryChips());

// Цоколёвка JEDEC 28 выводов (HM62256B и AT28C256 одинаковы)
const ADDR = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO = [11, 12, 13, 15, 16, 17, 18, 19];

/**
 * Память на столе. Управление и адрес — от блока питания (единица) или к общему. Данные — через
 * 10 кОм к единице или нулю (drive), или через 100 кОм к общему (drive = undefined): так видно,
 * гонит ли микросхема свои выводы.
 */
function bench(d: ChipDef, data?: number[], ramZero = false) {
  const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const scene = {
    components: [
      { id: "G1", type: "psu" as const, volts: 5, amps: 1, on: true, placement: f },
      { id: "U", type: "chip" as const, def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) },
      ...IO.map((_, k) => ({ id: `R${k}`, type: "resistor" as const, variant: "tht" as const, ohms: 10_000, smdSize: "0805" as const, placement: f })),
    ],
    wires: [] as unknown[],
    boards: [],
    chips: { [d.id]: d },
  };
  const sim = new Simulation(scene as never, undefined, { ramZero });
  const u = scene.components[1];
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  const P = (p: number) => ({ comp: "U", pin: p - 1 });
  const lv = (b: boolean) => (b ? plus : minus);
  /** cs, oe, we — уровни (true — единица); drive — байт на выводах данных или отпустить. */
  const set = (cs: boolean, oe: boolean, we: boolean, addr: number, drive?: number, dt = 0.001) => {
    scene.components.slice(2).forEach((r) => ((r as { ohms: number }).ohms = drive === undefined ? 100_000 : 10_000));
    scene.wires = [
      [plus, P(28)], [minus, P(14)], [lv(cs), P(20)], [lv(oe), P(22)], [lv(we), P(27)],
      ...ADDR.map((p, i) => [lv(!!(addr & (1 << i))), P(p)]),
      ...IO.map((p, k) => [P(p), { comp: `R${k}`, pin: 0 }]),
      ...IO.map((_, k) => [{ comp: `R${k}`, pin: 1 }, drive === undefined ? minus : lv(!!(drive & (1 << k)))]),
    ].map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" }));
    sim.solve();
    sim.step(dt);
    return IO.map((p) => sim.solution.voltage.get(pinNode(u as never, p - 1)) ?? 0);
  };
  const volts = (v: number) => {
    (scene.components[0] as { volts: number }).volts = v;
    sim.solve();
    sim.step(0.001);
  };
  const power = (on: boolean) => {
    (scene.components[0] as { on: boolean }).on = on;
    sim.solve();
    sim.step(0.001);
  };
  return { sim, set, power, volts, chip: u as { data?: number[] } };
}
const byte = (v: number[]) => v.reduce((m, x, k) => m | (x > 2.5 ? 1 << k : 0), 0);
const read = (b: ReturnType<typeof bench>, addr: number) => byte(b.set(false, false, true, addr));

describe("ОЗУ HM62256B (32K × 8)", () => {
  it("цоколёвка по даташиту: A0 — 10, A14 — 1, I/O0 — 11, C̅S̅ — 20, O̅E̅ — 22, W̅E̅ — 27, питание 28 и 14", () => {
    const d = sramDef();
    expect(d.pins).toBe(28);
    expect([d.pinNames[9], d.pinNames[0], d.pinNames[10], d.pinNames[19], d.pinNames[21], d.pinNames[26]]).toEqual(["A0", "A14", "I/O0", "C̅S̅", "O̅E̅", "W̅E̅"]);
    expect([d.pinRoles[27], d.pinRoles[13], d.pinRoles[10]]).toEqual(["vcc", "gnd", "io"]);
  });
  it("пишет и читает по всему адресу A0…A14; при записи и C̅S̅ = 1 выводы данных отключены", () => {
    const b = bench(sramDef());
    expect(b.sim.modelOf("U")).toBeTruthy();
    for (const [a, w] of [[0, 0x5a], [1, 0xa5], [0x4000, 0x3c], [0x7fff, 0xc3]]) b.set(false, true, false, a, w);
    expect([read(b, 0), read(b, 1), read(b, 0x4000), read(b, 0x7fff)]).toEqual([0x5a, 0xa5, 0x3c, 0xc3]);
    // Не выбрана: выводы отпущены — тянет нагрузка к общему
    expect(Math.max(...b.set(true, false, true, 1))).toBeLessThan(0.05);
    // O̅E̅ = 1 — тоже отключены
    expect(Math.max(...b.set(false, true, true, 1))).toBeLessThan(0.05);
    // Запись при C̅S̅ = 1 не идёт
    b.set(true, true, false, 1, 0x00);
    expect(read(b, 1)).toBe(0xa5);
    // Запись при O̅E̅ = 0 идёт (по таблице режимов O̅E̅ при записи — любой)
    b.set(false, false, false, 2, 0x81);
    expect(read(b, 2)).toBe(0x81);
  });
  it("без питания забывает", () => {
    const b = bench(sramDef());
    b.set(false, true, false, 5, 0x77);
    expect(read(b, 5)).toBe(0x77);
    b.power(false);
    expect(b.sim.memory.get("U:ram")).toBeUndefined();
    b.power(true);
    // После включения — что попало; записанное не обязано сохраниться (и в модели не сохраняется)
    expect(b.sim.memory.get("U:ram")).toBeDefined();
  });
});

describe("настройка «ОЗУ при включении: нули»", () => {
  it("с ней после включения все ячейки 00, без неё — что попало", () => {
    const z = bench(sramDef(), undefined, true);
    expect(Array.from({ length: 16 }, (_, a) => read(z, a * 2048)).every((w) => w === 0)).toBe(true);
    const g = bench(sramDef());
    expect(Array.from({ length: 16 }, (_, a) => read(g, a * 2048)).some((w) => w !== 0)).toBe(true);
  });
});

describe("EEPROM AT28C256 (32K × 8)", () => {
  it("корпус DIP-28 на 600 мил; чтение прошивки; пустая ячейка — 00", () => {
    const d = eepromDef();
    expect(d.package).toBe("DIPW");
    const data: number[] = [];
    data[0] = 0x12;
    data[0x7fff] = 0x34;
    const b = bench(d, data);
    expect([read(b, 0), read(b, 0x7fff), read(b, 1)]).toEqual([0x12, 0x34, 0x00]);
    expect(Math.max(...b.set(false, true, true, 0))).toBeLessThan(0.05);
  });
  it("запись байта импульсом W̅E̅: 10 мс идёт цикл — чтение даёт опрос (I/O7 — обратный бит), потом новые данные; в проекте сохраняется", () => {
    const b = bench(eepromDef());
    expect(b.sim.modelOf("U")?.eeprom).toBeTruthy();
    b.set(false, true, true, 0, undefined, 0.01); // включили, подождали дольше 5 мс
    b.set(false, true, false, 0x100, 0x2a); // импульс: C̅E̅ = 0, O̅E̅ = 1, W̅E̅ = 0
    b.set(false, true, true, 0x100, 0x2a); // фронт W̅E̅ — байт защёлкнут, пошёл цикл
    const during = read(b, 0x100);
    // Записали 0x2A (бит 7 — 0): при опросе бит 7 — 1, это не пустая ячейка и не сами данные
    expect(during & 0x80).toBe(0x80);
    expect(during & 0x3f).toBe(0x2a & 0x3f);
    expect([0x00, 0x2a]).not.toContain(during);
    // Во время цикла новая запись не принимается
    b.set(false, true, false, 0x101, 0x55);
    b.set(false, true, true, 0x101, 0x55);
    for (let i = 0; i < 12; i++) b.set(false, true, true, 0, undefined, 0.001);
    expect(read(b, 0x100)).toBe(0x2a);
    expect(read(b, 0x101)).toBe(0x00);
    expect(b.chip.data?.[0x100]).toBe(0x2a);
  });
  it("запись запрещена: при O̅E̅ = 0, в первые 5 мс после включения и ниже 3,8 В питания", () => {
    const b = bench(eepromDef());
    // Сразу после включения — рано
    b.set(false, true, false, 1, 0x11, 0.0005);
    b.set(false, true, true, 1, 0x11, 0.0005);
    b.set(false, true, true, 1, undefined, 0.012);
    expect(read(b, 1)).toBe(0x00);
    // O̅E̅ = 0 во время импульса
    b.set(false, false, false, 2, 0x22);
    b.set(false, true, true, 2, 0x22);
    b.set(false, true, true, 2, undefined, 0.012);
    expect(read(b, 2)).toBe(0x00);
    // Питание 3,5 В — ниже порога 3,8 В
    b.volts(3.5);
    b.set(false, true, false, 3, 0x33, 0.01);
    b.set(false, true, true, 3, 0x33);
    b.volts(5);
    b.set(false, true, true, 3, undefined, 0.012);
    expect(read(b, 3)).toBe(0x00);
  });
  it("без питания помнит: выключили и включили — байт на месте", () => {
    const b = bench(eepromDef());
    b.set(false, true, true, 0, undefined, 0.01);
    b.set(false, true, false, 7, 0x9c);
    b.set(false, true, true, 7, 0x9c);
    b.set(false, true, true, 7, undefined, 0.012);
    b.power(false);
    b.power(true);
    b.set(false, true, true, 7, undefined, 0.01);
    expect(read(b, 7)).toBe(0x9c);
  });
});

describe("память 32K × 8 в реестре", () => {
  it("открываются уровнями ОЗУ и ПЗУ; на плате под SMD — свои корпуса", async () => {
    const { memoryInfo, smdFootprintOf } = await import("../src/chips/memory");
    expect(memoryInfo(SRAM_ID)?.opener).toBe("ram4");
    expect(memoryInfo(EEPROM_ID)?.opener).toBe("rom8");
    expect(smdFootprintOf(SRAM_ID)).toBe("SOP-28");
    expect(smdFootprintOf(EEPROM_ID)).toBeUndefined(); // SOIC-28 на 300 мил — обычный SO-28
  });
  it("посадочные места: DIP-28 на 600 мил — ряды через 15,24 мм, SO-28 — 9,3 мм, SOP-28 (450 мил) — 10,8 мм; шаг 1,27 мм", async () => {
    const { footprintPads, footprintBody } = await import("../src/model/breadboard");
    const { footprintOf } = await import("../src/model/types");
    const span = (fp: Parameters<typeof footprintPads>[0]) => { const p = footprintPads(fp); return [p[0].z - p[27].z, p[1].x - p[0].x]; };
    expect(span("DIPW-28")[0]).toBeCloseTo(15.24);
    expect(span("DIPW-28")[1]).toBeCloseTo(2.54);
    expect(span("SO-28")[0]).toBeCloseTo(9.3);
    expect(span("SOP-28")[0]).toBeCloseTo(10.8);
    expect(span("SOP-28")[1]).toBeCloseTo(1.27);
    expect(footprintBody("SOP-28")).toEqual([18.0, 8.4, 2.8]);
    const chip = (def: ChipDef, smd: boolean) => ({ id: "U", type: "chip" as const, def: def.id, name: def.name, package: def.package, pins: 28, smd, placement: { mode: "free" as const, x: 0, z: 0, rot: 0 } });
    expect(footprintOf(chip(sramDef(), false))).toBe("DIP-28");
    expect(footprintOf(chip(sramDef(), true))).toBe("SOP-28");
    expect(footprintOf(chip(eepromDef(), false))).toBe("DIPW-28");
    expect(footprintOf(chip(eepromDef(), true))).toBe("SO-28");
  });
});
