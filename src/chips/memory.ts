/**
 * Микросхемы памяти с содержимым: программируемое ПЗУ. Содержимое у каждой поставленной своё
 * (Chip.data) и правится в её панели; начинки нет — считается только моделью, поведение и
 * электрические параметры — по даташиту, а не сняты с чьей-то сборки, как у остальных заводских.
 */

import type { ChipDef } from "../model/types";
import type { Footprint } from "../model/breadboard";
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

// ─── Память 32K × 8: Hitachi HM62256B (SRAM) и Atmel AT28C256 (EEPROM) ──────────────

/**
 * Цоколёвка JEDEC 28 выводов — одна у обеих (HM62256B, ADE-203-135F; AT28C256, 0006H):
 * 1 A14, 2 A12, 3 A7, 4 A6, 5 A5, 6 A4, 7 A3, 8 A2, 9 A1, 10 A0, 11–13 I/O0…I/O2, 14 GND,
 * 15–19 I/O3…I/O7, 20 C̅S̅ (у EEPROM — C̅E̅), 21 A10, 22 O̅E̅, 23 A11, 24 A9, 25 A8, 26 A13, 27 W̅E̅, 28 VCC.
 */
const ADDR28 = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const IO28 = [11, 12, 13, 15, 16, 17, 18, 19];
function def28(id: string, name: string, cs: string, pkg: "DIP" | "DIPW"): ChipDef {
  const names = Array<string>(28).fill("");
  const roles = Array<ChipDef["pinRoles"][number]>(28).fill("in");
  ADDR28.forEach((p, i) => (names[p - 1] = `A${i}`));
  IO28.forEach((p, i) => ((names[p - 1] = `I/O${i}`), (roles[p - 1] = "io")));
  names[19] = cs;
  names[21] = "O̅E̅";
  names[26] = "W̅E̅";
  roles[13] = "gnd";
  roles[27] = "vcc";
  return { id, name, package: pkg, pins: 28, pinNames: names, pinRoles: roles, parts: [], nets: [], scene: { components: [], wires: [] }, updatedAt: 0, absMax: 7 };
}
/** Входы модели 28-выводной памяти: C̅S̅, O̅E̅, W̅E̅, A0…A14, I/O0…I/O7. */
const IN28 = [20, 22, 27, ...ADDR28, ...IO28];
const addr28 = (bits: boolean[]) => bits.slice(3, 18).reduce((m, b, i) => m | (b ? 1 << i : 0), 0);
const data28 = (bits: boolean[]) => bits.slice(18, 26).reduce((m, b, i) => m | (b ? 1 << i : 0), 0);
const byteBits = (w: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => !!(w & (1 << k)));

/** SRAM 32K × 8 — Hitachi HM62256B (L-версия: хранит данные до 2 В). */
export const SRAM_ID = "ref:sram62256";
export const sramDef = (): ChipDef => def28(SRAM_ID, "HM62256B", "C̅S̅", "DIP");

/**
 * Модель по даташиту HM62256B (Vcc 5 В ± 10 %): чтение — C̅S̅ = 0, O̅E̅ = 0, W̅E̅ = 1; запись —
 * C̅S̅ = 0 и W̅E̅ = 0 (O̅E̅ — любой, выходы отключены), по уровню, пока держится W̅E̅; C̅S̅ = 1 —
 * покой, выходы отключены. Входы TTL: ниже 0,8 В — ноль, выше 2,2 В — единица. Выход:
 * 0,4 В при 2,1 мА и 2,4 В при −1 мА (гарантированные, у КМОП без нагрузки — почти до питания),
 * ток 6 мА (типичный). Абсолютный максимум питания 7 В.
 */
const SRAM_MODEL: ChipModel = {
  inputs: IN28,
  outputs: IO28,
  vcc: 28,
  gnd: 14,
  logic: (bits, _prev, data) => byteBits((data?.[addr28(bits)] ?? 0) & 255),
  ram: { words: 32768, write: (bits) => (!bits[0] && !bits[2] ? [addr28(bits), data28(bits)] : undefined) },
  z: (bits) => Array(8).fill(bits[0] || bits[1] || !bits[2]),
  points: [{ volts: 5, rHigh: Array(8).fill(2600), dHigh: Array(8).fill(0), rLow: Array(8).fill(190), dLow: Array(8).fill(0), rIn: Array(IN28.length).fill(1e9), iq: 0.006 }],
  vmin: 4.5,
  vmax: 5.5,
  absMax: 7,
  hyst: [0.8 / 5, 2.2 / 5],
};

/** EEPROM 32K × 8 — Atmel AT28C256 (цикл записи 10 мс; у AT28C256F — 3 мс). */
export const EEPROM_ID = "ref:ee28c256";
export const eepromDef = (): ChipDef => def28(EEPROM_ID, "AT28C256", "C̅E̅", "DIPW");
/** Время внутреннего цикла записи tWC, с (AT28C256, наибольшее по даташиту). */
export const EEPROM_TWC = 0.01;
/** Ниже такого питания, В, запись запрещена (VCC sense, типичное). */
export const EEPROM_VSENSE = 3.8;
/** После того как питание достигло 3,8 В, запись запрещена ещё столько, с (power-on delay, типичное). */
export const EEPROM_POWER_ON = 0.005;
/** Стёртая ячейка — все единицы; такая здесь пустая EEPROM (что в ней с завода, даташит не говорит). */
export const EEPROM_BLANK = 0xff;
export const eepromWord = (data: number[] | undefined, addr: number) => (data?.[addr] ?? EEPROM_BLANK) & 255;

/**
 * Модель по даташиту AT28C256 (Vcc 5 В ± 10 %): чтение — C̅E̅ = 0, O̅E̅ = 0, W̅E̅ = 1, иначе выходы
 * отключены. Запись байта — импульс W̅E̅ = 0 при C̅E̅ = 0 и O̅E̅ = 1: адрес защёлкивается по спаду,
 * данные — по фронту; дальше внутренний цикл tWC, пока он идёт, чтение — это опрос: на I/O7 —
 * дополнение записанного бита, I/O6 переключается от чтения к чтению (здесь — каждую миллисекунду).
 * Запись запрещена ниже 3,8 В питания и 5 мс после включения. Входы TTL 0,8 / 2,0 В; выход 0,45 В
 * при 2,1 мА и 2,4 В при −0,4 мА; ток до 50 мА; входы — не выше 6,25 В.
 */
const EEPROM_MODEL: ChipModel = {
  inputs: IN28,
  outputs: IO28,
  vcc: 28,
  gnd: 14,
  logic: (bits, _prev, data) => byteBits(eepromWord(data, addr28(bits))),
  eeprom: {
    words: 32768,
    // Байт — по фронту W̅E̅ (или C̅E̅) после импульса записи: адрес и данные — какими были в импульсе
    write: (prev, now) => {
      const pulse = !prev[0] && !prev[2] && prev[1];
      const ended = now[0] || now[2];
      return pulse && ended ? [addr28(prev), data28(now[1] && !now[0] ? now : prev)] : undefined;
    },
    twc: EEPROM_TWC,
    vsense: EEPROM_VSENSE,
    powerOn: EEPROM_POWER_ON,
    blank: EEPROM_BLANK,
  },
  z: (bits) => Array(8).fill(bits[0] || bits[1] || !bits[2]),
  points: [{ volts: 5, rHigh: Array(8).fill(6500), dHigh: Array(8).fill(0), rLow: Array(8).fill(214), dLow: Array(8).fill(0), rIn: Array(IN28.length).fill(1e9), iq: 0.05 }],
  vmin: 4.5,
  vmax: 5.5,
  absMax: 6.25,
  hyst: [0.8 / 5, 2.0 / 5],
};

// ─── Реестр ─────────────────────────────────────────────────────────────────────

/** ПЗУ — содержимое в проекте, правится в панели; ОЗУ — в расчёте; EEPROM — в проекте, пишется и схемой. */
export type MemoryKind = "rom" | "ram" | "eeprom";
export interface MemoryInfo {
  id: string;
  kind: MemoryKind;
  /** Слов и бит в слове. */
  words: number;
  width: number;
  /** Уровень карьеры, после которого микросхема есть в наборах. */
  opener: string;
  /** Как назвать в «сначала откройте». */
  label: string;
  /** Выводы адреса A0… и выбора (активный ноль) — чтобы подсветить текущее слово в панели. */
  addrPins: number[];
  selectPin: number;
  /** Чистая ячейка. */
  blank: number;
  /** Посадочное место на плате под SMD, если не SO-n. */
  smdFp?: Footprint;
  /** Название корпуса и откуда параметры — для панели. */
  source: string;
  def(): ChipDef;
  model: ChipModel;
}
export const MEMORIES: MemoryInfo[] = [
  { id: PROM_ID, kind: "rom", words: PROM_WORDS, width: 8, opener: "rom8", label: "ПЗУ 74S288", addrPins: [10, 11, 12, 13, 14], selectPin: 15, blank: 0, source: "DM74S288: выходы и входы TTL, питание 4,5–5,5 В, потребляет около 70 мА", def: promDef, model: PROM_MODEL },
  { id: RAM_ID, kind: "ram", words: RAM_WORDS, width: 4, opener: "ram4", label: "ОЗУ 74LS219", addrPins: [1, 15, 14, 13], selectPin: 2, blank: 0, source: "SN74LS219A: выходы и входы TTL, питание 4,5–5,5 В, потребляет около 35 мА", def: ramDef, model: RAM_MODEL },
  { id: SRAM_ID, kind: "ram", words: 32768, width: 8, opener: "ram4", label: "ОЗУ HM62256B", addrPins: ADDR28, selectPin: 20, blank: 0, smdFp: "SOP-28", source: "HM62256B: КМОП, входы TTL (0,8 / 2,2 В), питание 4,5–5,5 В, 6 мА; DIP-28 на 300 мил (HM62256BLSP), на плате под SMD — SOP-28 на 450 мил (HM62256BLFP)", def: sramDef, model: SRAM_MODEL },
  { id: EEPROM_ID, kind: "eeprom", words: 32768, width: 8, opener: "rom8", label: "EEPROM AT28C256", addrPins: ADDR28, selectPin: 20, blank: EEPROM_BLANK, source: "AT28C256: КМОП, входы TTL (0,8 / 2,0 В), питание 4,5–5,5 В, до 50 мА, цикл записи до 10 мс; DIP-28 на 600 мил, на плате под SMD — SOIC-28 на 300 мил", def: eepromDef, model: EEPROM_MODEL },
];
export const memoryInfo = (id: string | undefined): MemoryInfo | undefined => MEMORIES.find((m) => m.id === id);
export const isMemory = (id: string | undefined): boolean => !!memoryInfo(id);
/** Посадочное место микросхемы на плате под SMD, если у неё своё (SOP-28 у HM62256B). */
export const smdFootprintOf = (id: string | undefined): Footprint | undefined => memoryInfo(id)?.smdFp;
/** Слово памяти с прошивкой (ПЗУ, EEPROM) по адресу: нет — чистое. */
export const memWord = (info: MemoryInfo, data: number[] | undefined, addr: number) => (data?.[addr] ?? info.blank) & ((1 << info.width) - 1);

/** Модель микросхемы памяти или undefined — если это не она. */
export function memoryModel(def: ChipDef): ChipModel | undefined {
  return memoryInfo(def.id)?.model;
}

/** Все микросхемы памяти — для списка заводских. */
export const memoryChips = (): ChipDef[] => MEMORIES.map((m) => m.def());

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
