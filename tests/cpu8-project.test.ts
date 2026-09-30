import { describe, expect, it } from "vitest";
import type { Endpoint, Scene } from "../src/model/types";
import { CPU8_OUT, CPU8_PROGRAM, cpu8Emulate } from "../src/career/projects";
import { P, cpu8, minus, proj } from "./cpu8-build";
import { applyBoards, type BoardSpec } from "../src/model/breadboard";
import { foreignContacts } from "../src/model/copper";
import type { Component } from "../src/model/types";
import cpu8Smd from "./fixtures/cpu8-smd.json";

const check = (s: Scene) => proj.check(s);
const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");

describe("проект «Процессор 8 бит»", () => {
  it("эмулятор: A5 + 5A = FF, FF + 1 = 0, переход на 15", () => {
    // 1: A=A5; 2: A=FF; 3: вывод FF, A=0; 4: A=FE; 5: вывод FE, A=5A; 6: на 15; 7: вывод 5A, на 1; 8: A=B4
    expect(cpu8Emulate(CPU8_PROGRAM, 8)).toEqual([0, 0, 0xff, 0xff, 0xfe, 0xfe, 0x5a, 0x5a]);
  });
  it("эталон проходит", () => {
    const steps = check(cpu8());
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
  }, 300000);
  it("ПЗУ перепутаны местами (числа в ПЗУ команд) — сразу говорит", () => {
    const steps = check(cpu8({ n: CPU8_PROGRAM.op, op: CPU8_PROGRAM.op }));
    expect(steps[0].ok).toBe(false);
    expect(steps[0].text).toContain("не нашлось ПЗУ с числами");
  });
  it("без переноса между срезами — не проходит", () => {
    const steps = check(cpu8(CPU8_PROGRAM, (w) => w.map(([a, b]): [Endpoint, Endpoint] => (JSON.stringify(a) === JSON.stringify(P("ADL", 9)) ? [minus, b] : [a, b]))));
    expect(steps.find((x) => x.text.startsWith("Такт"))?.ok, text(steps)).toBe(false);
  }, 300000);
  // Перебор всех 141 соединения эталона: программа замечает каждый обрыв сигнала, а заземления
  // разрешений регистров — шаг «входы висят в воздухе». Здесь — несколько характерных.
  const same = (a: Endpoint, b: Endpoint) => JSON.stringify(a) === JSON.stringify(b);
  const drop = (a: Endpoint, b: Endpoint) => (w: [Endpoint, Endpoint][]) => w.filter(([x, y]) => !(same(x, a) && same(y, b)));
  for (const [what, a, b] of [
    ["N7 на вход B старшего сумматора", P("RN", 9), P("ADH", 11)],
    ["N7 на вход мультиплексора", P("RN", 9), P("MXH", 14)],
    ["OUT7", P("ROH", 6), { hole: CPU8_OUT[7] }],
    ["D3 загрузки счётчика", P("RN", 4), P("PC", 6)],
    ["адрес A3 ПЗУ команд", P("PC", 11), P("RC", 13)],
  ] as [string, Endpoint, Endpoint][]) {
    it(`без провода «${what}» — программа замечает`, () => {
      const steps = check(cpu8(CPU8_PROGRAM, drop(a, b)));
      expect(steps.find((x) => x.text.startsWith("Такт"))?.ok, text(steps)).toBe(false);
    }, 300000);
  }
  it("разрешение регистра старшего среза не подключено — вход висит, не проходит", () => {
    const steps = check(cpu8(CPU8_PROGRAM, drop(minus, P("RAH", 10))));
    const step = steps.find((x) => x.text.includes("висят"));
    expect(step?.ok).toBe(false);
    expect(step?.text).toContain("RAH.10");
  }, 300000);
  // Разводка на двусторонней плате под SMD 52 × 40 (скрипт-трассировщик): сверху, где не пройти —
  // снизу через переходы; перемычек нет. Микросхемы — «career:…», здесь — эталонные «ref:…».
  const smd8 = (drop?: string): Scene => {
    const s = proj.start();
    s.boards = [structuredClone(cpu8Smd.board) as BoardSpec];
    s.components.push(...(structuredClone(cpu8Smd.components) as Component[]).map((c) => (c.type === "chip" ? { ...c, def: c.def.replace(/^career:/, "ref:") } : c)));
    s.traces = (structuredClone(cpu8Smd.traces) as NonNullable<Scene["traces"]>).filter((t) => t.id !== drop);
    s.chips = cpu8().chips;
    applyBoards(s.boards!);
    return s;
  };
  it("разводка 8-битного: двусторонняя, без перемычек, нижние дорожки — между переходами, медь не касается чужой", () => {
    const s = smd8();
    expect(s.boards![0].layers).toBe(2);
    expect(cpu8Smd.wires).toEqual([]);
    const vias = new Set(s.boards![0].seats!.filter((x) => x.fp === "VIA").map((x) => `s:${x.id}.1`));
    const bottom = s.traces!.filter((t) => t.side === "bottom");
    expect(bottom.length).toBeGreaterThan(0);
    expect(bottom.every((t) => vias.has(t.a) && vias.has(t.b))).toBe(true);
    expect(foreignContacts(s)).toEqual([]);
  });
  it("разводка 8-битного проходит проверку, без одной нижней дорожки — нет", () => {
    const ok = check(smd8());
    expect(ok.every((x) => x.ok), text(ok)).toBe(true);
    const bad = check(smd8("TB1"));
    expect(bad.every((x) => x.ok)).toBe(false);
  }, 300000);
});
