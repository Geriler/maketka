import { describe, expect, it } from "vitest";
import { REGS_CLOCKS, REGS_PROGRAM, m2rEmulate } from "../src/career/projects";
import { REGS_MICROCODE, REGS_STACK, proj, regs } from "./regs-build";
import { P } from "./module-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
/** Слово микрокода для кода op в такте step — заменить. */
const withStep = (mc: number[], op: number, step: number, byte: number) => mc.map((b, a) => ((a & 15) === op && a >> 6 === step ? byte : b));

describe("Регистры", () => {
  it("программа: 5A, 13 × 3 = 27, 67, FF, 0D, 27, 00 и стоп; команда — три такта", () => {
    const o = m2rEmulate(REGS_PROGRAM, REGS_CLOCKS);
    const changes = o.filter((v, i) => i === 0 || v !== o[i - 1]);
    expect(changes).toEqual([0, 0x5a, 0x27, 0x67, 0xff, 0x0d, 0x27, 0]);
    expect(o.slice(-7).every((v) => v === 0)).toBe(true);
    // Выход меняется на втором такте команды OUT
    expect(o.indexOf(0x5a)).toBe(4);
    expect(o.indexOf(0x27) % 3).toBe(1);
    expect(REGS_CLOCKS % 3).not.toBe(0);
  });
  it("регистры не путаются: OUT r при r = 0 выводит мусор из ОЗУ", () => {
    const op = Array(256).fill(0), n = Array(256).fill(0);
    op[0] = 0x80; op[1] = 0xf0;
    expect(m2rEmulate({ op, n }, 6)).toEqual([0, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c]);
  });
  it("эталон проходит", () => {
    const steps = proj.check(regs());
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  for (const [what, mc, st] of [
    ["не пишет регистр обратно", REGS_MICROCODE, REGS_STACK.map((b, a) => (a >> 6 === 2 ? b | 0x20 : b))],
    ["нет такта «A ← Rr» (регистры не на шину)", REGS_MICROCODE, REGS_STACK.map((b, a) => (a >> 6 === 0 ? b | 0x10 : b))],
    ["команда не кончается (E̅N̅D̅ не включается)", REGS_MICROCODE, REGS_STACK.map((b) => b | 0x08)],
    ["JC в третьем такте не переходит", withStep(REGS_MICROCODE, 10, 2, 0x8b), REGS_STACK],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(regs(mc, st))), what).toBe(false);
    }, 300000);
  it("номер такта не сбрасывается RST (M̅R̅ — к питанию) — не проходит", () => {
    const steps = proj.check(regs(undefined, undefined, (w) => w.map(([a, b]) => (JSON.stringify(b) === JSON.stringify(P("SC", 1)) ? [{ comp: "G1", pin: 1 }, b] : [a, b]))));
    expect(run(steps), text(steps)).toBe(false);
  }, 300000);
});
