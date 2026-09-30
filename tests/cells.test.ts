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
const run = (level: Level) => {
  const scene = recipeScene(level, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
};
const text = (r: ReturnType<typeof checkLevel>) => r.problems.join() + "\n" + (r.steps ?? []).map((s) => `${s.ok ? "✓" : "✗"} ${s.text}`).join("\n");

describe("ячейки памяти", () => {
  it("SRAM: эталон (6 транзисторов) проходит", () => {
    const r = run(levelById("sram1")!);
    expect(r.ok, text(r)).toBe(true);
  }, 120000);
  it("SRAM: без ключей (линии прямо на защёлку) — не проходит", () => {
    const level = levelById("sram1")!;
    const nets = level.recipe.nets.map((n) => n.map((x) => x.replace("VT5.D", "VT5.S").replace("VT6.D", "VT6.S")));
    // Линии данных прямо на узлы защёлки: VT5.S и VT6.S уже в узлах Q и Q̅
    const r = run({ ...level, recipe: { ...level.recipe, nets } });
    expect(r.ok, text(r)).toBe(false);
  }, 120000);
  it("DRAM: эталон (два ключа навстречу и конденсатор) проходит", () => {
    const r = run(levelById("dram1")!);
    expect(r.ok, text(r)).toBe(true);
  }, 120000);
  it("DRAM: один транзистор — внутренний диод портит бит, не проходит", () => {
    const level = levelById("dram1")!;
    const parts = level.recipe.parts.filter((p) => p.id !== "VT2");
    const nets = [["P1", "VT1.G"], ["P2", "VT1.D"], ["VT1.S", "C1.1"], ["C1.2", "P4"]];
    const one = run({ ...level, kit: level.kit, recipe: { parts, nets } });
    expect(one.ok, text(one)).toBe(false);
    // И повёрнутый другой стороной — тоже
    const flip = run({ ...level, recipe: { parts, nets: [["P1", "VT1.G"], ["P2", "VT1.S"], ["VT1.D", "C1.1"], ["C1.2", "P4"]] } });
    expect(flip.ok, text(flip)).toBe(false);
  }, 120000);
});
