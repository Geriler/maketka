/**
 * Медь платы: дорожки и площадки, которые касаются друг друга, соединены — как на настоящей плате.
 * Дорожка, проведённая поперёк чужой, или задевшая чужую площадку, замыкает цепи; чтобы перейти через
 * дорожку, нужна перемычка (провод в изоляции над платой) или, на двусторонней плате, другая сторона.
 * Медь касается только меди своей стороны; SMD-площадка — только сверху, отверстие — с обеих.
 */

import { HOLE_BY_ID, boardsVersion, fineTrace, padOnSide, type Hole } from "./breadboard";
import { FINE_TRACE_WIDTH_MM, TRACE_WIDTH_MM, type Scene, type Trace } from "./types";
import { endpointNode } from "../sim/nodes";

/** Площадка без размеров (печатная плата, площадки для проводов у края) — круглая, радиус в шагах. */
const ROUND_PAD_R = 0.35;

/** Касание меди: дорожка с дорожкой или дорожка с чужой площадкой. */
export interface CopperContact {
  /** Дорожка, которая задевает. */
  trace: string;
  /** Что задето: другая дорожка или площадка (отверстие). */
  other: { trace: string } | { hole: string };
  /** Узлы, которые оказались соединены. */
  a: string;
  b: string;
}

type P = [number, number];

function pointSeg(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = dx * dx + dz * dz;
  const u = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len)) : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dz);
}

function segSeg(a: P, b: P, c: P, d: P): number {
  const o = (p: P, q: P, r: P) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return 0;
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

/** Расстояние от отрезка до площадки (0 — задевает), в шагах. */
function segPad(a: P, b: P, h: Hole): number {
  if (!h.w || !h.d || h.round) return Math.max(0, pointSeg([h.x, h.z], a, b) - (h.w ? h.w / 2 : ROUND_PAD_R));
  const hw = h.w / 2, hd = h.d / 2;
  const inside = (p: P) => Math.abs(p[0] - h.x) <= hw && Math.abs(p[1] - h.z) <= hd;
  if (inside(a) || inside(b)) return 0;
  const c: P[] = [[h.x - hw, h.z - hd], [h.x + hw, h.z - hd], [h.x + hw, h.z + hd], [h.x - hw, h.z + hd]];
  return Math.min(...c.map((p, i) => segSeg(a, b, p, c[(i + 1) % 4])));
}

/** Сторона дорожки. */
export const traceSide = (t: Trace): "top" | "bottom" => t.side ?? "top";

/**
 * Узлы концов дорожки. Конец на площадке, до которой медь этой стороны не достаёт (нижняя дорожка
 * к SMD-площадке сверху), ни с чем не соединён — у него свой узел.
 */
export function traceNodes(t: Trace): [string, string] {
  const end = (id: string) => {
    const h = HOLE_BY_ID.get(id)!;
    return padOnSide(h, traceSide(t)) ? h.node : `${h.node}~${t.id}`;
  };
  return [end(t.a), end(t.b)];
}

/** Полуширина дорожки, в шагах. */
const halfWidth = (holeId: string) => (fineTrace(holeId) ? FINE_TRACE_WIDTH_MM : TRACE_WIDTH_MM) / 2.54 / 2;

/**
 * Где медь касается чужой меди. Дорожки с общим концом и площадки на концах самой дорожки —
 * не касание, а обычное соединение. Считается по отверстиям, уже расставленным applyBoards.
 */
export function copperContacts(traces: readonly Trace[]): CopperContact[] {
  // Расчёт зовёт это на каждом шаге, а дорожки между шагами не меняются
  const key = `${boardsVersion()}|${traces.map((t) => `${t.id}:${t.a}:${t.b}${t.side === "bottom" ? "_" : ""}${t.fault?.open ? "!" : ""}`).join(",")}`;
  if (cached?.key === key) return cached.value;
  const value = computeContacts(traces);
  cached = { key, value };
  return value;
}
let cached: { key: string; value: CopperContact[] } | undefined;

function computeContacts(traces: readonly Trace[]): CopperContact[] {
  const segs = traces.flatMap((t) => {
    const a = HOLE_BY_ID.get(t.a), b = HOLE_BY_ID.get(t.b);
    if (!a || !b || t.fault?.open || a.boardId !== b.boardId) return [];
    return [{ t, a, b, pa: [a.x, a.z] as P, pb: [b.x, b.z] as P, r: halfWidth(t.a), board: a.boardId, side: traceSide(t), node: traceNodes(t)[0] }];
  });
  const out: CopperContact[] = [];
  // Дорожка с дорожкой
  for (let i = 0; i < segs.length; i++)
    for (let k = i + 1; k < segs.length; k++) {
      const s = segs[i], o = segs[k];
      if (s.board !== o.board || s.side !== o.side) continue;
      if ([s.a.id, s.b.id].some((h) => h === o.a.id || h === o.b.id)) continue;
      if (segSeg(s.pa, s.pb, o.pa, o.pb) < s.r + o.r - 1e-6) out.push({ trace: s.t.id, other: { trace: o.t.id }, a: s.node, b: o.node });
    }
  // Дорожка с площадкой, которая не её конец
  const pads = [...HOLE_BY_ID.values()].filter((h) => h.kind === "pad");
  for (const s of segs)
    for (const h of pads) {
      if (h.boardId !== s.board || h.id === s.a.id || h.id === s.b.id || !padOnSide(h, s.side)) continue;
      // Быстро отсеять далёкие
      if (Math.max(h.x - Math.max(s.pa[0], s.pb[0]), Math.min(s.pa[0], s.pb[0]) - h.x, h.z - Math.max(s.pa[1], s.pb[1]), Math.min(s.pa[1], s.pb[1]) - h.z) > 1) continue;
      if (segPad(s.pa, s.pb, h) < s.r - 1e-6) out.push({ trace: s.t.id, other: { hole: h.id }, a: s.node, b: h.node });
    }
  return out;
}

/**
 * Касания, которые замыкают разные цепи: узлы касания не соединены и без него — ни дорожками,
 * ни проводами. Касание своей же меди (узел поворота на своей площадке, дорожка упёрлась в свою
 * дорожку) ничего не меняет.
 */
export function foreignContacts(scene: Scene): CopperContact[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const w of scene.wires) {
    if (w.fault?.open) continue;
    try {
      parent.set(find(endpointNode(scene, w.a)), find(endpointNode(scene, w.b)));
    } catch {
      /* провод к детали, которой нет, — не соединяет */
    }
  }
  for (const t of scene.traces ?? []) {
    if (!HOLE_BY_ID.has(t.a) || !HOLE_BY_ID.has(t.b) || t.fault?.open) continue;
    const [a, b] = traceNodes(t);
    parent.set(find(a), find(b));
  }
  return copperContacts(scene.traces ?? []).filter((k) => find(k.a) !== find(k.b));
}
