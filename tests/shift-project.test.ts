import { describe, expect, it } from "vitest";
import { SHIFT_CLOCKS, SHIFT_PROGRAM, m2rEmulate } from "../src/career/projects";
import { SHIFT_MICROCODE, SHIFT_STACK, projShift as proj, regs } from "./regs-build";
import { P } from "./module-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const sh = (mc?: number[], st?: number[], mutate?: Parameters<typeof regs>[2]) => regs(mc, st, mutate, false, false, true);
const withF = (mc: number[], f: number, byte: number) => mc.map((b, a) => ((a & 15) === 0 && ((a >> 6) & 3) === 1 && a >> 8 === f ? byte : b));

describe("Сдвиг", () => {
  it("программа: …, 97, трижды SHR — 12, 00 и стоп", () => {
    const o = m2rEmulate(SHIFT_PROGRAM, SHIFT_CLOCKS, undefined, true, true, true);
    const changes = o.filter((v, i) => i === 0 || v !== o[i - 1]);
    expect(changes).toEqual([0, 0x35, 0x9e, 0x06, 0x6f, 0x01, 0x97, 0x12, 0]);
    expect(o.slice(-7).every((v) => v === 0)).toBe(true);
    expect(SHIFT_CLOCKS % 3).not.toBe(0);
    expect(m2rEmulate(SHIFT_PROGRAM, SHIFT_CLOCKS, undefined, true, true)).not.toEqual(o);
    const noHalt = { op: SHIFT_PROGRAM.op.map((b, a) => (a === 0x4d ? 0 : b)), n: SHIFT_PROGRAM.n };
    expect(m2rEmulate(noHalt, SHIFT_CLOCKS, undefined, true, true, true)).toContain(0x77);
  });
  it("эталон проходит", () => {
    const steps = proj.check(sh());
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  it("микрокод с ошибкой: SHR без RET — таблица выдаёт ~шину — не проходит", () => {
    expect(run(proj.check(sh(SHIFT_MICROCODE, withF(SHIFT_STACK, 7, 0xbe))))).toBe(false);
  }, 300000);
  it("старший разряд сдвига — из A7, а не 0 (вращение) — не проходит", () => {
    const steps = proj.check(sh(undefined, undefined, (w) => w.map(([a, b]) => (JSON.stringify(b) === JSON.stringify(P("SH1", 13)) ? [P("M1", 20), b] : [a, b]))));
    expect(run(steps), text(steps)).toBe(false);
  }, 300000);
});
