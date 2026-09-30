import { describe, expect, it } from "vitest";
import { HOLE_BY_ID, applyBoards, type BoardSpec } from "../src/model/breadboard";
import { copperContacts, foreignContacts, traceNodes } from "../src/model/copper";
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

  it("разводка процессора на двусторонней плате: медь нигде не касается чужой ни сверху, ни снизу (своей — бывает, это не замыкание)", () => {
    applyBoards([cpuSmd.board as BoardSpec]);
    const scene = { components: cpuSmd.components, wires: cpuSmd.wires, traces: cpuSmd.traces, boards: [cpuSmd.board] } as unknown as Scene;
    expect(copperContacts(scene.traces!).length).toBeGreaterThan(0);
    expect(foreignContacts(scene)).toEqual([]);
  });

  describe("двусторонняя плата", () => {
    /** Плата с медью с обеих сторон: узлы (id, x, z, снизу?) и переходы (id, x, z), резистор 0805 R1 в (6, 0). */
    const two = (nodes: [string, number, number, boolean?][], vias: [string, number, number][] = []): BoardSpec => {
      const b: BoardSpec = {
        id: "S1", kind: "smd", x: 0, z: 0, cols: 24, rows: 15, layers: 2,
        seats: [
          ...nodes.map(([id, x, z, bottom]) => ({ id, fp: "NODE" as const, x, z, rot: 0, ...(bottom ? { side: "bottom" as const } : {}) })),
          ...vias.map(([id, x, z]) => ({ id, fp: "VIA" as const, x, z, rot: 0 })),
          { id: "R1", fp: "0805" as const, x: 6, z: 0, rot: 0 },
        ],
      };
      applyBoards([b]);
      return b;
    };
    const on = (b: BoardSpec, traces: Scene["traces"], wires: Scene["wires"] = []): Scene => ({ components: [], wires, traces, boards: [b] });

    it("верхняя и нижняя дорожки крест-накрест не касаются; две нижние — касаются", () => {
      two([["a", -2, 0], ["b", 2, 0], ["c", 0, -2, true], ["d", 0, 2, true], ["e", -1, -1, true], ["f", 1, 1, true]]);
      const tr = (a: string, b2: string, id: string, bottom?: boolean) => ({ id, a: `s:${a}.1`, b: `s:${b2}.1`, ...(bottom ? { side: "bottom" as const } : {}) });
      expect(copperContacts([tr("a", "b", "T1"), tr("c", "d", "T2", true)])).toEqual([]);
      expect(copperContacts([tr("c", "d", "T1", true), tr("e", "f", "T2", true)])).toHaveLength(1);
    });

    it("нижняя дорожка не достаёт до SMD-площадки (она сверху) и не касается её, проходя под ней", () => {
      const b = two([["u", 4, -2, true], ["v", 6, 2, true], ["w", 6, -2, true]]);
      // u → площадка R1.1 снизу: конец висит; v–w под резистором: площадок не задевает
      const t1 = { id: "T1", a: "s:u.1", b: "s:R1.1", side: "bottom" as const };
      const t2 = { id: "T2", a: "s:v.1", b: "s:w.1", side: "bottom" as const };
      expect(copperContacts([t1, t2])).toEqual([]);
      const [, end] = traceNodes(t1);
      expect(end).not.toBe(HOLE_BY_ID.get("s:R1.1")!.node);
      expect(foreignContacts(on(b, [t1, t2]))).toEqual([]);
    });

    it("переход соединяет стороны: сверху к переходу, снизу от него — одна цепь, ток идёт", () => {
      const b = two([["a", -4, 0], ["d", 4, 0, true]], [["V1", 0, 2]]);
      const scene: Scene = {
        components: [
          { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: { mode: "free", x: 0, z: 20, rot: 0 } },
          { id: "R2", type: "resistor", variant: "tht", ohms: 1000, smdSize: "0805", placement: { mode: "free", x: 5, z: 20, rot: 0 } },
        ],
        wires: [
          { id: "W1", a: { comp: "G1", pin: 1 }, b: { hole: "s:a.1" }, color: "" },
          { id: "W2", a: { hole: "s:d.1" }, b: { comp: "R2", pin: 0 }, color: "" },
          { id: "W3", a: { comp: "R2", pin: 1 }, b: { comp: "G1", pin: 0 }, color: "" },
        ],
        traces: [{ id: "T1", a: "s:a.1", b: "s:V1.1" }, { id: "T2", a: "s:V1.1", b: "s:d.1", side: "bottom" }],
        boards: [b],
      };
      const sim = new Simulation(scene);
      sim.solve();
      const i = (5 - 0) / 1000;
      expect(sim.solution.voltage.get(HOLE_BY_ID.get("s:d.1")!.node)! - sim.solution.voltage.get(pinNode(scene.components[0], 0))!).toBeCloseTo(5, 1);
      expect(i).toBeGreaterThan(0);
      // Нижняя дорожка к узлу сверху (не к переходу, мимо него) — не соединяет
      scene.traces = [{ id: "T1", a: "s:a.1", b: "s:V1.1" }, { id: "T2", a: "s:a.1", b: "s:d.1", side: "bottom" }];
      const sim2 = new Simulation(scene);
      sim2.solve();
      expect(sim2.solution.voltage.get(HOLE_BY_ID.get("s:d.1")!.node)! - sim2.solution.voltage.get(pinNode(scene.components[0], 0))!).toBeLessThan(0.01);
    });
  });
});
