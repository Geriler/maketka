import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;

describe("счётчик «один из десяти»: Джонсон → 74HC4017", () => {
  it("таблица 4017 — как у Nexperia: счёт по фронту CP0 при CP1̅ = 0 и по спаду CP1̅ при CP0 = 1, MR — в Q0", () => {
    const l = levelById("hc4017")!;
    const exp = sequenceExpected(l, 0);
    const at = (k: number) => exp[k].slice(0, 10).indexOf(true);
    // Шаги: 0 — MR; 1 — «000»; дальше 11 тактов (по два шага): после 10 фронтов снова Q0
    expect(at(1)).toBe(0);
    expect(at(2)).toBe(1);
    expect(at(20)).toBe(0);
    expect(at(22)).toBe(1);
    // CP1̅ = 1: фронт CP0 не считает; спад CP1̅ при CP0 = 1 — считает; MR — сразу Q0
    expect(at(25)).toBe(1);
    expect(at(28)).toBe(2);
    expect(at(30)).toBe(3);
    expect(at(33)).toBe(0);
    expect(exp[2][10]).toBe(true);
    expect(exp[10][10]).toBe(false);
  });
  for (const id of ["johnson", "hc4017"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const level = levelById(id)!;
      const scene = recipeScene(level, chipFor);
      applyBoards(scene.boards!);
      const r = checkLevel(level, scene, allChips);
      expect(r.problems.concat(r.rows.filter((x) => !x.ok).map((x) => JSON.stringify(x)).slice(0, 3))).toEqual([]);
      expect(r.ok).toBe(true);
    }, 120000);
  }
});
