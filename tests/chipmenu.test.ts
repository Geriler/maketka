import { describe, expect, it } from "vitest";
import { LEVELS } from "../src/career/levels";
import { chipCat } from "../src/ui/tools";

describe("меню микросхем по разделам", () => {
  it("у каждой микросхемы карьеры есть раздел (не «Свои»)", () => {
    const lost = LEVELS.filter((l) => chipCat(`chip:ref:${l.id}`) === "Свои").map((l) => `${l.id} (${l.func})`);
    expect(lost).toEqual([]);
  });
  it("собранная в песочнице — в «Свои»", () => {
    expect(chipCat("chip:user-123")).toBe("Свои");
    expect(chipCat("chip:ref:hc245")).toBe("Шина");
    expect(chipCat("chip:career:hc161")).toBe("Счёт и время");
  });
});
