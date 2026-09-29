import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, truth, zOutputs, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";
import { Simulation } from "../src/sim/simulation";
import { pinNode } from "../src/sim/nodes";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const rowsText = (r: ReturnType<typeof checkLevel>) => r.problems.join() + r.rows.filter((x) => !x.ok).slice(0, 5).map((x) => `${x.inputs.map(Number).join("")}→${x.volts.map((v) => v.toFixed(1)).join(",")} ${x.each.map(Number).join("")}`).join("\n");
const run = (level: Level) => {
  const scene = recipeScene(level, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
};
const bits = (st: string) => [...st].map((c) => c === "1");

describe("74HC245: двунаправленный буфер шины", () => {
  it("по таблице Nexperia: DIR = 1 — A на B, DIR = 0 — B на A, OE̅ = 1 — всё отключено", () => {
    // OE̅ DIR A0…A7 B0…B7
    const x = bits("01" + "10110001" + "00000000");
    expect(truth("bus245", x).slice(8).map(Number).join("")).toBe("10110001");
    expect(zOutputs("bus245", x)!.map(Number).join("")).toBe("1111111100000000");
    const y = bits("00" + "00000000" + "01000011");
    expect(truth("bus245", y).slice(0, 8).map(Number).join("")).toBe("01000011");
    expect(zOutputs("bus245", y)!.map(Number).join("")).toBe("0000000011111111");
    expect(zOutputs("bus245", bits("1" + "0".repeat(17)))!.every(Boolean)).toBe(true);
  });

  it("эталонная сборка проходит проверку", () => {
    const r = run(levelById("hc245")!);
    expect(r.ok, rowsText(r)).toBe(true);
  }, 180000);

  it("направление наоборот (DIR перепутан) не проходит", () => {
    const level = levelById("hc245")!;
    const nets = level.recipe.nets.map((n) => (n[0] === "P1" ? ["P1", "N.2", "O1.2"] : n[0] === "N.4" ? ["N.4", "O2.2"] : n));
    expect(run({ ...level, recipe: { ...level.recipe, nets } }).ok).toBe(false);
  }, 180000);

  it("обе стороны всегда включены (выход тянет вход) не проходит", () => {
    const level = levelById("hc245")!;
    const nets = level.recipe.nets.map((n) => (n[0] === "O1.4" ? ["O1.4"] : n[0] === "O2.4" ? ["O2.4"] : n)).concat([["P10", "AB.1", "AB.19", "BA.1", "BA.19"]]);
    expect(run({ ...level, recipe: { ...level.recipe, nets } }).ok).toBe(false);
  }, 180000);

  it("готовая микросхема (моделью) передаёт в обе стороны", () => {
    const d = refById.get("ref:hc245")!;
    const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
    const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
    const P = (p: number) => ({ comp: "U", pin: p - 1 });
    /** DIR; на ведущую сторону — число 0b10100101 (A0 — младший), другая сторона — на подтяжках 100 кОм к общему. */
    const measure = (dir: boolean) => {
      const from = (j: number) => (dir ? 2 + j : 18 - j), to = (j: number) => (dir ? 18 - j : 2 + j);
      const val = 0b10100101;
      const scene = {
        components: [
          { id: "G1", type: "psu" as const, volts: 5, amps: 1, on: true, placement: f },
          { id: "U", type: "chip" as const, def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f },
          ...Array.from({ length: 8 }, (_, j) => ({ id: `R${j}`, type: "resistor" as const, variant: "tht" as const, ohms: 100_000, smdSize: "0805" as const, placement: f })),
        ],
        wires: [
          [plus, P(20)], [minus, P(10)], [minus, P(19)], [dir ? plus : minus, P(1)],
          ...Array.from({ length: 8 }, (_, j) => [val & (1 << j) ? plus : minus, P(from(j))]),
          ...Array.from({ length: 8 }, (_, j) => [P(to(j)), { comp: `R${j}`, pin: 0 }]),
          ...Array.from({ length: 8 }, (_, j) => [{ comp: `R${j}`, pin: 1 }, minus]),
        ].map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
        boards: [],
        chips: allChips,
      };
      const sim = new Simulation(scene as never);
      sim.solve();
      for (let t = 0; t < 0.2; t += 0.05) sim.step(0.05);
      const u = scene.components[1];
      const out = Array.from({ length: 8 }, (_, j) => (sim.solution.voltage.get(pinNode(u as never, to(j) - 1)) ?? 0) > 2.5);
      return { model: !!sim.modelOf("U"), value: out.reduce((m, b, j) => m | (b ? 1 << j : 0), 0) };
    };
    const ab = measure(true), ba = measure(false);
    expect(ab.model).toBe(true);
    expect(ab.value).toBe(0b10100101);
    expect(ba.value).toBe(0b10100101);
  }, 180000);
});
