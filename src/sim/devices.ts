/**
 * Физика p-n перехода, общая для диодов, светодиодов, переходов транзисторов и паразитного
 * диода MOSFET: уравнение Шокли, его линеаризация для решателя и приёмы сходимости Ньютона.
 */

import { LED_N, ZENER_TEST_A, diodeSpec, ledSpec, zenerSpec, type Component } from "../model/types";
import * as tolerance from "./tolerance";
import { NO_TOLERANCE, type Tolerance } from "./tolerance";

/** Тепловой потенциал kT/q при ~27 °C, В. */
export const VT = 0.02585;

export interface DiodeParams {
  is: number;
  n: number;
  rs: number;
  /**
   * Обратный пробой (стабилитрон): при напряжении перехода −bv течёт обратный ток ibv, дальше
   * он растёт экспоненциально с крутизной nbv·VT: I = −ibv·exp((−v − bv)/(nbv·VT)).
   */
  bv?: number;
  ibv?: number;
  nbv?: number;
}

/** «0,125 Вт», «20 мА», «6,3 В» — предел для подписи в панели. */
export function formatLimit(v: number, unit: string): string {
  if (v < 1 && unit === "А") return `${Math.round(v * 1000)} мА`;
  return `${String(v).replace(".", ",")} ${unit}`;
}

/** Параметры диода или светодиода для уравнения Шокли. */
export function diodeParams(c: Component, tol: Tolerance = NO_TOLERANCE): DiodeParams {
  if (c.type === "diode") {
    const d = diodeSpec(c);
    const z = zenerSpec(c);
    if (!z) return { is: tolerance.diodeIs(c, tol), n: d.n, rs: d.rs };
    // Пробой подобран так, чтобы при 5 мА на выводах было Vz, а наклон был Zz (с учётом Rs)
    const vz = tolerance.zenerVz(c, tol);
    return { is: tolerance.diodeIs(c, tol), n: d.n, rs: d.rs, bv: vz - ZENER_TEST_A * d.rs, ibv: ZENER_TEST_A, nbv: ((z.zz - d.rs) * ZENER_TEST_A) / VT };
  }
  if (c.type === "led") {
    // Is подбирается так, чтобы при номинальном токе на выводах было vf (с учётом падения на Rs).
    const s = ledSpec(c);
    const vj = tolerance.ledVf(c, tol) + s.vfAdd - s.ratedA * s.rs;
    return { is: s.ratedA / Math.exp(vj / (LED_N * VT)), n: LED_N, rs: s.rs };
  }
  throw new Error(`${c.id} — не диод`);
}

/** Ток через p-n переход при напряжении vj, А (с обратным пробоем, если он задан). */
export function shockley(p: DiodeParams, vj: number): number {
  return p.is * (Math.exp(vj / (p.n * VT)) - 1) - breakdown(p, vj);
}

/** Обратный ток пробоя при напряжении перехода vj, А (положительный — от катода к аноду). */
function breakdown(p: DiodeParams, vj: number): number {
  if (p.bv === undefined) return 0;
  return p.ibv! * Math.exp(Math.min((-vj - p.bv) / (p.nbv! * VT), 80));
}

/**
 * Ограничение шага напряжения на переходе между итерациями Ньютона (как pnjlim в SPICE):
 * без него экспонента переполняется при первом же большом шаге.
 */
export function limitJunction(vnew: number, vold: number, p: DiodeParams): number {
  // Пробой: то же ограничение, но для w = −v − bv (экспонента растёт в обратную сторону)
  if (p.bv !== undefined && vnew < 0) {
    const nvt = p.nbv! * VT;
    const wnew = -vnew - p.bv, wold = -vold - p.bv;
    const wcrit = nvt * Math.log(nvt / (Math.SQRT2 * p.ibv!));
    if (wnew > wcrit && Math.abs(wnew - wold) > 2 * nvt) {
      const w = wold > 0 ? (1 + (wnew - wold) / nvt > 0 ? wold + nvt * Math.log(1 + (wnew - wold) / nvt) : wcrit) : nvt * Math.log(Math.max(wnew / nvt, 1e-12));
      return -w - p.bv;
    }
    return vnew;
  }
  const nvt = p.n * VT;
  const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * p.is));
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nvt;
      return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(vnew / nvt);
  }
  return vnew;
}

/**
 * Если Ньютон за 20 итераций не сошёлся, он обычно ходит по кругу между «переход заперт» и
 * «переход открыт» (например, светодиод на почти неподключённом стоке закрытого MOSFET).
 * Тогда берём только половину шага — качели гаснут.
 */
export function damp(vnew: number, vold: number, iter: number): number {
  // Каждые следующие 20 итераций — шаг ещё вдвое короче: у каскадов с большим усилением
  // (ОУ без обратной связи, с висящими входами) половины шага не хватает
  return iter > 20 ? vold + (vnew - vold) / 2 ** Math.floor((iter - 1) / 20) : vnew;
}

/**
 * Сошёлся ли переход: напряжение почти не меняется или (как в SPICE) почти не меняется ток.
 * Второе нужно для перехода на «висящем» узле (светодиод последовательно с разомкнутым
 * тумблером): ток там — пикоамперы, и напряжение дрожит в пределах точности вычислений.
 * Ток сравнивается с тем, к которому стремится решение (target — до ограничения шага):
 * иначе запертый в начале расчёта светодиод «сошёлся» бы, не успев открыться.
 */
export function junctionSettled(p: DiodeParams, vold: number, vnew: number, target: number): boolean {
  if (Math.abs(vnew - vold) <= 1e-7) return true;
  const i = (v: number) => p.is * (Math.exp(Math.min(v, 5) / (p.n * VT)) - 1) - breakdown(p, v);
  const io = i(vold);
  const inew = i(target);
  return Math.abs(inew - io) <= 1e-9 + 1e-6 * Math.max(Math.abs(io), Math.abs(inew));
}

/** Малая проводимость параллельно переходу: помогает сходимости, на результат не влияет (1 нА на 1 кВ). */
export const GMIN = 1e-12;

/**
 * Линеаризация диода в точке vj: ветвь «ЭДС + сопротивление», которую понимает решатель.
 * Переход заменяется касательной I ≈ Id + Gd·(v − vj), последовательно с Rs.
 */
export function diodeBranch(p: DiodeParams, vj: number): { r: number; emf: number } {
  const e = Math.exp(vj / (p.n * VT));
  // Ток утечки GMIN·vj входит и в ток, и в наклон: касательная к I(v) = Is·(e^v/nVt − 1) + GMIN·v.
  // Если учесть GMIN только в наклоне, узел, который держится на одном запертом диоде
  // (светодиод последовательно с разомкнутым тумблером), уходит на итерациях вразнос.
  // Пробой стабилитрона: ток −ibv·e^((−v−bv)/nbv·VT) и его наклон в ту же касательную
  const br = breakdown(p, vj);
  const id = p.is * (e - 1) + GMIN * vj - br;
  const gd = (p.is / (p.n * VT)) * e + GMIN + (p.bv !== undefined ? br / (p.nbv! * VT) : 0);
  return { r: 1 / gd + p.rs, emf: id / gd - vj };
}
