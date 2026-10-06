import { describe, expect, it } from "vitest";
import { LOGIC_CLOCKS, LOGIC_PROGRAM, m2rEmulate } from "../src/career/projects";
import { LOGIC_MICROCODE, LOGIC_STACK, OPERAND_TABLE, projLogic as proj, regs } from "./regs-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const lg = (mc?: number[], st?: number[], table?: number[]) => {
  const sc = regs(mc, st, undefined, false, true);
  if (table) for (const c of sc.components) if (c.type === "chip" && (c.id === "AL" || c.id === "AH")) c.data = table;
  return sc;
};
const withF = (mc: number[], f: number, byte: number) => mc.map((b, a) => ((a & 15) === 0 && ((a >> 6) & 3) === 1 && a >> 8 === f ? byte : b));

describe("Логика", () => {
  it("программа: 35, 9E, 06, 6F, 01, 97, 00 и стоп; без логики — иначе", () => {
    const o = m2rEmulate(LOGIC_PROGRAM, LOGIC_CLOCKS, undefined, true, true);
    const changes = o.filter((v, i) => i === 0 || v !== o[i - 1]);
    expect(changes).toEqual([0, 0x35, 0x9e, 0x06, 0x6f, 0x01, 0x97, 0]);
    expect(changes.reduce((m, v) => m | v, 0)).toBe(0xff);
    expect(o.slice(-7).every((v) => v === 0)).toBe(true);
    expect(LOGIC_CLOCKS % 3).not.toBe(0);
    expect(m2rEmulate(LOGIC_PROGRAM, LOGIC_CLOCKS, undefined, true)).not.toEqual(o);
    // HLT как NOP: LDI 77 и OUT успевают до конца проверки
    const noHalt = { op: LOGIC_PROGRAM.op.map((b, a) => (a === 0x49 ? 0 : b)), n: LOGIC_PROGRAM.n };
    expect(m2rEmulate(noHalt, LOGIC_CLOCKS, undefined, true, true)).toContain(0x77);
  });
  it("эталон проходит", () => {
    const steps = proj.check(lg());
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  for (const [what, mc, st] of [
    ["AND как OR", withF(LOGIC_MICROCODE, 4, 0xca), LOGIC_STACK],
    ["XOR без «логики» — как SUB", LOGIC_MICROCODE, withF(LOGIC_STACK, 6, 0xee)],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(lg(mc, st))), what).toBe(false);
    }, 300000);
  it("таблица с ошибкой: XOR — как OR — не проходит", () => {
    const bad = OPERAND_TABLE.map((v, x) => (x >> 14 && ((x >> 12) & 3) === 2 ? (x & 15) | ((x >> 4) & 15) : v));
    expect(run(proj.check(lg(undefined, undefined, bad)))).toBe(false);
  }, 300000);
});
