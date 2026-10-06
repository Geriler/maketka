import { describe, expect, it } from "vitest";
import { RR_CLOCKS, RR_PROGRAM, REGS_PROGRAM, REGS_CLOCKS, m2rEmulate } from "../src/career/projects";
import { RR_MICROCODE, RR_STACK, projRR as proj, regs } from "./regs-build";
import { P } from "./module-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const rr = (mc?: number[], st?: number[], mutate?: Parameters<typeof regs>[2]) => regs(mc, st, mutate, true);
/** Слово для кода 0, второго такта и f — заменить. */
const withF = (mc: number[], f: number, byte: number) => mc.map((b, a) => ((a & 15) === 0 && ((a >> 6) & 3) === 1 && a >> 8 === f ? byte : b));

describe("Регистр с регистром", () => {
  it("программа: 37, Фибоначчи 90 и E9, потом 22, 00 и стоп", () => {
    const o = m2rEmulate(RR_PROGRAM, RR_CLOCKS, undefined, true);
    const changes = o.filter((v, i) => i === 0 || v !== o[i - 1]);
    expect(changes).toEqual([0, 0x37, 0x90, 0xe9, 0x22, 0]);
    expect(changes.reduce((m, v) => m | v, 0)).toBe(0xff);
    expect(o.slice(-7).every((v) => v === 0)).toBe(true);
    expect(RR_CLOCKS % 3).not.toBe(0);
  });
  it("без rr код 0 — NOP: программа «Регистров» не меняется, а здешняя считает иначе", () => {
    expect(m2rEmulate(REGS_PROGRAM, REGS_CLOCKS, undefined, true)).toEqual(m2rEmulate(REGS_PROGRAM, REGS_CLOCKS));
    expect(m2rEmulate(RR_PROGRAM, RR_CLOCKS)).not.toEqual(m2rEmulate(RR_PROGRAM, RR_CLOCKS, undefined, true));
  });
  it("эталон проходит", () => {
    const steps = proj.check(rr());
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  for (const [what, mc] of [
    ["MOV ничего не делает", withF(RR_MICROCODE, 0, 0x8b)],
    ["ADD r, s складывает с N", withF(RR_MICROCODE, 1, 0x8e)],
    ["SUB r, s — как ADD", withF(RR_MICROCODE, 2, 0xce)],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(rr(mc, RR_STACK))), what).toBe(false);
    }, 300000);
  it("адрес регистров всегда r (выбор 74HC157 — к общему) — не проходит", () => {
    const steps = proj.check(rr(undefined, undefined, (w) => w.map(([a, b]) => (JSON.stringify(b) === JSON.stringify(P("MR", 1)) ? [{ comp: "G1", pin: 0 }, b] : [a, b]))));
    expect(run(steps), text(steps)).toBe(false);
  }, 300000);
});
