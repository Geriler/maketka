import { describe, expect, it } from "vitest";
import type { Endpoint, Scene } from "../src/model/types";
import { BOOT_PROGRAM, CPU_PROGRAM } from "../src/career/projects";
import { P, boot, chip, minus, proj } from "./boot-build";

const check = (s: Scene) => proj.check(s);
const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const same = (a: Endpoint, b: Endpoint) => JSON.stringify(a) === JSON.stringify(b);
type W = [Endpoint, Endpoint][];
/** Заменить провод a–b на a'–b'. */
const swap = (a: Endpoint, b: Endpoint, a2: Endpoint, b2: Endpoint) => (w: W) => w.map(([x, y]): [Endpoint, Endpoint] => (same(x, a) && same(y, b) ? [a2, b2] : [x, y]));
const both = (...fs: ((w: W) => W)[]) => (w: W) => fs.reduce((m, f) => f(m), w);
const plus: Endpoint = { comp: "G1", pin: 1 };
const CLK: Endpoint = { hole: "s:J3" };
const RUN = P("FF", 4);
const ok = (steps: { ok: boolean }[]) => steps.every((x) => x.ok);

describe("Загрузчик: EEPROM → ОЗУ, работа из ОЗУ", () => {
  it("эталон проходит", () => {
    const steps = check(boot());
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  it("в EEPROM программа 4-битного (0 → 2A) — не проходит, показывает, что там", () => {
    const steps = check(boot(CPU_PROGRAM));
    expect(steps[0].ok).toBe(false);
    expect(steps[0].text).toContain("0 → 2A");
    expect(BOOT_PROGRAM[0]).toBe(0x3a);
  });
  it("процессор читает прямо из EEPROM — после стирания не проходит", () => {
    const steps = check(boot(BOOT_PROGRAM, both(swap(RUN, P("EE", 22), minus, P("EE", 22)), swap(P("N2", 4), P("RM", 22), plus, P("RM", 22)))));
    expect(steps.find((x) => x.text.startsWith("EEPROM стёрта"))?.ok, text(steps)).toBe(false);
  }, 300000);
  for (const [what, gs] of [["запись в A", ["G3"]], ["переход", ["G2"]], ["вывод и запись в A", ["G3", "G4"]]] as const)
    it(`${what} не закрыт на время загрузки — не проходит`, () => {
      const steps = check(boot(BOOT_PROGRAM, both(...gs.map((g) => swap(RUN, P(g, 2), plus, P(g, 2))))));
      expect(ok(steps), text(steps)).toBe(false);
    }, 300000);
  // Один вывод без RUN безвреден: A, пока запись закрыта, — 0, выводится тот же 0
  it("закрыта только запись в A, вывод — нет: проходит (выводится 0)", () => {
    const steps = check(boot(BOOT_PROGRAM, swap(RUN, P("G4", 2), plus, P("G4", 2))));
    expect(ok(steps), text(steps)).toBe(true);
  }, 300000);
  it("ОЗУ пишет, пока CLK = 1 (не в той половине такта), — адрес 0 не загружается, не проходит", () => {
    const steps = check(boot(BOOT_PROGRAM, (w) => [...swap(CLK, P("G1A", 2), P("N3", 4), P("G1A", 2))(w), [CLK, P("N3", 2)]], [chip("N3", "ref:not-cmos")]));
    expect(ok(steps), text(steps)).toBe(false);
  }, 300000);
  it("ОЗУ пишет по каждому CLK и во время работы — не проходит", () => {
    const steps = check(boot(BOOT_PROGRAM, swap(RUN, P("G1A", 1), minus, P("G1A", 1))));
    expect(ok(steps), text(steps)).toBe(false);
  }, 300000);
  it("флаг RUN сам себя не держит (D = RCO) — не проходит", () => {
    const steps = check(boot(BOOT_PROGRAM, swap(RUN, P("G1B", 1), minus, P("G1B", 1))));
    expect(ok(steps), text(steps)).toBe(false);
  }, 300000);
  it("O̅E̅ ОЗУ — на общий: во время загрузки ОЗУ и EEPROM выводят на шину разом, не проходит", () => {
    const steps = check(boot(BOOT_PROGRAM, swap(P("N2", 4), P("RM", 22), minus, P("RM", 22))));
    const step = steps.find((x) => x.text.includes("одну цепь"));
    expect(step?.ok, text(steps)).toBe(false);
    expect(step?.text).toContain("EE.11 (I/O0)");
  }, 300000);
  it("у инвертора O̅E̅ ОЗУ нет питания — не проходит", () => {
    const steps = check(boot(BOOT_PROGRAM, (w) => w.filter(([a, b]) => !(same(a, plus) && same(b, P("N2", 5))))));
    expect(ok(steps), text(steps)).toBe(false);
  }, 300000);
});
