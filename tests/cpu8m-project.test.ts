import { describe, expect, it } from "vitest";
import type { Endpoint } from "../src/model/types";
import { PROJECTS } from "../src/career/projects";
import { checkLevel, kitIndex, kitUsed, recipeScene } from "../src/career/build";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS } from "../src/career/levels";
import { P, allChips, cpuOfModules } from "./module-build";

const proj = PROJECTS.find((p) => p.id === "proj-cpu8m")!;
const text = (steps: { ok: boolean; text: string }[]) => steps.map((x) => `${x.ok ? "✓" : "✗"} ${x.text}`).join("\n");
const slice = () => allChips["ref:slice"];

describe("8 бит из модулей «Срез»", () => {
  it("уровень «Срез» открывает модуль SIP-20", () => {
    const level = LEVELS.find((l) => l.id === "slice")!;
    expect(level.package).toBe("SIP");
    expect(slice().package).toBe("SIP");
    expect(slice().pins).toBe(20);
  });
  it("эталон из двух модулей проходит проверку; модули засчитываются в набор", () => {
    const s = cpuOfModules(slice(), 2, "proj-cpu8m");
    const steps = proj.check(s);
    expect(steps.every((x) => x.ok), text(steps)).toBe(true);
    const mods = s.components.filter((c) => c.type === "chip" && c.def === "ref:slice");
    expect(mods.length).toBe(2);
    const k = kitIndex(proj.kit!, mods[0]);
    expect(proj.kit![k]).toMatchObject({ part: "chip", func: "slice4" });
    expect(kitUsed(proj.kit!, s)[k]).toBe(2);
  }, 120000);
  it("без переноса между модулями (CI старшего — на общий) — не проходит", () => {
    const minus: Endpoint = { comp: "G1", pin: 0 };
    const s = cpuOfModules(slice(), 2, "proj-cpu8m", (w) => w.map(([a, b]): [Endpoint, Endpoint] => (JSON.stringify(a) === JSON.stringify(P("M0", 12)) ? [minus, b] : [a, b])));
    const steps = proj.check(s);
    expect(steps.find((x) => x.text.startsWith("Такт за тактом"))?.ok, text(steps)).toBe(false);
  }, 120000);
  it("уровень «Срез»: вход, оставленный в воздухе (OE̅1 регистра A), — не проходит, даже если таблица сошлась", () => {
    const base = LEVELS.find((l) => l.id === "slice")!;
    const level = { ...base, recipe: { ...base.recipe, nets: base.recipe.nets.map((n) => n.filter((m) => m !== "RA.1")) } };
    const scene = recipeScene(level, (f) => allChips[`ref:${f}-cmos`] ?? allChips[`ref:${LEVELS.find((l) => l.func === f)!.id}`]);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    expect(r.rows.length && r.rows.every((x) => x.ok)).toBeTruthy();
    expect(r.problems.join()).toMatch(/висят в воздухе.*RA\.1 \(OE̅1\)/);
  }, 120000);
});
