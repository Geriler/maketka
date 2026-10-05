import { describe, expect, it } from "vitest";
import { M32_CLOCKS, M32_PROGRAM, m2Emulate } from "../src/career/projects";
import { IDLE, MICROCODE } from "./mem-build";
import { m32, proj } from "./m32-build";
import { Simulation } from "../src/sim/simulation";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const withOp = (op: number, byte: number) => MICROCODE.map((b, a) => ((a & 15) === op ? byte : b));

describe("М2 на 32 бита", () => {
  it("программа: FFFFFFFF, перенос через 32 разряда, заём через 32 разряда, стоп", () => {
    const o = m2Emulate(M32_PROGRAM, M32_CLOCKS, 32, 8);
    expect([...new Set(o)]).toEqual([0, 0xffffffff, 0xa5a5a5a6]);
    expect(o.slice(-5)).toEqual([0, 0, 0, 0, 0]);
  });
  it("эталон проходит", () => {
    const t0 = performance.now();
    const steps = proj.check(m32());
    expect(ok(steps), text(steps)).toBe(true);
    expect(steps.find((x) => x.text.startsWith("Такт"))!.text).toContain("FFFFFFFF");
    expect(performance.now() - t0).toBeLessThan(30000);
  }, 300000);
  for (const [what, op, byte] of [
    ["HLT не останавливает", 15, IDLE],
    ["ST не пишет в ОЗУ", 3, IDLE],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(m32(withOp(op, byte)))), what).toBe(false);
    }, 300000);
  it("перенос оборван в середине (CI модуля M4 — к общему) — не проходит", () => {
    const steps = proj.check(m32(undefined, (w) => w.map(([a, b]) => (JSON.stringify(a) === JSON.stringify({ comp: "M3", pin: 11 }) && JSON.stringify(b) === JSON.stringify({ comp: "M4", pin: 10 }) ? [{ comp: "G1", pin: 0 }, b] : [a, b]))));
    expect(run(steps), text(steps)).toBe(false);
  }, 300000);
  it("блок питания в ограничении тока не поднимает напряжение выше уставки (большая схема, RST)", () => {
    // Модели не раскрываются (как в прогоне проверки) — так блок и застревал в CC на 9,4 В
    const sim = new Simulation(JSON.parse(JSON.stringify(m32())), undefined, { strictModels: true });
    for (let i = 0; i < 20; i++) sim.step(0.005);
    sim.held.add("SB2");
    sim.solve();
    expect(Math.abs(sim.branch("G1").voltage)).toBeLessThanOrEqual(5 * 1.001);
  }, 300000);
  it("у микросхемы нет питания — проверка не запускает прогон и сразу говорит, у какой", () => {
    const t0 = performance.now();
    const steps = proj.check(m32(undefined, (w) => w.filter(([a, b]) => !(JSON.stringify(a) === JSON.stringify({ comp: "G1", pin: 1 }) && JSON.stringify(b) === JSON.stringify({ comp: "MX0", pin: 15 })))));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(steps.find((x) => x.text.startsWith("Прогон не запускался"))?.text).toContain("MX0.16 (питание)");
  }, 300000);
});
