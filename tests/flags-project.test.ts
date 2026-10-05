import { describe, expect, it } from "vitest";
import { FLAGS_PROGRAM, m2Emulate } from "../src/career/projects";
import { IDLE, MICROCODE, flags, proj } from "./flags-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const run = (steps: { ok: boolean; text: string }[]) => ["Такт", "RST посреди", "После RST"].every((p) => steps.find((x) => x.text.startsWith(p))?.ok !== false);
const withCode = (changes: [number, number][]) => { const mc = [...MICROCODE]; for (const [a, b] of changes) mc[a] = b; return mc; };

describe("Перенос и условный переход", () => {
  it("программа: цикл с выходом по заёму, потом стоп", () => {
    expect(m2Emulate(FLAGS_PROGRAM, 24).map((v) => v.toString(16)).join(" ")).toBe("0 2 2 2 1 1 1 0 0 0 ff ff ff ff ff b5 b5 b5 b5 0 0 0 0 0");
  });
  it("эталон проходит", () => {
    const steps = proj.check(flags());
    expect(ok(steps), text(steps)).toBe(true);
  }, 120000);
  for (const [what, changes] of [
    ["JC переходит всегда (флаг не подан на декодер)", [[10, 0b1000011]]],
    ["JC не переходит никогда", [[26, IDLE]]],
    ["SUBI складывает (нет SUB)", [[5, 0b1101110], [21, 0b1101110]]],
    ["ADDI не пишет флаг", [[4, 0b1001110], [20, 0b1001110]]],
    ["LDI тоже пишет флаг", [[1, 0b1101010], [17, 0b1101010]]],
    ["HLT не останавливает", [[15, IDLE], [31, IDLE]]],
  ] as [string, [number, number][]][])
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      expect(run(proj.check(flags(withCode(changes)))), what).toBe(false);
    }, 120000);
  it("EEPROM пустая — не проходит", () => {
    expect(run(proj.check(flags([])))).toBe(false);
  }, 120000);
  it("у XOR не подключён общий — работает через входы, но проверка не пропускает и говорит, какой вывод", () => {
    const s = flags(undefined, (w) => w.filter(([a, b]) => !(JSON.stringify(a) === JSON.stringify({ comp: "G1", pin: 0 }) && JSON.stringify(b) === JSON.stringify({ comp: "X1", pin: 2 }))));
    const steps = proj.check(s);
    const step = steps.find((x) => x.text.includes("висят"));
    expect(step?.ok).toBe(false);
    expect(step?.text).toContain("X1.3 (общий)");
  }, 120000);
});
