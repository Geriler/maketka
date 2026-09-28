import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { referenceChips } from "../src/career/build";
import { Simulation, pinNode } from "../src/sim/simulation";
import type { Component, Endpoint, Scene } from "../src/model/types";

setLibrary([]);
const refs = referenceChips();
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const def = (id: string) => refs.find((d) => d.id === id)!;
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };

describe("счётчик 0…9 из 74HC393 со сбросом по И (QB·QD)", () => {
  it("считает 1, 2, … 9, 0, 1 — сброс на 10 не зацикливается в «не определено»", () => {
    const c393 = def("ref:cnt393"), and = def("ref:and");
    const comps: Component[] = [
      { id: "G1", type: "psu", volts: 5, amps: 1, on: true, placement: f },
      { id: "G2", type: "psu", volts: 5, amps: 1, on: true, placement: f },
      { id: "D1", type: "chip", def: c393.id, name: c393.name, package: c393.package, pins: c393.pins, placement: f },
      { id: "D2", type: "chip", def: and.id, name: and.name, package: and.package, pins: and.pins, placement: f },
    ];
    const P = (id: string, p: number): Endpoint => ({ comp: id, pin: p - 1 });
    const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
    const w: [Endpoint, Endpoint][] = [
      [plus, P("D1", 14)], [minus, P("D1", 7)], [plus, P("D2", 5)], [minus, P("D2", 3)],
      [{ comp: "G2", pin: 0 }, minus], [{ comp: "G2", pin: 1 }, P("D1", 1)],
      [P("D1", 4), P("D2", 1)], [P("D1", 6), P("D2", 2)], [P("D2", 4), P("D1", 2)],
      [plus, P("D1", 12)], [minus, P("D1", 13)],
    ];
    const scene: Scene = { components: comps, wires: w.map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })), boards: [], chips: allChips };
    const sim = new Simulation(scene);
    const g2 = comps[1] as Extract<Component, { type: "psu" }>;
    const v = (p: number) => sim.solution.voltage.get(pinNode(comps[2], p - 1))! > 2.5;
    const count = () => [3, 4, 5, 6].reduce((n, p, k) => n + (v(p) ? 1 << k : 0), 0);
    sim.solve();
    sim.step(0.01);
    const start = count();
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      g2.volts = 0; sim.solve(); sim.step(0.005); // спад — счёт
      g2.volts = 5; sim.solve(); sim.step(0.005);
      seen.push(count());
    }
    const want = Array.from({ length: 12 }, (_, i) => (start + i + 1) % 10);
    expect(seen).toEqual(want);
    // Ни один выход не «ни то ни сё»
    for (const p of [3, 4, 5, 6]) {
      const x = sim.solution.voltage.get(pinNode(comps[2], p - 1))!;
      expect(x < 1 || x > 4).toBe(true);
    }
  });
});
