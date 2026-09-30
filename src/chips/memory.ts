/**
 * Микросхемы памяти с содержимым: программируемое ПЗУ. Содержимое у каждой поставленной своё
 * (Chip.data) и правится в её панели; начинки нет — считается только моделью, поведение и
 * электрические параметры — по даташиту, а не сняты с чьей-то сборки, как у остальных заводских.
 */

import type { ChipDef } from "../model/types";
import type { ChipModel } from "./model";

/** ПЗУ 32 × 8 с третьим состоянием — DM74S288 (National Semiconductor, TL/D/8360). */
export const PROM_ID = "ref:prom288";
export const PROM_WORDS = 32;

/**
 * DIP-16: 1–7 Q0…Q6, 8 GND, 9 Q7, 10–14 A0…A4, 15 G̅ (разрешение, активный ноль), 16 VCC.
 * С завода все биты — нули; единицы прошивают (здесь — вписывают в таблицу).
 */
export function promDef(): ChipDef {
  return {
    id: PROM_ID,
    name: "74S288",
    package: "DIP",
    pins: 16,
    pinNames: ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "", "Q7", "A0", "A1", "A2", "A3", "A4", "G̅", ""],
    pinRoles: ["out", "out", "out", "out", "out", "out", "out", "gnd", "out", "in", "in", "in", "in", "in", "in", "vcc"],
    parts: [],
    nets: [],
    scene: { components: [], wires: [] },
    updatedAt: 0,
    absMax: 7,
  };
}

/** Слово по адресу (нет содержимого или за пределами — нули, как у непрошитой). */
export const promWord = (data: number[] | undefined, addr: number) => (data?.[addr] ?? 0) & 255;

/**
 * Модель по даташиту DM74S288 (Vcc 5 В): ноль — 0,35 В при 16 мА, единица — 3,2 В при 6,5 мА
 * (выход TTL: без нагрузки около 3,5 В), ток потребления 70 мА. Входы TTL: ниже 0,8 В — ноль,
 * выше 2,0 В — единица; висящий вход — единица, как у TTL. Питание 4,5–5,5 В (военное исполнение
 * того же кристалла; у коммерческого 4,75–5,25 В), абсолютный максимум 7 В.
 */
const PROM_MODEL: ChipModel = {
  // G̅, A0…A4
  inputs: [15, 10, 11, 12, 13, 14],
  // Q0…Q7
  outputs: [1, 2, 3, 4, 5, 6, 7, 9],
  vcc: 16,
  gnd: 8,
  logic: (bits, _prev, data) => {
    const w = promWord(data, bits.slice(1, 6).reduce((m, b, i) => m | (b ? 1 << i : 0), 0));
    return [0, 1, 2, 3, 4, 5, 6, 7].map((k) => !!(w & (1 << k)));
  },
  z: (bits) => Array(8).fill(bits[0]),
  points: [
    {
      volts: 5,
      rHigh: Array(8).fill(46),
      dHigh: Array(8).fill(1.5),
      rLow: Array(8).fill(16),
      dLow: Array(8).fill(0.1),
      rIn: Array(6).fill(1e9),
      iq: 0.07,
    },
  ],
  vmin: 4.5,
  vmax: 5.5,
  absMax: 7,
  hyst: [0.8 / 5, 2.0 / 5],
};

/** Модель микросхемы памяти или undefined — если это не она. */
export function memoryModel(def: ChipDef): ChipModel | undefined {
  return def.id === PROM_ID ? PROM_MODEL : undefined;
}

/** Все микросхемы памяти — для списка заводских. */
export const memoryChips = (): ChipDef[] => [promDef()];

/** Текст слова для таблицы: две шестнадцатеричные цифры. */
export const hex2 = (w: number) => (w & 255).toString(16).toUpperCase().padStart(2, "0");

/**
 * Разобрать то, что вписали в ячейку: восемь нулей и единиц — двоичное, иначе шестнадцатеричное
 * (можно с 0x), «d» впереди — десятичное. Не число или больше 255 — undefined.
 */
export function parseWord(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/_/g, "");
  if (!t) return 0;
  const v = /^[01]{8}$/.test(t) ? parseInt(t, 2) : /^d\d+$/.test(t) ? parseInt(t.slice(1), 10) : /^(0x)?[0-9a-f]{1,2}$/.test(t) ? parseInt(t.replace(/^0x/, ""), 16) : NaN;
  return Number.isInteger(v) && v >= 0 && v <= 255 ? v : undefined;
}
