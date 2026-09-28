import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import type { Component, Endpoint, Scene } from "../src/model/types";
import { referenceChips } from "../src/career/build";
import { PROJECTS } from "../src/career/projects";

setLibrary([]);
const refs = referenceChips();
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const f = { mode: "free" as const, x: 0, z: 0, rot: 0 };
const chip = (id: string, ref: string): Component => {
  const d = allChips[ref];
  return { id, type: "chip", def: d.id, name: d.name, package: d.package, pins: d.pins, placement: f };
};
const P = (id: string, p: number): Endpoint => ({ comp: id, pin: p - 1 });
const plus: Endpoint = { comp: "G1", pin: 1 };
const minus: Endpoint = { comp: "G1", pin: 0 };

/** Счётчик 393 (0…9) → 4511 → индикатор; такт — на 1CLK с clk. */
function counterDisplay(clk: Endpoint): { comps: Component[]; wires: [Endpoint, Endpoint][] } {
  const comps: Component[] = [chip("D2", "ref:cnt393"), chip("D3", "ref:and"), chip("D4", "ref:hc4511"), { id: "HG1", type: "display", placement: f }];
  const wires: [Endpoint, Endpoint][] = [
    [plus, P("D2", 14)], [minus, P("D2", 7)], [plus, P("D3", 5)], [minus, P("D3", 3)], [plus, P("D4", 16)], [minus, P("D4", 8)],
    [clk, P("D2", 1)], [plus, P("D2", 12)], [minus, P("D2", 13)],
    [P("D2", 4), P("D3", 1)], [P("D2", 6), P("D3", 2)], [P("D3", 4), P("D2", 2)],
    [P("D2", 3), P("D4", 7)], [P("D2", 4), P("D4", 1)], [P("D2", 5), P("D4", 2)], [P("D2", 6), P("D4", 6)],
    [plus, P("D4", 3)], [plus, P("D4", 4)], [minus, P("D4", 5)], [minus, P("HG1", 3)],
  ];
  const seg: [number, number][] = [[13, 7], [12, 6], [11, 4], [10, 2], [9, 1], [15, 9], [14, 10]];
  seg.forEach(([cp, dp], k) => {
    const id = `R${k + 1}`;
    comps.push({ id, type: "resistor", variant: "tht", ohms: 330, smdSize: "0805", placement: f });
    wires.push([P("D4", cp), { comp: id, pin: 0 }], [{ comp: id, pin: 1 }, P("HG1", dp)]);
  });
  return { comps, wires };
}

function solved(id: string, extra: Component[], wires: [Endpoint, Endpoint][]): Scene {
  const s = PROJECTS.find((p) => p.id === id)!.start();
  s.components.push(...extra);
  s.wires.push(...wires.map(([a, b], i) => ({ id: `WX${i}`, a, b, color: "" })));
  s.chips = allChips;
  applyBoards(s.boards!);
  return s;
}

describe("проекты", () => {
  it("счётчик нажатий: MAX6816 → 393 (0…9) → 4511 → индикатор — проходит; без подавителя дребезга — нет", () => {
    const cd = counterDisplay(P("D1", 3));
    const withMax = solved(
      "proj-counter",
      [chip("D1", "ref:max6816"), { id: "SB1", type: "button", bounce: true, placement: f }, ...cd.comps],
      [[plus, P("D1", 4)], [minus, P("D1", 1)], [P("SB1", 1), P("D1", 2)], [P("SB1", 2), minus], ...cd.wires],
    );
    const t0 = performance.now();
    const steps = PROJECTS[0].check(withMax);
    console.log(Math.round(performance.now() - t0), "мс\n" + steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n"));
    expect(steps.every((s) => s.ok)).toBe(true);

    // Кнопка прямо на счётчик (с подтяжкой 10 кОм): дребезг насчитывает лишнее — по два на нажатие
    const cd2 = counterDisplay(P("SB1", 1));
    const raw = solved(
      "proj-counter",
      [{ id: "SB1", type: "button", bounce: true, placement: f }, { id: "RP", type: "resistor", variant: "tht", ohms: 10000, smdSize: "0805", placement: f }, ...cd2.comps],
      [[plus, P("RP", 1)], [P("RP", 2), P("SB1", 1)], [P("SB1", 2), minus], ...cd2.wires],
    );
    const rawSteps = PROJECTS[0].check(raw);
    expect(rawSteps[1].ok).toBe(false);
    expect(rawSteps[1].text).toContain("на 1-м нажатии нужно 1");
  }, 120000);

  it("секундомер: 555 (≈ 1 с) → 393 → 4511 → индикатор — проходит", () => {
    const cd = counterDisplay(P("D1", 3));
    const scene = solved(
      "proj-stopwatch",
      [
        chip("D1", "ref:ne555"),
        { id: "RA", type: "resistor", variant: "tht", ohms: 10000, smdSize: "0805", placement: f },
        { id: "RB", type: "resistor", variant: "tht", ohms: 680000, smdSize: "0805", placement: f },
        { id: "C1", type: "capacitor", variant: "ceramic", uF: 1, volts: 50, placement: f },
        ...cd.comps,
      ],
      [
        [plus, P("D1", 8)], [minus, P("D1", 1)], [plus, P("D1", 4)],
        [plus, P("RA", 1)], [P("RA", 2), P("D1", 7)], [P("D1", 7), P("RB", 1)], [P("RB", 2), P("D1", 6)], [P("D1", 6), P("D1", 2)],
        [P("D1", 6), P("C1", 1)], [P("C1", 2), minus],
        ...cd.wires,
      ],
    );
    const t0 = performance.now();
    const steps = PROJECTS[1].check(scene);
    console.log(Math.round(performance.now() - t0), "мс\n" + steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n"));
    expect(steps.every((s) => s.ok)).toBe(true);
  }, 180000);
});

describe("проект ЦАП", () => {
  /** 74HC595 → R-2R (10/20 кОм) → LM358 повторителем (или без буфера — прямо на выход). */
  function dac(buffered: boolean) {
    const comps: Component[] = [chip("D1", "ref:hc595"), chip("DA1", "ref:lm358")];
    const hole = (h: string): Endpoint => ({ hole: h });
    const wires: [Endpoint, Endpoint][] = [
      [plus, P("D1", 16)], [minus, P("D1", 8)], [plus, P("D1", 10)], [minus, P("D1", 13)],
      [hole("j2"), P("D1", 14)], [hole("j4"), P("D1", 11)], [hole("j6"), P("D1", 12)],
      [plus, P("DA1", 8)], [minus, P("DA1", 4)],
    ];
    // Выходы QA…QH: 15, 1…7
    const q = [15, 1, 2, 3, 4, 5, 6, 7];
    const r = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: f });
    const node = (k: number): Endpoint => ({ comp: `RB${k}`, pin: 1 });
    q.forEach((p, k) => {
      comps.push(r(`RB${k}`, 20_000));
      wires.push([P("D1", p), { comp: `RB${k}`, pin: 0 }]);
      if (k > 0) {
        comps.push(r(`RR${k}`, 10_000));
        wires.push([node(k - 1), { comp: `RR${k}`, pin: 0 }], [{ comp: `RR${k}`, pin: 1 }, node(k)]);
      }
    });
    comps.push(r("RT", 20_000));
    wires.push([node(0), { comp: "RT", pin: 0 }], [{ comp: "RT", pin: 1 }, minus]);
    if (buffered) wires.push([node(7), P("DA1", 3)], [P("DA1", 1), P("DA1", 2)], [P("DA1", 1), hole("a30")]);
    else wires.push([node(7), hole("a30")]);
    return solved("proj-dac", comps, wires);
  }

  it("с буфером на LM358 проходит, голая лестница под нагрузкой — нет", () => {
    const steps = PROJECTS.find((p) => p.id === "proj-dac")!.check(dac(true));
    expect(steps.every((s) => s.ok), steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n")).toBe(true);
    const bare = PROJECTS.find((p) => p.id === "proj-dac")!.check(dac(false));
    expect(bare[0].ok, bare[0].text).toBe(false);
  }, 180000);
});

describe("проект «Вольтметр»", () => {
  /** 555 → И (такт, компаратор) → 393 → R-2R → LM393 (вход на IN+, своё на IN−); 393 → 4511 → индикатор. */
  function adc() {
    const hole = (h: string): Endpoint => ({ hole: h });
    const r = (id: string, ohms: number): Component => ({ id, type: "resistor", variant: "tht", ohms, smdSize: "0805", placement: f });
    const comps: Component[] = [chip("D1", "ref:ne555"), chip("D2", "ref:cnt393"), chip("D3", "ref:and"), chip("DA1", "ref:lmv331"), chip("D4", "ref:hc4511"), { id: "HG1", type: "display", placement: f },
      r("RA", 10_000), r("RB", 33_000), { id: "C1", type: "capacitor", variant: "ceramic", uF: 1, volts: 50, placement: f }, r("RP", 10_000)];
    const wires: [Endpoint, Endpoint][] = [
      // 555 генератором
      [plus, P("D1", 8)], [minus, P("D1", 1)], [plus, P("D1", 4)],
      [plus, { comp: "RA", pin: 0 }], [{ comp: "RA", pin: 1 }, P("D1", 7)], [P("D1", 7), { comp: "RB", pin: 0 }], [{ comp: "RB", pin: 1 }, P("D1", 6)], [P("D1", 6), P("D1", 2)],
      [P("D1", 6), { comp: "C1", pin: 0 }], [{ comp: "C1", pin: 1 }, minus],
      // И: такт и «своё ниже входа» → счёт
      [plus, P("D3", 5)], [minus, P("D3", 3)], [P("D1", 3), P("D3", 1)], [P("DA1", 4), P("D3", 2)], [P("DA1", 4), { comp: "RP", pin: 0 }], [{ comp: "RP", pin: 1 }, plus],
      [plus, P("D2", 14)], [minus, P("D2", 7)], [P("D3", 4), P("D2", 1)], [hole("j4"), P("D2", 2)], [plus, P("D2", 12)], [minus, P("D2", 13)],
      // Компаратор LMV331: вход на IN+ (1), лестница на IN− (3)
      [plus, P("DA1", 5)], [minus, P("DA1", 2)], [hole("j2"), P("DA1", 1)],
      // 4511 и индикатор
      [plus, P("D4", 16)], [minus, P("D4", 8)], [P("D2", 3), P("D4", 7)], [P("D2", 4), P("D4", 1)], [P("D2", 5), P("D4", 2)], [P("D2", 6), P("D4", 6)],
      [plus, P("D4", 3)], [plus, P("D4", 4)], [minus, P("D4", 5)], [minus, P("HG1", 3)],
    ];
    const q = [3, 4, 5, 6];
    const node = (k: number): Endpoint => ({ comp: `RB${k}`, pin: 1 });
    q.forEach((p, k) => {
      comps.push(r(`RB${k}`, 20_000));
      wires.push([P("D2", p), { comp: `RB${k}`, pin: 0 }]);
      if (k > 0) {
        comps.push(r(`RR${k}`, 10_000));
        wires.push([node(k - 1), { comp: `RR${k}`, pin: 0 }], [{ comp: `RR${k}`, pin: 1 }, node(k)]);
      }
    });
    comps.push(r("RT", 20_000));
    wires.push([node(0), { comp: "RT", pin: 0 }], [{ comp: "RT", pin: 1 }, minus], [node(3), P("DA1", 3)]);
    const seg: [number, number][] = [[13, 7], [12, 6], [11, 4], [10, 2], [9, 1], [15, 9], [14, 10]];
    seg.forEach(([cp, dp], k) => {
      comps.push(r(`R${k + 1}`, 330));
      wires.push([P("D4", cp), { comp: `R${k + 1}`, pin: 0 }], [{ comp: `R${k + 1}`, pin: 1 }, P("HG1", dp)]);
    });
    return solved("proj-adc", comps, wires);
  }

  it("эталон показывает 4, 9, 2", () => {
    const t0 = performance.now();
    const steps = PROJECTS.find((p) => p.id === "proj-adc")!.check(adc());
    expect(steps.every((s) => s.ok), `${Math.round(performance.now() - t0)} мс\n` + steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n")).toBe(true);
  }, 180000);
});
