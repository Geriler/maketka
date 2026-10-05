import { describe, expect, it } from "vitest";
import type { Component, Scene } from "../src/model/types";
import { CPU32_OUT, PROJECTS } from "../src/career/projects";
import { LEVELS } from "../src/career/levels";
import { checkLevel, packageRecipe } from "../src/career/build";
import { applyBoards, HOLE_BY_ID } from "../src/model/breadboard";
import { foreignContacts } from "../src/model/copper";
import { packageChip } from "../src/chips/package";
import { allChips } from "./module-build";
import cpu32Smd from "./fixtures/cpu32-smd.json";
import sliceSmd from "./fixtures/slice-smd.json";

const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const ref = (c: Component): Component => (c.type === "chip" ? { ...c, def: c.def.replace(/^career:/, "ref:") } : c);
const level = LEVELS.find((l) => l.id === "slice")!;

/** Модуль «Срез», разведённый дорожками на своей двусторонней плате SIP-20 (сделан трассировщиком). */
function sliceScene(traces = sliceSmd.traces as NonNullable<Scene["traces"]>): Scene {
  const s: Scene = { components: (structuredClone(sliceSmd.components) as Component[]).map(ref), wires: [], traces: structuredClone(traces), boards: [structuredClone(sliceSmd.board) as NonNullable<Scene["boards"]>[number]], career: { level: "slice" } };
  applyBoards(s.boards!);
  return s;
}
/** 32-битный, разведённый дорожками на двусторонней плате; модули — def. */
function cpu32Scene(slice = "ref:slice", extra: Record<string, unknown> = {}): Scene {
  const s = PROJECTS.find((p) => p.id === "proj-cpu32")!.start();
  s.boards = [structuredClone(cpu32Smd.board) as NonNullable<Scene["boards"]>[number]];
  s.components.push(...(structuredClone(cpu32Smd.components) as Component[]).map((c) => (c.type === "chip" && c.def === "career:slice" ? { ...c, def: slice } : ref(c))));
  s.traces = structuredClone(cpu32Smd.traces) as NonNullable<Scene["traces"]>;
  s.chips = { ...allChips, ...extra } as Scene["chips"];
  applyBoards(s.boards!);
  return s;
}

describe("на SMD с дорожками: модуль «Срез» и процессор 32 бит", () => {
  it("модуль: плата SIP-20 двусторонняя, четыре SO-16, ни одного провода, медь нигде не задевает чужую — уровень пройден", () => {
    const s = sliceScene();
    expect(s.boards![0].layers).toBe(2);
    expect(s.boards![0].package).toBe("SIP");
    expect(s.components.filter((c) => c.type === "chip").map((c) => (c as { smd?: boolean }).smd)).toEqual([true, true, true, true]);
    expect(sliceSmd.wires).toEqual([]);
    expect(sliceSmd.traces.some((t) => t.side === "bottom")).toBe(true);
    expect(foreignContacts(s)).toEqual([]);
    const r = checkLevel(level, s, allChips);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  }, 120000);
  it("модуль: без одной нижней дорожки — не проходит", () => {
    const bottom = sliceSmd.traces.find((t) => t.side === "bottom")!;
    const r = checkLevel(level, sliceScene(sliceSmd.traces.filter((t) => t.id !== bottom.id) as NonNullable<Scene["traces"]>), allChips);
    expect(r.ok).toBe(false);
  }, 120000);
  it("модуль: нижнюю дорожку перенесли наверх — она задевает чужую медь, уровень говорит, где", () => {
    const traces = sliceSmd.traces.map((t) => (t.side === "bottom" ? { id: t.id, a: t.a, b: t.b } : t));
    const s = sliceScene(traces as NonNullable<Scene["traces"]>);
    expect(foreignContacts(s).length).toBeGreaterThan(0);
    const r = checkLevel(level, s, allChips);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/Медь задевает чужую/);
  }, 120000);
  it("32 бит: плата двусторонняя, модули на разъёмах SIP-20, остальное в SOIC/SOT-23, ни одного провода, выходы на J6…J37", () => {
    const s = cpu32Scene();
    expect(s.boards![0].layers).toBe(2);
    expect(cpu32Smd.wires).toEqual([]);
    const chips = s.components.filter((c) => c.type === "chip") as (Component & { package: string; smd?: boolean })[];
    expect(chips.filter((c) => c.package === "SIP").length).toBe(8);
    expect(chips.every((c) => c.placement.mode === "board" && (c.package !== "DIP" || c.smd === true))).toBe(true);
    // Каждая площадка выхода на плате к чему-то подведена
    for (const h of CPU32_OUT) expect(s.traces!.some((t) => t.a === h || t.b === h), h).toBe(true);
    expect(HOLE_BY_ID.has("s:M7.20")).toBe(true);
    expect(foreignContacts(s)).toEqual([]);
  });
  it("32 бит на дорожках проходит проверку проекта", () => {
    const steps = PROJECTS.find((p) => p.id === "proj-cpu32")!.check(cpu32Scene());
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
  }, 120000);
  it("всё на дорожках: модуль, упакованный с разведённой платы, — восемь штук на разведённой 32-битной — проверка проходит", () => {
    const def = packageChip(sliceScene(), "Срез 4 бит", "career:slice", 1);
    expect(def.package).toBe("SIP");
    // Та же цоколёвка и те же цепи, что у эталона уровня
    const want = packageRecipe(level, "x", (f) => allChips[`ref:${LEVELS.find((l) => l.func === f)!.id}`]);
    const pinsOf = (d: typeof def) => d.nets.map((n) => [...(n.pins ?? [])].sort((a, b) => a - b).join(",")).filter(Boolean).sort();
    expect(pinsOf(def)).toEqual(pinsOf(want));
    const steps = PROJECTS.find((p) => p.id === "proj-cpu32")!.check(cpu32Scene("career:slice", { "career:slice": def }));
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
  }, 180000);
});
