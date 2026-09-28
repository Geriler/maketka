import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const show = (steps: { ok: boolean; text: string }[] = []) => steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n");

describe("операционный усилитель: LM321 → LM358", () => {
  for (const id of ["lm321", "lm358"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const r = checkLevel(level, scene, allChips);
      expect(r.ok, show(r.steps) + r.problems.join()).toBe(true);
    }, 180000);
  }

  it("компаратор вместо усилителя (выход — открытый коллектор без повторителя) не проходит", () => {
    const level = levelById("lm321")!;
    // Выход прямо с коллектора каскада усиления, повторителя и R5 нет
    const nets = level.recipe.nets
      .map((n) => n.map((e) => (e === "VT8.B" ? "P4" : e)))
      .map((n) => n.filter((e) => !/^VT8\.|^R5\./.test(e)))
      .filter((n) => n.length > 1);
    const parts = level.recipe.parts.filter((p) => p.id !== "VT8" && p.id !== "R5");
    const scene = recipeScene({ ...level, recipe: { parts, nets } }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok).toBe(false);
    // Не тянет нагрузку: ток отдаёт только резистор каскада
    expect(r.steps!.find((x) => x.text.includes("нагрузкой 2 кОм"))!.ok, show(r.steps)).toBe(false);
  }, 60000);
});
