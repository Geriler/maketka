import { describe, expect, it } from "vitest";
import { DEC_PROGRAM, M2, m2Emulate } from "../src/career/projects";
import { IDLE, MICROCODE, dec, proj } from "./dec-build";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);
const tact = (steps: { ok: boolean; text: string }[]) => steps.find((x) => x.text.startsWith("Такт"))?.ok;

describe("ISA М2: эмулятор", () => {
  it("программа «Декодера»: каждая команда видна на выходе", () => {
    expect(m2Emulate(DEC_PROGRAM, 12).map((v) => v.toString(16))).toEqual(["0", "0", "ff", "ff", "0", "0", "0", "fe", "fe", "5a", "5a", "5a"]);
    expect(m2Emulate(DEC_PROGRAM, 24).slice(12, 16).map((v) => v.toString(16))).toEqual(["b4", "b4", "b5", "b5"]);
  });
  it("флаги, вычитание, память, условные переходы и HLT: счёт вниз от 3 до нуля и стоп", () => {
    // 0: LDI 3; 1: OUT; 2: SUBI 1; 3: JNZ 1; 4: ST 9 (0); 5: LDI 7; 6: SUBI 0 (нет заёма — C = 1); 7: JC 9; 8: HLT; 9: LD 9 (A = 0); 10: OUT; 11: HLT
    const op = [M2.LDI, M2.OUT, M2.SUBI, M2.JNZ, M2.ST, M2.LDI, M2.SUBI, M2.JC, M2.HLT, M2.LD, M2.OUT, M2.HLT].map((c) => c << 4);
    const n = [3, 0, 1, 1, 9, 7, 0, 9, 0, 9, 0, 0];
    expect(m2Emulate({ op, n }, 20)).toEqual([0, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
    // A − 0 — «нет заёма» (C = 1); 0 − 1 — заём (C = 0)
    const sub = (a: number, b: number) => m2Emulate({ op: [M2.LDI << 4, M2.SUBI << 4, M2.JC << 4, M2.HLT << 4, M2.OUT << 4, M2.HLT << 4], n: [a, b, 4, 0, 0, 0] }, 6).at(-1);
    expect(sub(5, 0)).toBe(5);
    expect(sub(0, 1)).toBe(0);
  });
});

describe("Декодер команд: эталон и ошибки микрокода", () => {
  it("эталон проходит", () => {
    const steps = proj.check(dec());
    expect(ok(steps), text(steps)).toBe(true);
  }, 120000);
  it("EEPROM пустая (все байты 00 — все разрешения активны) — не проходит", () => {
    expect(tact(proj.check(dec([])))).toBe(false);
  }, 120000);
  for (const [what, op, byte] of [
    ["NOP пишет в A", 0, 0b1010],
    ["NOP ещё и выводит", 0, 0b1001],
    ["OUT заодно пишет в A", 8, 0b1000],
    ["ADDI без сложения (как LDI)", 4, 0b1010],
    ["JMP не грузит счётчик", 9, IDLE],
  ] as const)
    it(`микрокод с ошибкой: ${what} — не проходит`, () => {
      const mc = [...MICROCODE];
      mc[op] = byte;
      expect(tact(proj.check(dec(mc))), what).toBe(false);
    }, 120000);
  it("неиспользуемые коды в таблице могут быть любыми — проходит", () => {
    const mc = MICROCODE.map((b, op) => ([0, 1, 4, 8, 9].includes(op) ? b : 0x55));
    expect(ok(proj.check(dec(mc)))).toBe(true);
  }, 120000);
});
