import { describe, expect, it } from "vitest";
import type { Endpoint } from "../src/model/types";
import { CPU32_PROGRAM, PROJECTS, cpu32Byte, cpu32Emulate } from "../src/career/projects";
import { promWord } from "../src/chips/memory";
import { P, allChips, cpuOfModules } from "./module-build";

const proj = PROJECTS.find((p) => p.id === "proj-cpu32")!;
const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const same = (a: Endpoint, b: Endpoint) => JSON.stringify(a) === JSON.stringify(b);
const build = (mutate?: (w: [Endpoint, Endpoint][]) => [Endpoint, Endpoint][]) => cpuOfModules(allChips["ref:slice"], 8, "proj-cpu32", mutate);

describe("Процессор 32 бит из восьми модулей «Срез»", () => {
  it("программа: каждый бит числа бывает и нулём, и единицей; FFFFFFFF + 1 = 0", () => {
    for (let b = 0; b < 32; b++) {
      const bits = CPU32_PROGRAM.n.slice(0, 5).map((w) => Math.floor(w / 2 ** b) % 2);
      expect(bits).toContain(0);
      expect(bits).toContain(1);
    }
    const outs = cpu32Emulate(CPU32_PROGRAM, 24);
    expect(outs.slice(0, 8)).toEqual([0, 0, 0xffffffff, 0xffffffff, 0xfffffffe, 0xfffffffe, 0x5a5a5a5a, 0x5a5a5a5a]);
    expect(cpu32Byte(0)).toEqual([0xa5, 0x5a, 1, 0xfe, 0x5a, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(cpu32Byte(3)).toEqual([0xa5, 0x5a, 0, 0xff, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it("эталон проходит проверку; восемь модулей засчитываются в набор", () => {
    const s = build();
    const t0 = performance.now();
    const steps = proj.check(s);
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
    expect(steps.find((x) => x.text.startsWith("Такт"))!.text).toContain("FFFFFFFF FFFFFFFF FFFFFFFE");
    expect(performance.now() - t0).toBeLessThan(20000);
  }, 120000);
  it("в ПЗУ старшего байта — младший байт: не проходит, показывает, чего не нашлось", () => {
    const s = build();
    const rom = s.components.find((c) => c.id === "RN3") as { data?: number[] };
    rom.data = cpu32Byte(0);
    expect(promWord(rom.data, 2)).toBe(1);
    const steps = proj.check(s);
    expect(steps[0].ok).toBe(false);
    expect(steps[0].text).toContain("байт 3 числа");
  });
  // Перенос из модуля 3 в модуль 4 (биты 15 → 16): только FFFFFFFF + 1 его замечает
  it("оборван перенос посередине цепочки (CI модуля M4 — на общий) — не проходит", () => {
    const minus: Endpoint = { comp: "G1", pin: 0 };
    const steps = proj.check(build((w) => w.map(([a, b]): [Endpoint, Endpoint] => (same(a, P("M3", 12)) && same(b, P("M4", 11)) ? [minus, b] : [a, b]))));
    expect(steps.find((x) => x.text.startsWith("Такт за тактом"))?.ok, text(steps)).toBe(false);
  }, 120000);
});
