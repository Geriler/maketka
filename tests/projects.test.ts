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
