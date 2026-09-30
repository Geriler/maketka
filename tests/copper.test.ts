import { describe, expect, it } from "vitest";
import { HOLE_BY_ID, applyBoards, type BoardSpec } from "../src/model/breadboard";
import { copperContacts, foreignContacts } from "../src/model/copper";
import type { Scene } from "../src/model/types";
import { Simulation, pinNode } from "../src/sim/simulation";
import { setLibrary } from "../src/chips/registry";
import cpuSmd from "./fixtures/cpu-smd.json";

setLibrary([]);

/** Плата под SMD с узлами (id, x, z) — точками, через которые идут дорожки. */
function board(nodes: [string, number, number][]): BoardSpec {
  const b: BoardSpec = { id: "S1", kind: "smd", x: 0, z: 0, cols: 24, rows: 15, seats: nodes.map(([id, x, z]) => ({ id, fp: "NODE", x, z, rot: 0 })) };
  applyBoards([b]);
  return b;
}
const T = (pairs: [string, string][]) => pairs.map(([a, b], i) => ({ id: `T${i}`, a: `s:${a}.1`, b: `s:${b}.1` }));

describe("медь платы: что касается — соединено", () => {
  it("крест из двух дорожек — касание; через клетку (0,635 мм) параллельно — нет; общий узел — не касание", () => {
    board([["a", -2, 0], ["b", 2, 0], ["c", 0, -2], ["d", 0, 2], ["e", -2, 0.25], ["f", 2, 0.25], ["g", 4, 0]]);
    expect(copperContacts(T([["a", "b"], ["c", "d"]]))).toHaveLength(1);
    expect(foreignContacts({ components: [], wires: [], traces: T([["a", "b"], ["c", "d"]]) })).toHaveLength(1);
    expect(copperContacts(T([["a", "b"], ["e", "f"]]))).toEqual([]);
    expect(copperContacts(T([["a", "b"], ["b", "g"]]))).toEqual([]);
  });

  it("дорожка поверх чужого узла (площадки) — касание", () => {
    board([["a", -2, 0], ["b", 2, 0], ["m", 0, 0]]);
    const k = copperContacts(T([["a", "b"]]));
    expect(k.map((x) => x.other)).toEqual([{ hole: "s:m.1" }]);
  });

  it("в расчёте пересечённые дорожки замкнуты, перемычка над дорожкой — нет", () => {
    board([["a", -2, 0], ["b", 2, 0], ["c", 0, -2], ["d", 0, 2], ["c2", 0, -1], ["d2", 0, 1]]);
    const at = (id: string) => HOLE_BY_ID.get(`s:${id}.1`)!.node;
    const scene = (traces: ReturnType<typeof T>, wires: Scene["wires"] = []): Scene => ({
      components: [
        { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: { mode: "free", x: 0, z: 20, rot: 0 } },
        { id: "R1", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: { mode: "free", x: 5, z: 20, rot: 0 } },
      ],
      // +5 В — на дорожку a–b; дорожка c–d через 1 кОм к общему
      wires: [
        { id: "W1", a: { comp: "G1", pin: 1 }, b: { hole: "s:a.1" }, color: "" },
        { id: "W2", a: { hole: "s:d.1" }, b: { comp: "R1", pin: 0 }, color: "" },
        { id: "W3", a: { comp: "R1", pin: 1 }, b: { comp: "G1", pin: 0 }, color: "" },
        ...wires,
      ],
      boards: [board([["a", -2, 0], ["b", 2, 0], ["c", 0, -2], ["d", 0, 2], ["c2", 0, -1], ["d2", 0, 1]])],
      traces,
    });
    const v = (s: Scene) => {
      const sim = new Simulation(s);
      sim.solve();
      return sim.solution.voltage.get(at("d"))! - sim.solution.voltage.get(pinNode(s.components[0], 0))!;
    };
    // Крест: c–d пересекает a–b — на d те же 5 В
    expect(v(scene(T([["a", "b"], ["c", "d"]])))).toBeGreaterThan(4.9);
    // Через a–b — перемычкой: c–c2 и d2–d дорожками, c2–d2 проводом над платой — не замкнуто
    expect(v(scene(T([["a", "b"], ["c", "c2"], ["d2", "d"]]), [{ id: "WJ", a: { hole: "s:c2.1" }, b: { hole: "s:d2.1" }, color: "", shape: "flat" }]))).toBeLessThan(0.01);
  });

  it("разводка процессора на плате под SMD: медь нигде не касается чужой (своей — бывает, это не замыкание)", () => {
    applyBoards([cpuSmd.board as BoardSpec]);
    const scene = { components: cpuSmd.components, wires: cpuSmd.wires, traces: cpuSmd.traces, boards: [cpuSmd.board] } as unknown as Scene;
    expect(copperContacts(cpuSmd.traces).length).toBeGreaterThan(0);
    expect(foreignContacts(scene)).toEqual([]);
  });
});
