import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, goalMet, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

describe("задачи с ограничениями", () => {
  // Каждая задача выполнима: эталонная сборка её выполняет
  for (const level of LEVELS.filter((l) => l.goals)) {
    it(`${level.id}: эталон выполняет «${level.goals!.map((g) => g.text).join("», «")}»`, () => {
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const r = checkLevel(level, scene, allChips);
      expect(r.ok).toBe(true);
      for (const g of level.goals!) expect(goalMet(g, r.metrics), `${g.text}: ${JSON.stringify(r.metrics)}`).toBe(true);
    }, 60000);
  }
  it("метрика хуже порога — задача не выполнена", () => {
    const m = { width: 5, height: 5, links: 3, idle: 2e-6, transistors: 17, vmin: 2.5 };
    expect(goalMet({ metric: "transistors", max: 16, text: "" }, m)).toBe(false);
    expect(goalMet({ metric: "idle", max: 1e-6, text: "" }, m)).toBe(false);
    expect(goalMet({ metric: "vmin", max: 2, text: "" }, m)).toBe(false);
    expect(goalMet({ metric: "area", max: 25, text: "" }, m)).toBe(true);
  });
});
