import { describe, expect, it } from "vitest";
import { LONG_CLOCKS, LONG_PROGRAM, m2Emulate } from "../src/career/projects";
import { IDLE, MICROCODE, mem, projLong as proj } from "./mem-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const withOp = (op: number, byte: number) => MICROCODE.map((b, a) => ((a & 15) === op ? byte : b));
const long = (mc = MICROCODE, mutate?: Parameters<typeof mem>[1]) => mem(mc, mutate, true);

describe("Длинные программы", () => {
  it("программа: 13 × 11 = 143 сложением, потом 5A и стоп", () => {
    const o = m2Emulate(LONG_PROGRAM, LONG_CLOCKS, 8, 8);
    expect(o).toContain(0x8f);
    expect(o.slice(-5)).toEqual([0x5a, 0x5a, 0x5a, 0x5a, 0x5a]);
    expect(new Set(o).size).toBe(13);
  });
  it("эталон проходит; длинный выход сжат повторами", () => {
    const steps = proj.check(long());
    expect(ok(steps), text(steps)).toBe(true);
    expect(steps.find((x) => x.text.startsWith("Такт"))!.text).toContain("8F ×10");
  }, 300000);
  for (const [what, op, byte] of [
    ["HLT не останавливает", 15, IDLE],
    ["JMP не грузит счётчик", 9, IDLE],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(long(withOp(op, byte)))), what).toBe(false);
    }, 300000);
  it("старший счётчик считает всегда (ENT — к питанию, а не к RCO младшего) — не проходит", () => {
    const steps = proj.check(long(undefined, (w) => w.map(([a, b]) => (JSON.stringify(b) === JSON.stringify({ comp: "PH", pin: 9 }) && JSON.stringify(a) === JSON.stringify({ comp: "PC", pin: 14 }) ? [{ comp: "G1", pin: 1 }, b] : [a, b]))));
    expect(run(steps), text(steps)).toBe(false);
  }, 300000);
});
