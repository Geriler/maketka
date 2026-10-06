import { describe, expect, it } from "vitest";
import { CALL_CLOCKS, CALL_PROGRAM, m2Emulate } from "../src/career/projects";
import { CALL_MICROCODE, STACK_IDLE, STACK_MICROCODE, call, proj } from "./call-build";
import { P } from "./module-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const withOp = (mc: number[], op: number, byte: number) => mc.map((b, a) => ((a & 15) === op ? byte : b));
const same = (a: { comp: string; pin: number } | { hole: string }, b: { comp: string; pin: number }) => JSON.stringify(a) === JSON.stringify(b);

describe("Подпрограммы", () => {
  it("программа: удвоения, вложенность 3, рекурсия глубиной 5, B0 и стоп", () => {
    const o = m2Emulate(CALL_PROGRAM, CALL_CLOCKS, 8, 8);
    const changes = o.filter((v, i) => i === 0 || v !== o[i - 1]);
    expect(changes).toEqual([0, 2, 8, 0x40, 2, 5, 4, 3, 2, 1, 0, 0xb0]);
    // Каждый разряд выхода хоть раз — 1
    expect(changes.reduce((m, v) => m | v, 0)).toBe(0xff);
    // До конца проверки машина стоит на HLT не меньше 5 тактов
    expect(o.slice(-6).every((v) => v === 0xb0)).toBe(true);
  });
  it("стек по кругу: 17 вложенных CALL затирают первый адрес возврата", () => {
    const op = Array(256).fill(0), n = Array(256).fill(0);
    // 00: CALL 10; 01: OUT; 02: HLT; 10…20: CALL следующий; 21: LDI 9; 22: RET (в 21), …
    op[0] = 0xd0; n[0] = 0x10; op[1] = 0x80; op[2] = 0xf0;
    for (let a = 0x10; a < 0x20; a++) { op[a] = 0xd0; n[a] = a + 1; }
    op[0x20] = 0x10; n[0x20] = 9; op[0x21] = 0xe0;
    // 17 RET: последний берёт ячейку, где теперь адрес 11 вместо 01, — снова в цепочку вызовов
    const o = m2Emulate({ op, n }, 60, 8, 8);
    expect(o.every((v) => v === 0)).toBe(true);
  });
  it("эталон проходит", () => {
    const steps = proj.check(call());
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  for (const [what, mc, st] of [
    ["CALL не пишет стек", CALL_MICROCODE, withOp(STACK_MICROCODE, 13, 0x0a)],
    ["CALL не меняет SP", CALL_MICROCODE, withOp(STACK_MICROCODE, 13, 0x06)],
    ["RET берёт адрес из N", CALL_MICROCODE, withOp(STACK_MICROCODE, 14, 0x0a)],
    ["RET — пустая команда", withOp(CALL_MICROCODE, 14, 0xab), withOp(STACK_MICROCODE, 14, STACK_IDLE)],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(call(mc, st))), what).toBe(false);
    }, 300000);
  it("в стек — адрес самой CALL (перенос в «адрес + 1» — к общему) — не проходит", () => {
    const steps = proj.check(call(undefined, undefined, (w) => w.map(([a, b]) => (same(b, P("I0", 7) as { comp: string; pin: number }) ? [{ comp: "G1", pin: 0 }, b] : [a, b]))));
    expect(run(steps), text(steps)).toBe(false);
  }, 300000);
});
