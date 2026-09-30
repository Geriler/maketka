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

/** ОЗУ 16 × 4 с третьим состоянием и прямыми выходами — SN74LS219A (TI, D2417). */
export const RAM_ID = "ref:ram219";
export const RAM_WORDS = 16;

/**
 * DIP-16: 1 A0, 2 S̅ (выбор), 3 R/W̅, 4 D1, 5 Q1, 6 D2, 7 Q2, 8 GND, 9 Q3, 10 D3, 11 Q4, 12 D4,
 * 13 A3, 14 A2, 15 A1, 16 VCC. S̅ = 0 и R/W̅ = 0 — запись D в выбранное слово (выходы отключены);
 * S̅ = 0 и R/W̅ = 1 — чтение; S̅ = 1 — выходы отключены.
 */
export function ramDef(): ChipDef {
  return {
    id: RAM_ID,
    name: "74LS219",
    package: "DIP",
    pins: 16,
    pinNames: ["A0", "S̅", "R/W̅", "D1", "Q1", "D2", "Q2", "", "Q3", "D3", "Q4", "D4", "A3", "A2", "A1", ""],
    pinRoles: ["in", "in", "in", "in", "out", "in", "out", "gnd", "out", "in", "out", "in", "in", "in", "in", "vcc"],
    parts: [],
    nets: [],
    scene: { components: [], wires: [] },
    updatedAt: 0,
    absMax: 7,
  };
}

/** Адрес ОЗУ по входам модели (S̅, R/W̅, A0…A3, D1…D4). */
const ramAddr = (bits: boolean[]) => bits.slice(2, 6).reduce((m, b, i) => m | (b ? 1 << i : 0), 0);

/**
 * Модель по даташиту SN74LS219A (Vcc 5 В): ноль — 0,25 В при 12 мА, единица — 3,1 В при 2,6 мА
 * (без нагрузки около 3,4 В), ток потребления 35 мА; входы TTL 0,8 / 2,0 В. Запись — пока S̅ и R/W̅
 * в нуле (по уровню, как у настоящей: успевает за время, пока держится импульс записи).
 */
const RAM_MODEL: ChipModel = {
  inputs: [2, 3, 1, 15, 14, 13, 4, 6, 10, 12],
  outputs: [5, 7, 9, 11],
  vcc: 16,
  gnd: 8,
  logic: (bits, _prev, data) => {
    const w = (data?.[ramAddr(bits)] ?? 0) & 15;
    return [0, 1, 2, 3].map((k) => !!(w & (1 << k)));
  },
  ram: {
    words: RAM_WORDS,
    write: (bits) => (!bits[0] && !bits[1] ? [ramAddr(bits), bits.slice(6, 10).reduce((m, b, i) => m | (b ? 1 << i : 0), 0)] : undefined),
  },
  z: (bits) => Array(4).fill(bits[0] || !bits[1]),
  points: [
    {
      volts: 5,
      rHigh: Array(4).fill(100),
      dHigh: Array(4).fill(1.6),
      rLow: Array(4).fill(8),
      dLow: Array(4).fill(0.15),
      rIn: Array(10).fill(1e9),
      iq: 0.035,
    },
  ],
  vmin: 4.5,
  vmax: 5.5,
  absMax: 7,
  hyst: [0.8 / 5, 2.0 / 5],
};

/**
 * Что в ОЗУ после включения питания: «что попало» — у настоящего ячейки встают как придётся.
 * Своё для каждого включения (seed), но одно и то же при повторе — чтобы расчёт был воспроизводим.
 */
export function ramGarbage(words: number, width: number, seed: number): number[] {
  let x = (seed * 2654435761) >>> 0 || 1;
  return Array.from({ length: words }, () => {
    x = (x * 1103515245 + 12345) >>> 0;
    return (x >>> 16) & ((1 << width) - 1);
  });
}

/** Модель микросхемы памяти или undefined — если это не она. */
export function memoryModel(def: ChipDef): ChipModel | undefined {
  return def.id === PROM_ID ? PROM_MODEL : def.id === RAM_ID ? RAM_MODEL : undefined;
}

/** Все микросхемы памяти — для списка заводских. */
export const memoryChips = (): ChipDef[] => [promDef(), ramDef()];

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
