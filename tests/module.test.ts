import { describe, expect, it } from "vitest";
import { applyBoards, boardSize, chipField, chipPinAt, footprintPads, packageName, parsePackage, pinOffsets, seatProblem } from "../src/model/breadboard";
import { packageProblems } from "../src/chips/package";
import { CPU8_OUT, CPU8_PROGRAM, cpu8Emulate, cpuRun } from "../src/career/projects";
import { schematicSvg } from "../src/view/schematic";
import { Simulation } from "../src/sim/simulation";
import { cpuOfModules, sliceCase, sliceModule } from "./module-build";

describe("модуль: своя плата на штыревом разъёме", () => {
  it("SIP-n: выводы в один ряд через шаг, у ближнего края платы; посадочное место — n отверстий в ряд", () => {
    expect(parsePackage("SIP-20")).toEqual({ package: "SIP", pins: 20 });
    expect(packageName("SIP", 20)).toBe("модуль SIP-20");
    expect(pinOffsets("SIP", 4)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    const s = sliceCase();
    const b = s.boards![0];
    const at = [1, 2, 20].map((n) => chipPinAt(b, n - 1));
    expect(at[1].x - at[0].x).toBe(1);
    expect(at[2].x - at[0].x).toBe(19);
    expect(new Set(at.map((p) => p.z)).size).toBe(1);
    // Плата в натуральную величину: 20 выводов + поля
    expect(chipField(b)).toEqual({ cols: 22, rows: 14 });
    expect(boardSize(b).width).toBe(25);
    const pads = footprintPads("SIP-5");
    expect(pads.map((p) => p.x / 2.54)).toEqual([-2, -1, 0, 1, 2]);
    expect(new Set(pads.map((p) => p.z)).size).toBe(1);
  });
  it("срез из четырёх 74HC в SOIC помещается на модуль SIP-20, а в DIP-20 — нет: там место считается клетками", () => {
    const sip = sliceCase("SIP");
    for (const seat of sip.boards![0].seats!) expect(seatProblem(sip.boards![0], seat)).toBeUndefined();
    expect(packageProblems(sip)).toEqual([]);
    const dip = sliceCase("DIP");
    applyBoards(dip.boards!);
    expect(packageProblems(dip).join()).toMatch(/Не помещается в DIP-20: начинка занимает 1186 клеток из 40/);
  });
  it("упакованный модуль: корпус SIP-20, выводы с именами, на схеме — с номерами", () => {
    const def = sliceModule();
    expect(def.package).toBe("SIP");
    expect(def.pins).toBe(20);
    expect(def.parts.map((p) => p.id).sort()).toEqual(["AD", "MX", "RA", "RO"]);
    expect(def.pinRoles.filter((r) => r === "nc").length).toBe(3);
    const sc = cpuOfModules(def);
    const svg = schematicSvg(sc, new Simulation(sc));
    expect(svg).toContain("Срез");
    expect(svg).not.toMatch(/NaN|undefined/);
  });
  it("8-битный процессор из двух модулей-срезов считает как эмулятор", () => {
    const def = sliceModule();
    const r = cpuRun(cpuOfModules(def), CPU8_OUT);
    expect(r.afterReset).toBe(0);
    expect(r.outs).toEqual(cpu8Emulate(CPU8_PROGRAM, 24));
    expect(r.again).toEqual(cpu8Emulate(CPU8_PROGRAM, 6));
    expect([...r.hurt]).toEqual([]);
  }, 120000);
});
