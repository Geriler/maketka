import { describe, expect, it } from "vitest";
import { setLibrary } from "../src/chips/registry";
import { applyBoards, padsAlong, seatProblem, type BoardSpec } from "../src/model/breadboard";
import type { Scene } from "../src/model/types";
import { SMD_REPAIRS } from "../src/career/repairsSmd";

setLibrary([]);
const ready = (s: Scene) => {
  applyBoards(s.boards ?? []);
  return s;
};

/** Раскладка платы: места не мешают друг другу, дорожка касается только своих площадок. */
function layoutOk(s: Scene): string[] {
  ready(s);
  const bad: string[] = [];
  for (const b of s.boards ?? []) {
    if (b.kind !== "smd") continue;
    for (const seat of b.seats ?? []) {
      const others: BoardSpec = { ...b, seats: (b.seats ?? []).filter((x) => x !== seat) };
      const p = seatProblem(others, seat);
      if (p) bad.push(`${seat.id}: ${p}`);
    }
  }
  for (const t of s.traces ?? []) {
    const on = padsAlong(t.a, t.b);
    if (on.length !== 2) bad.push(`${t.a}–${t.b}: ${on.join(", ")}`);
  }
  return bad;
}

describe("ремонты на SMD: раскладка плат", () => {
  it("раскладка плат без пересечений", () => {
    for (const r of SMD_REPAIRS) expect(layoutOk(r.start()), r.id).toEqual([]);
  });
});
