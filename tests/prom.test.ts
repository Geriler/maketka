import { describe, expect, it } from "vitest";
import { setLibrary, setReference } from "../src/chips/registry";
import { PROM_ID, memoryChips, parseWord, promDef } from "../src/chips/memory";
import { chipCat } from "../src/ui/tools";
import { chipAbout } from "../src/chips/about";
import { Simulation } from "../src/sim/simulation";
import { pinNode } from "../src/sim/nodes";
import "../src/career/build";

setLibrary([]);
setReference(memoryChips());

/** ПЗУ на столе: адрес addr, G̅ = g; выходы — на 100 кОм к общему. Напряжения Q0…Q7. */
function read(data: number[] | undefined, addr: number, g = false, volts = 5) {
  const d = promDef();
  const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
  const plus = { comp: "G1", pin: 1 }, minus = { comp: "G1", pin: 0 };
  const P = (p: number) => ({ comp: "U", pin: p - 1 });
  const q = [1, 2, 3, 4, 5, 6, 7, 9];
  const scene = {
    components: [
      { id: "G1", type: "psu" as const, volts, amps: 1, on: true, placement: f },
      { id: "U", type: "chip" as const, def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f, ...(data ? { data } : {}) },
      ...q.map((_, k) => ({ id: `R${k}`, type: "resistor" as const, variant: "tht" as const, ohms: 100_000, smdSize: "0805" as const, placement: f })),
    ],
    wires: [
      [plus, P(16)], [minus, P(8)], [g ? plus : minus, P(15)],
      ...[10, 11, 12, 13, 14].map((p, i) => [addr & (1 << i) ? plus : minus, P(p)]),
      ...q.map((p, k) => [P(p), { comp: `R${k}`, pin: 0 }]),
      ...q.map((_, k) => [{ comp: `R${k}`, pin: 1 }, minus]),
    ].map(([a, b], i) => ({ id: `W${i}`, a, b, color: "" })),
    boards: [],
    chips: { [d.id]: d },
  };
  const sim = new Simulation(scene as never);
  sim.solve();
  const u = scene.components[1];
  return { model: !!sim.modelOf("U"), v: q.map((p) => sim.solution.voltage.get(pinNode(u as never, p - 1)) ?? 0), amps: Math.abs(sim.current(scene.components[0] as never)) };
}
const bits = (v: number[]) => v.reduce((m, x, k) => m | (x > 2.5 ? 1 << k : 0), 0);

describe("ПЗУ 74S288 (32 × 8)", () => {
  it("выдаёт прошитое слово по адресу; непрошитое — нули", () => {
    const data = Array.from({ length: 32 }, (_, a) => (a * 37 + 5) & 255);
    for (const a of [0, 1, 7, 16, 31]) {
      const r = read(data, a);
      expect(r.model).toBe(true);
      expect(bits(r.v), `адрес ${a}`).toBe(data[a]);
    }
    expect(bits(read(undefined, 9).v)).toBe(0);
  });
  it("единица — как у TTL (около 3,5 В), ноль — у общего; потребляет около 70 мА", () => {
    const r = read([0b1010_1010], 0);
    expect(Math.min(...r.v.filter((_, k) => k % 2))).toBeGreaterThan(3.2);
    expect(Math.max(...r.v.filter((_, k) => !(k % 2)))).toBeLessThan(0.2);
    expect(r.amps).toBeGreaterThan(0.06);
    expect(r.amps).toBeLessThan(0.09);
  });
  it("G̅ = 1 — выходы отключены: нагрузка тянет их к общему", () => {
    expect(Math.max(...read([255], 0, true).v)).toBeLessThan(0.05);
  });
  it("запись слова: шестнадцатеричное, двоичное, десятичное; мусор — нет", () => {
    expect(parseWord("3F")).toBe(63);
    expect(parseWord("0xff")).toBe(255);
    expect(parseWord("00111111")).toBe(63);
    expect(parseWord("d63")).toBe(63);
    expect(parseWord("")).toBe(0);
    expect(parseWord("1FF")).toBeUndefined();
    expect(parseWord("zz")).toBeUndefined();
  });
  it("в меню — раздел «Память», есть описание", () => {
    expect(chipCat(`chip:${PROM_ID}`)).toBe("Память");
    expect(chipAbout(PROM_ID)).toMatch(/32 слова/);
  });
});
