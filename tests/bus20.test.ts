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
const rowsText = (r: ReturnType<typeof checkLevel>) => r.problems.join() + r.rows.map((x) => `${x.inputs.map(Number).join("")}→${x.volts.map((v) => v.toFixed(2)).join(",")} z=${x.z} ${x.ok}`).join("\n");

describe("DIP-20: 74HC244 и 74HC574", () => {
  for (const id of ["hc244", "hc574"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      expect(level.roles.length).toBe(20);
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const r = checkLevel(level, scene, allChips);
      expect(r.ok, rowsText(r)).toBe(true);
      expect(r.rows.some((x) => x.z?.some(Boolean))).toBe(true);
    }, 180000);
  }
  it("hc244: общее разрешение на обе четвёрки не проходит", () => {
    const level = levelById("hc244")!;
    const nets = level.recipe.nets.map((n) => (n[0] === "P19" ? ["P1", ...n.slice(1)] : n));
    const scene = recipeScene({ ...level, recipe: { ...level.recipe, nets } }, chipFor);
    applyBoards(scene.boards!);
    const r = checkLevel(level, scene, allChips);
    expect(r.ok, rowsText(r)).toBe(false);
  }, 120000);
});
