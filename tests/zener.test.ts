import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { Component, DiodeKind, Scene } from "../src/model/types";

const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };

/** Источник volts → резистор ohms → стабилитрон (катод к плюсу, если reverse) → минус. */
function bench(kind: DiodeKind, volts: number, ohms: number, reverse = true) {
  const scene: Scene = {
    components: [
      { id: "G1", type: "psu", volts, amps: 5, on: true, placement: f },
      { id: "R1", type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: f },
      { id: "VD1", type: "diode", kind, placement: f } as Component,
    ],
    wires: [
      { id: "W1", a: { comp: "G1", pin: 1 }, b: { comp: "R1", pin: 0 }, color: "" },
      { id: "W2", a: { comp: "R1", pin: 1 }, b: { comp: "VD1", pin: reverse ? 1 : 0 }, color: "" },
      { id: "W3", a: { comp: "VD1", pin: reverse ? 0 : 1 }, b: { comp: "G1", pin: 0 }, color: "" },
    ],
    boards: [],
  };
  const sim = new Simulation(scene);
  sim.solve();
  const d = scene.components[2];
  return { v: Math.abs(sim.voltage(d)), i: Math.abs(sim.current(d)), sim, d };
}

describe("стабилитрон BZX55", () => {
  it("5V1: 5,1 В при 5 мА, наклон ≈ 20 Ом (по даташиту ≤ 35), при 1 мА — не хуже 550 Ом", () => {
    // Подбираем резистор, чтобы ток был ≈ 5 мА: (12 − 5,1) / 1380 ≈ 5 мА
    const a = bench("BZX55C5V1", 12, 1380);
    expect(a.i).toBeCloseTo(0.005, 3);
    expect(a.v).toBeGreaterThan(5.08);
    expect(a.v).toBeLessThan(5.12);
    const b = bench("BZX55C5V1", 12, 1150); // ≈ 6 мА
    const zz = (b.v - a.v) / (b.i - a.i);
    expect(zz).toBeGreaterThan(10);
    expect(zz).toBeLessThan(35);
    const lo = bench("BZX55C5V1", 12, 6900); // ≈ 1 мА
    const lo2 = bench("BZX55C5V1", 12, 5800);
    expect((lo2.v - lo.v) / (lo2.i - lo.i)).toBeLessThan(550);
  });
  it("6V2: 6,2 В при 5 мА; ниже пробоя ток почти не идёт", () => {
    const a = bench("BZX55C6V2", 12, 1160);
    expect(a.v).toBeGreaterThan(6.15);
    expect(a.v).toBeLessThan(6.25);
    // 5 В на стабилитроне 6,2 В — меньше 0,1 мкА (даташит: IR < 0,1 мкА при 2 В; при 5 В — всё ещё мало)
    const off = bench("BZX55C6V2", 5, 1000);
    expect(off.i).toBeLessThan(1e-6);
  });
  it("в прямую сторону — как обычный диод, ≈ 0,7–0,9 В при 10 мА", () => {
    const fw = bench("BZX55C5V1", 5, 430, false);
    expect(fw.v).toBeGreaterThan(0.6);
    expect(fw.v).toBeLessThan(0.95);
  });
  it("без резистора от 12 В сгорает (мощность больше 0,5 Вт)", () => {
    const { sim, d } = bench("BZX55C5V1", 12, 1);
    const burned = new Set<string>();
    for (let t = 0; t < 3; t += 0.05) for (const c of sim.step(0.05)) burned.add(c.id);
    expect(burned.has(d.id) || sim.state(d.id).burned).toBe(true);
  });
});
