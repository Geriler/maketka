import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";
import { Simulation } from "../src/sim/simulation";
import { pinNode } from "../src/sim/nodes";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const rowsText = (r: ReturnType<typeof checkLevel>) => r.problems.join() + r.rows.map((x) => `${x.inputs.map(Number).join("")}→${x.volts.map((v) => v.toFixed(2)).join(",")} z=${x.z} ${x.ok}`).join("\n");

describe("третье состояние: 74LVC1G125 → 74HC125", () => {
  for (const id of ["tbuf", "hc125"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const r = checkLevel(level, scene, allChips);
      expect(r.ok, rowsText(r)).toBe(true);
    }, 120000);
  }
  it("обычный буфер (выход не отключается) не проходит: при OE̅ = 1 он держит уровень", () => {
    const level = levelById("tbuf")!;
    // Оба затвора от одного инвертора A — выход всегда включён
    const parts = level.recipe.parts.filter((p) => p.id !== "D2" && p.id !== "D3");
    const nets = [["P5", "D1.5"], ["P3", "D1.3"], ["P5", "VT1.S"], ["VT2.S", "P3"], ["VT1.D", "VT2.D", "P4"], ["P2", "D1.2"], ["D1.4", "VT1.G", "VT2.G"]];
    const scene = recipeScene({ ...level, recipe: { parts, nets } }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.rows.filter((x) => x.z?.[0]).every((x) => !x.ok), rowsText(r)).toBe(true);
  }, 60000);
});

describe("шина из моделей 74LVC1G125", () => {
  const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  const P = (id: string, p: number) => ({ comp: id, pin: p - 1 });
  /** Два буфера на одном проводе: A1 = 1, A2 = 0; разрешены — en1, en2. */
  function bus(en1: boolean, en2: boolean) {
    const d = refById.get("ref:tbuf")!;
    const chip = (id: string) => ({ id, type: "chip" as const, def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f });
    const scene = {
      components: [{ id: "G1", type: "psu" as const, volts: 5, amps: 1, on: true, placement: f }, chip("D1"), chip("D2"), { id: "RL", type: "resistor" as const, variant: "tht" as const, ohms: 1_000_000, smdSize: "0805" as const, placement: f }],
      wires: [
        [plus, P("D1", 5)], [minus, P("D1", 3)], [plus, P("D2", 5)], [minus, P("D2", 3)],
        [plus, P("D1", 2)], [minus, P("D2", 2)],
        [en1 ? minus : plus, P("D1", 1)], [en2 ? minus : plus, P("D2", 1)],
        [P("D1", 4), P("D2", 4)], [P("D1", 4), { comp: "RL", pin: 0 }], [{ comp: "RL", pin: 1 }, minus],
      ].map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
      boards: [],
      chips: allChips,
    };
    const sim = new Simulation(scene as never);
    sim.solve();
    const hurt = new Set<string>();
    for (let t = 0; t < 1; t += 0.05) for (const c of sim.step(0.05)) hurt.add(c.id);
    const u = scene.components[1];
    const v = (sim.solution.voltage.get(pinNode(u as never, 3)) ?? 0) - (sim.solution.voltage.get(pinNode(u as never, 2)) ?? 0);
    return { v, over: Math.max(sim.overload(scene.components[1] as never), sim.overload(scene.components[2] as never)), hurt: [...hurt], model: !!sim.modelOf("D1") };
  }
  it("говорит тот, кому разрешено; оба отключены — шина уходит к подтяжке", () => {
    const a = bus(true, false);
    expect(a.model).toBe(true);
    expect(a.v).toBeGreaterThan(4.5);
    expect(bus(false, true).v).toBeLessThan(0.5);
    expect(bus(false, false).v).toBeLessThan(0.1);
  });
  it("оба разрешены с разными уровнями — конфликт на шине: перегрузка", () => {
    const c = bus(true, true);
    expect(c.over > 1 || c.hurt.length > 0, JSON.stringify(c)).toBe(true);
  });
});
