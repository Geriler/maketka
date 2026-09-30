import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, ROM8, levelById, truth, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const run = (level: Level) => {
  const scene = recipeScene(level, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
};
const rowsText = (r: ReturnType<typeof checkLevel>) => r.problems.join() + r.rows.map((x) => `${x.inputs.map(Number).join("")}→${x.volts.map((v) => v.toFixed(2)).join(",")} ${x.ok}`).join("\n");

describe("ПЗУ на диодах", () => {
  it("таблица уровня совпадает с описанием", () => {
    const about = levelById("rom8")!.about;
    ROM8.forEach((w, a) => {
      expect(about).toContain(`${a} → ${w.toString(2).padStart(4, "0")}`);
      const bits = [0, 1, 2].map((i) => !!(a & (1 << i)));
      expect(truth("rom8", bits)).toEqual([0, 1, 2, 3].map((k) => !!(w & (1 << k))));
    });
  });
  it("эталонная сборка проходит проверку", () => {
    const r = run(levelById("rom8")!);
    expect(r.ok, rowsText(r)).toBe(true);
  }, 120000);
  it("диод, повёрнутый наоборот, — не проходит", () => {
    const level = levelById("rom8")!;
    // Соединения — по выводам: меняем местами анод и катод VD2 в цепях
    const nets = level.recipe.nets.map((n) => n.map((x) => (x === "VD2.1" ? "VD2.2" : x === "VD2.2" ? "VD2.1" : x)));
    const r = run({ ...level, recipe: { ...level.recipe, nets } });
    expect(r.ok, rowsText(r)).toBe(false);
    // Провал — именно в словах, где этот диод должен давать ноль
    expect(r.rows.some((x) => !x.ok)).toBe(true);
  }, 120000);
});
