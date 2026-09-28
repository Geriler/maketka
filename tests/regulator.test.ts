import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const show = (steps: { ok: boolean; text: string }[] = []) => steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n");
const check = (level: Level, recipe = level.recipe) => {
  const scene = recipeScene({ ...level, recipe }, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
};

describe("стабилизатор: ИОН на стабилитроне → LM78L05", () => {
  for (const id of ["vref", "lm78l05"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const r = check(levelById(id)!);
      expect(r.ok, show(r.steps) + r.problems.join()).toBe(true);
    }, 180000);
  }

  it("ИОН со стабилитроном через резистор (без источника тока) не держит напряжение при смене входа", () => {
    const level = levelById("vref")!;
    // Стабилитрон питается от входа через R1 220 Ом → 1 кОм нет в наборе, но и 220 Ом показывают суть: ток растёт вместе со входом
    const parts = level.recipe.parts.filter((p) => !["VT1", "VD1", "VD2", "R2"].includes(p.id));
    const nets = [["P1", "R1.1"], ["R1.2", "VD3.2", "P3"], ["VD3.1", "P2"]];
    const r = check(level, { parts, nets });
    expect(r.ok).toBe(false);
    expect(r.steps!.find((x) => x.text.startsWith("Вход"))!.ok, show(r.steps)).toBe(false);
  }, 60000);

  it("LM78L05 из одного повторителя (без усилителя ошибки) не проходит: выход ниже на Uбэ", () => {
    const level = levelById("lm78l05")!;
    const parts = level.recipe.parts.filter((p) => p.id !== "D2");
    const nets = [["P8", "D1.1", "VT1.C"], ["P2", "P3", "P6", "P7", "D1.2"], ["D1.3", "VT1.B"], ["VT1.E", "P1"]];
    const r = check(level, { parts, nets });
    expect(r.ok, show(r.steps)).toBe(false);
  }, 60000);
});
