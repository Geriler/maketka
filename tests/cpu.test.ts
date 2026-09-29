import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards } from "../src/model/breadboard";
import { LEVELS, levelById, sequenceExpected, truth, type Level, type LogicFunc } from "../src/career/levels";
import { checkLevel, recipeScene, referenceChips } from "../src/career/build";

setLibrary([]);
const refs = referenceChips();
const refById = new Map(refs.map((d) => [d.id, d]));
const allChips = Object.fromEntries(refs.map((d) => [d.id, d]));
const chipFor = (func: LogicFunc) => refById.get(`ref:${func}-cmos`) ?? refById.get(`ref:${LEVELS.find((l) => l.func === func)!.id}`)!;
const rowsText = (r: ReturnType<typeof checkLevel>) => r.problems.join() + r.rows.map((x) => `${x.inputs.map(Number).join("")}→${x.volts.map((v) => v.toFixed(2)).join(",")} z=${x.z} ${x.ok}`).join("\n");
const run = (level: Level) => {
  const scene = recipeScene(level, chipFor);
  applyBoards(scene.boards!);
  return checkLevel(level, scene, allChips);
};
const bitsOf = (st: string) => [...st].map((c) => c === "1");
const outs = (level: Level) => sequenceExpected(level).map((o) => o.map(Number).join(""));

describe("к процессору: 74HC157, 74HC161, 74HC173", () => {
  it("74HC157 по таблице Nexperia: E̅ = 1 — нули, S выбирает I0 / I1", () => {
    // E̅ S 1I0 1I1 2I0 2I1 3I0 3I1 4I0 4I1
    expect(truth("mux4q", bitsOf("1011111111"))).toEqual([false, false, false, false]);
    expect(truth("mux4q", bitsOf("0010011001"))).toEqual([true, false, true, false]);
    expect(truth("mux4q", bitsOf("0110011001"))).toEqual([false, true, false, true]);
  });

  it("74HC161: счёт до 15 с RCO, ENT = 0 гасит RCO, загрузка главнее счёта, CLR̅ без такта", () => {
    const o = outs(levelById("hc161")!);
    // После 15 фронтов — 15 и RCO; ENT = 0 — RCO гаснет, счёт стоит; ещё фронт — 0
    expect(o[31]).toBe("11111");
    expect(o[32]).toBe("11110");
    expect(o[33]).toBe("11110");
    expect(o[35]).toBe("00000");
    // Загрузка 5 (A = 1, C = 1) при ENP = ENT = 1
    expect(o[42]).toBe("10100");
    // CLR̅ = 0 без фронта
    expect(o[44]).toBe("00000");
  });

  it("74HC173: E̅ = 1 — хранит, запись при отключённых выходах, MR — ноль", () => {
    const o = outs(levelById("hc173")!);
    expect(o[2]).toBe("1010");
    expect(o[4]).toBe("1010");
    expect(o[6]).toBe("1010");
    expect(o[8]).toBe("0110");
    expect(o[12]).toBe("0001");
    expect(o[13]).toBe("0000");
    expect(o[15]).toBe("1111");
  });

  for (const id of ["hc157", "cnt1", "hc161", "hc173"]) {
    it(`${id}: эталонная сборка проходит проверку`, () => {
      const r = run(levelById(id)!);
      expect(r.ok, rowsText(r)).toBe(true);
    }, 180000);
  }

  it("74HC157 без запрета по E̅ не проходит", () => {
    const level = levelById("hc157")!;
    // Выходы мультиплексоров прямо на выводы, И и НЕ не используются
    const nets = level.recipe.nets.filter((n) => !n.some((x) => /^A\d\.[14]$/.test(x))).concat([["M1.4", "P4"], ["M2.4", "P7"], ["M3.4", "P9"], ["M4.4", "P12"]]);
    const r = run({ ...level, recipe: { ...level.recipe, nets } });
    expect(r.ok).toBe(false);
  }, 120000);

  it("74HC173 без удержания (D прямо на триггер) не проходит", () => {
    const level = levelById("hc173")!;
    const nets = level.recipe.nets.map((n) => (n[0] === "O1.4" ? ["O1.4"] : n));
    // Мультиплексор всегда пропускает D: S — к общему
    const r = run({ ...level, recipe: { ...level.recipe, nets: [...nets, ["P8", "MX.1"]] } });
    expect(r.ok).toBe(false);
  }, 120000);

  it("74HC161 с цепочкой переносов от ENP вместо ENT не проходит (RCO не должен зависеть от ENP)", () => {
    const level = levelById("hc161")!;
    const nets = level.recipe.nets.map((n) => (n[0] === "P10" ? ["P10", "D1.5"] : n[0] === "P7" ? ["P7", "D1.6", "D2.5", "D3.5", "D4.5"] : n));
    const r = run({ ...level, recipe: { ...level.recipe, nets } });
    expect(r.ok).toBe(false);
  }, 120000);
});
