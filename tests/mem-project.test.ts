import { describe, expect, it } from "vitest";
import type { Endpoint } from "../src/model/types";
import { MEM_PROGRAM, m2Emulate } from "../src/career/projects";
import { IDLE, MICROCODE, mem, proj } from "./mem-build";
import { P } from "./module-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
/** Поменять байт микрокода у кода op при всех C и «A = 0». */
const withOp = (op: number, byte: number) => MICROCODE.map((b, a) => ((a & 15) === op ? byte : b));
const same = (a: Endpoint, b: Endpoint) => JSON.stringify(a) === JSON.stringify(b);

describe("Память и проверка на ноль", () => {
  it("программа", () => {
    expect(m2Emulate(MEM_PROGRAM, 24).map((v) => v.toString(16)).join(" ")).toBe("0 0 0 0 0 0 ff ff a5 a5 a5 0 0 0 0 1 1 a7 a7 a7 a7 a7 a7 a7");
  });
  it("эталон проходит", () => {
    const steps = proj.check(mem());
    expect(ok(steps), text(steps)).toBe(true);
  }, 180000);
  for (const [what, op, byte] of [
    ["ST не пишет в ОЗУ", 3, IDLE],
    ["LD берёт N, а не ОЗУ (как LDI)", 2, 0xaa],
    ["ADD прибавляет N (как ADDI)", 6, 0xae],
    ["SUB без вычитания", 7, 0xee],
    ["JZ переходит всегда", 11, 0xa3],
    ["JNZ не переходит никогда", 12, IDLE],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(mem(withOp(op, byte)))), what).toBe(false);
    }, 180000);
  it("74HC244 всегда выдаёт A на шину — спорит с ОЗУ: не проходит, говорит, кто с кем", () => {
    const minus: Endpoint = { comp: "G1", pin: 0 };
    const steps = proj.check(mem(undefined, (w) => w.map(([a, b]): [Endpoint, Endpoint] => (same(b, P("BF", 1)) || same(b, P("BF", 19)) ? [minus, b] : [a, b]))));
    const step = steps.find((x) => x.text.includes("одну цепь"));
    expect(step?.ok, text(steps)).toBe(false);
    expect(step?.text).toMatch(/RM\.\d+ \(I\/O\d\) и BF|BF\.\d+ \(\dY\d\) и RM/);
  }, 180000);
});
