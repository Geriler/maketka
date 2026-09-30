import { describe, expect, it } from "vitest";
import { setLibrary, setReference } from "../src/chips/registry";
import { memoryChips, ramDef } from "../src/chips/memory";
import { Simulation } from "../src/sim/simulation";
import { pinNode } from "../src/sim/nodes";
import "../src/career/build";

setLibrary([]);
setReference(memoryChips());

/** ОЗУ на столе: входы — от второго блока питания («единица») или к общему; выходы — на 100 кОм к общему. */
function bench() {
  const d = ramDef();
  const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const q = [5, 7, 9, 11];
  const scene = {
    components: [
      { id: "G1", type: "psu" as const, volts: 5, amps: 1, on: true, placement: f },
      { id: "U", type: "chip" as const, def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f },
      ...q.map((_, k) => ({ id: `R${k}`, type: "resistor" as const, variant: "tht" as const, ohms: 100_000, smdSize: "0805" as const, placement: f })),
    ],
    wires: [] as { id: string; a: { comp: string; pin: number }; b: { comp: string; pin: number }; color: string }[],
    boards: [],
    chips: { [d.id]: d },
  };
  const sim = new Simulation(scene as never);
  const u = scene.components[1];
  /** Выставить входы и сделать шаг: s — S̅, w — R/W̅, addr, data. */
  const set = (s: boolean, w: boolean, addr: number, data: number) => {
    const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
    const P = (p: number) => ({ comp: "U", pin: p - 1 });
    const lv = (b: boolean) => (b ? plus : minus);
    scene.wires = [
      [plus, P(16)], [minus, P(8)], [lv(s), P(2)], [lv(w), P(3)],
      ...[1, 15, 14, 13].map((p, i) => [lv(!!(addr & (1 << i))), P(p)]),
      ...[4, 6, 10, 12].map((p, i) => [lv(!!(data & (1 << i))), P(p)]),
      ...q.map((p, k) => [P(p), { comp: `R${k}`, pin: 0 }]),
      ...q.map((_, k) => [{ comp: `R${k}`, pin: 1 }, minus]),
    ].map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })) as never;
    sim.solve();
    sim.step(0.01);
    return q.map((p) => sim.solution.voltage.get(pinNode(u as never, p - 1)) ?? 0);
  };
  const power = (on: boolean) => {
    (scene.components[0] as { on: boolean }).on = on;
    sim.solve();
    sim.step(0.01);
  };
  return { sim, set, power };
}
const word = (v: number[]) => v.reduce((m, x, k) => m | (x > 2 ? 1 << k : 0), 0);

describe("ОЗУ 74LS219A (16 × 4)", () => {
  it("записывает и читает по адресам; при записи и S̅ = 1 выходы отключены", () => {
    const b = bench();
    expect(b.sim.modelOf("U")).toBeTruthy();
    // Запись 0xA в адрес 3 и 0x5 в адрес 12 (выходы в это время отключены — нагрузка тянет к нулю)
    expect(Math.max(...b.set(false, false, 3, 0xa))).toBeLessThan(0.05);
    b.set(false, true, 3, 0);
    b.set(false, false, 12, 0x5);
    expect(word(b.set(false, true, 12, 0))).toBe(0x5);
    expect(word(b.set(false, true, 3, 0xf))).toBe(0xa);
    // Не выбрана — выходы отключены
    expect(Math.max(...b.set(true, true, 3, 0))).toBeLessThan(0.05);
    // Запись при S̅ = 1 не идёт
    b.set(true, false, 3, 0x3);
    expect(word(b.set(false, true, 3, 0))).toBe(0xa);
  });
  it("без питания забывает: после включения в ячейках мусор, а не записанное", () => {
    const b = bench();
    for (let a = 0; a < 16; a++) {
      b.set(false, false, a, 0x6);
      b.set(false, true, a, 0);
    }
    const before = Array.from({ length: 16 }, (_, a) => word(b.set(false, true, a, 0)));
    expect(before.every((w) => w === 0x6)).toBe(true);
    b.power(false);
    expect(b.sim.memory.get("U:ram")).toBeUndefined();
    b.power(true);
    const after = Array.from({ length: 16 }, (_, a) => word(b.set(false, true, a, 0)));
    expect(after.filter((w) => w === 0x6).length).toBeLessThan(8);
  });
});

import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

describe("ОЗУ 4 × 4 (уровень)", () => {
  const refs = referenceChips();
  const refById = new Map(refs.map((d) => [d.id, d]));
  const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
  const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
  const run = (level: Level) => {
    setLibrary([]);
    const scene = recipeScene(level, chipFor);
    applyBoards(scene.boards!);
    return checkLevel(level, scene, allChips);
  };
  const text = (r: ReturnType<typeof checkLevel>) => r.problems.join() + r.rows.filter((x) => !x.ok).map((x) => `${x.step}: ${x.inputs.map(Number).join("")}→${x.volts.map((v) => v.toFixed(1)).join(",")}`).join("\n");
  it("ожидаемое по шагам: записанное читается, запись по S̅ работает, при S̅ = 1 — не пишется", () => {
    const o = sequenceExpected(levelById("ram4")!).map((x) => x.map(Number).join(""));
    // Чтение всех ячеек после записи: 0xA, 0x5, 0xC, 0x3 (Q1 — младший)
    expect(o.slice(9, 13)).toEqual(["0101", "1010", "0011", "1100"]);
    expect(o[16]).toBe("1001");
    expect(o[19]).toBe("1010");
  });
  it("эталонная сборка проходит проверку", () => {
    const r = run(levelById("ram4")!);
    expect(r.ok, text(r)).toBe(true);
  }, 240000);
  it("такт регистров от дешифратора чтения — не проходит", () => {
    const level = levelById("ram4")!;
    const nets = level.recipe.nets.map((n) => n.map((x) => x.replace(/^XW\.(1[2-5])$/, "XR.$1")));
    expect(run({ ...level, recipe: { ...level.recipe, nets } }).ok).toBe(false);
  }, 240000);
});
