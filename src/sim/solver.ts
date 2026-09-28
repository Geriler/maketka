/**
 * Решатель цепей постоянного тока методом узловых потенциалов.
 *
 * Каждый элемент цепи — «ветвь» между узлами a и b: ЭДС `emf` последовательно
 * с сопротивлением `r` (эквивалент Тевенина). Резистор — ветвь с emf = 0,
 * батарея — ветвь с внутренним сопротивлением и emf > 0 (плюс на стороне b).
 * В матрицу ветвь входит как эквивалент Нортона: проводимость 1/r
 * параллельно с источником тока emf/r, втекающим в узел b.
 *
 * Идеальные соединения (контакты макетки, выводы в одном отверстии) задаются
 * списком `links` и сливаются в один узел заранее (union-find), поэтому
 * в матрице нет нулевых сопротивлений.
 *
 * Идеальных источников напряжения нет, поэтому короткое замыкание
 * не делает систему вырожденной — через батарею просто течёт emf/r.
 * Опорный узел выбирается в каждой связной части цепи отдельно, так что
 * «висящие» куски цепи тоже не ломают расчёт.
 */

export interface Branch {
  id: string;
  a: string;
  b: string;
  /** Сопротивление, Ом. Infinity — ветвь разомкнута (выключатель, сгоревший элемент). */
  r: number;
  /** ЭДС, В. Положительная ЭДС поднимает потенциал от a к b. */
  emf?: number;
}

/**
 * Дополнительные элементы, не сводящиеся к ветви «ЭДС + сопротивление».
 * Нужны для транзистора: его ток коллектора управляется напряжением база–эмиттер.
 */
export interface Extras {
  /** Источник постоянного тока J, А: вытекает из узла a, втекает в узел b. */
  currents?: { a: string; b: string; j: number }[];
  /** Ток g·(V(cp) − V(cn)), А: вытекает из узла a, втекает в узел b (источник тока, управляемый напряжением). */
  vccs?: { a: string; b: string; cp: string; cn: string; g: number }[];
}

export interface BranchResult {
  /** Ток через ветвь от a к b, А. */
  current: number;
  /** Напряжение Vb − Va на выводах, В. */
  voltage: number;
  /** Мощность, выделяемая на сопротивлении ветви, Вт. */
  power: number;
}

export interface Solution {
  /** Узел после слияния для каждого исходного имени узла. */
  nodeOf: ReadonlyMap<string, string>;
  /** Потенциал каждого исходного узла относительно опорного узла его части цепи, В. */
  voltage: ReadonlyMap<string, number>;
  branches: ReadonlyMap<string, BranchResult>;
  /** Все потенциалы — числа (не NaN и не бесконечность). */
  finite?: boolean;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }

  union(x: string, y: string): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx !== ry) this.parent.set(rx, ry);
  }
}

/**
 * Разобранное устройство цепи: какие узлы слиты, какой узел в какой строке матрицы. Между итерациями
 * Ньютона меняются только сопротивления и ЭДС ветвей, а устройство — нет, поэтому разбор можно
 * переиспользовать: передайте один и тот же объект cache. Он сверяется с ветвями и связями
 * при каждом вызове и сам разбирается заново, если цепь изменилась.
 */
export interface Topology {
  ids: string[];
  as: string[];
  bs: string[];
  active: boolean[];
  links: [string, string][];
  /** Строки матрицы концов ветвей (−1 — опорный узел или ветвь не в цепи). */
  ai: Int32Array;
  bi: Int32Array;
  /** Имя узла → строка матрицы (−1 — опорный узел). */
  row: Map<string, number>;
  /** Имя узла → узел после слияния. */
  root: Map<string, string>;
  /** Обозначение ветви → её номер. */
  pos: Map<string, number>;
  size: number;
  /** Порядок исключения для разреженного решения (считается по структуре, см. symbolic). */
  sym?: Symbolic;
  /** Матрица и правая часть: переиспользуются между итерациями, чтобы не выделять память каждый раз. */
  G?: Float64Array[];
  I?: Float64Array;
}

/**
 * Разреженное исключение: порядок строк (минимальная степень, как в SPICE) и соседи каждой строки
 * к моменту её исключения — с учётом заполнения. Числа на итерациях меняются, структура — нет.
 */
interface Symbolic {
  /** Структура управляемых источников, по которой посчитан порядок. */
  key: number;
  order: Int32Array;
  /** Соседи строки p, исключаемые позже неё (включая заполнение). */
  later: Int32Array[];
}

/** Порядок минимальной степени по симметричной структуре матрицы. */
function symbolic(size: number, pairs: [number, number][], key: number): Symbolic {
  const adj = Array.from({ length: size }, () => new Set<number>());
  for (const [i, j] of pairs) {
    if (i < 0 || j < 0 || i === j) continue;
    adj[i].add(j);
    adj[j].add(i);
  }
  const done = new Uint8Array(size);
  const order = new Int32Array(size);
  const later: Int32Array[] = new Array(size);
  for (let k = 0; k < size; k++) {
    let best = -1;
    for (let i = 0; i < size; i++) if (!done[i] && (best < 0 || adj[i].size < adj[best].size)) best = i;
    const nb = [...adj[best]];
    order[k] = best;
    later[best] = Int32Array.from(nb);
    done[best] = 1;
    // Исключение строки связывает всех её соседей между собой (заполнение)
    for (const a of nb) {
      adj[a].delete(best);
      for (const b of nb) if (a !== b) adj[a].add(b);
    }
  }
  return { key, order, later };
}

function sameTopology(t: Topology, branches: Branch[], links: [string, string][]): boolean {
  if (t.ids.length !== branches.length || t.links.length !== links.length) return false;
  for (let i = 0; i < branches.length; i++) {
    const br = branches[i];
    if (t.ids[i] !== br.id || t.as[i] !== br.a || t.bs[i] !== br.b || t.active[i] !== Number.isFinite(br.r)) return false;
  }
  for (let i = 0; i < links.length; i++) if (t.links[i][0] !== links[i][0] || t.links[i][1] !== links[i][1]) return false;
  return true;
}

function topology(branches: Branch[], links: [string, string][]): Topology {
  const uf = new UnionFind();
  for (const [x, y] of links) uf.union(x, y);
  for (const br of branches) {
    uf.find(br.a);
    uf.find(br.b);
  }

  const active = branches.filter((br) => Number.isFinite(br.r));

  // Связные части цепи по активным ветвям (узлы уже слиты по links).
  const adjacency = new Map<string, string[]>();
  const touch = (n: string) => {
    if (!adjacency.has(n)) adjacency.set(n, []);
    return adjacency.get(n)!;
  };
  for (const br of active) {
    const a = uf.find(br.a);
    const b = uf.find(br.b);
    touch(a).push(b);
    touch(b).push(a);
  }

  // Опорный узел части: минус первой батареи, иначе первый встреченный узел.
  const preferredRef = new Set<string>();
  for (const br of active) if (br.emf) preferredRef.add(uf.find(br.a));

  const index = new Map<string, number>(); // узел → строка матрицы; опорные узлы не входят
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      component.push(n);
      for (const m of adjacency.get(n)!) {
        if (!visited.has(m)) {
          visited.add(m);
          stack.push(m);
        }
      }
    }
    const ref = component.find((n) => preferredRef.has(n)) ?? component[0];
    for (const n of component) if (n !== ref) index.set(n, index.size);
  }

  const row = new Map<string, number>();
  const root = new Map<string, string>();
  const name = (n: string) => {
    if (!row.has(n)) {
      const r = uf.find(n);
      root.set(n, r);
      row.set(n, index.get(r) ?? -1);
    }
    return row.get(n)!;
  };
  const ai = new Int32Array(branches.length);
  const bi = new Int32Array(branches.length);
  const pos = new Map<string, number>();
  branches.forEach((br, i) => {
    const on = Number.isFinite(br.r);
    ai[i] = on ? name(br.a) : (name(br.a), -1);
    bi[i] = on ? name(br.b) : (name(br.b), -1);
    pos.set(br.id, i);
  });
  for (const [p, q] of links) {
    name(p);
    name(q);
  }
  return {
    ids: branches.map((b) => b.id),
    as: branches.map((b) => b.a),
    bs: branches.map((b) => b.b),
    active: branches.map((b) => Number.isFinite(b.r)),
    links: links.map(([p, q]) => [p, q]),
    ai,
    bi,
    row,
    root,
    pos,
    size: index.size,
  };
}

/** Словарь только для чтения, который считает значения по запросу. */
class LazyMap<V> implements ReadonlyMap<string, V> {
  constructor(
    private keysOf: () => Iterable<string>,
    private has_: (k: string) => boolean,
    private value: (k: string) => V,
  ) {}
  get(k: string): V | undefined {
    return this.has_(k) ? this.value(k) : undefined;
  }
  has(k: string): boolean {
    return this.has_(k);
  }
  get size(): number {
    return [...this.keysOf()].length;
  }
  *keys(): MapIterator<string> {
    yield* this.keysOf();
  }
  *values(): MapIterator<V> {
    for (const k of this.keysOf()) yield this.value(k);
  }
  *entries(): MapIterator<[string, V]> {
    for (const k of this.keysOf()) yield [k, this.value(k)];
  }
  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries();
  }
  forEach(f: (v: V, k: string, m: ReadonlyMap<string, V>) => void): void {
    for (const k of this.keysOf()) f(this.value(k), k, this);
  }
}

export function solveCircuit(branches: Branch[], links: [string, string][] = [], extras: Extras = {}, cache?: { topology?: Topology }): Solution {
  for (const br of branches) {
    if (!(br.r > 0)) throw new Error(`Ветвь ${br.id}: сопротивление должно быть > 0`);
  }
  let t = cache?.topology;
  if (!t || !sameTopology(t, branches, links)) {
    t = topology(branches, links);
    if (cache) cache.topology = t;
  }

  const size = t.size;
  if (!t.G) {
    t.G = Array.from({ length: size }, () => new Float64Array(size));
    t.I = new Float64Array(size);
  }
  const G = t.G;
  const I = t.I!;
  const tt = t;
  const idx = (n: string) => tt.row.get(n) ?? -1;
  // Узлы управляемых источников — один раз: они нужны и для сборки, и для структуры
  const vccsAt = (extras.vccs ?? []).map((v) => [idx(v.a), idx(v.b), idx(v.cp), idx(v.cn), v.g]);
  const assemble = () => {
  for (const r of G) r.fill(0);
  I.fill(0);
  for (let i = 0; i < branches.length; i++) {
    const br = branches[i];
    if (!t.active[i]) continue;
    const a = t.ai[i];
    const b = t.bi[i];
    const g = 1 / br.r;
    const src = (br.emf ?? 0) * g; // ток источника Нортона, втекает в b
    if (a >= 0) {
      G[a][a] += g;
      I[a] -= src;
    }
    if (b >= 0) {
      G[b][b] += g;
      I[b] += src;
    }
    if (a >= 0 && b >= 0) {
      G[a][b] -= g;
      G[b][a] -= g;
    }
  }

  // Узлы, которые связаны только через управляемые источники, решателю не видны как связные.
  // Для транзистора это не случается: переходы база–эмиттер и база–коллектор — обычные ветви.
  // Узел, которого нет среди ветвей и связей, — ни в одной строке.
  for (const src of extras.currents ?? []) {
    const a = idx(src.a);
    const b = idx(src.b);
    if (a >= 0) I[a] -= src.j;
    if (b >= 0) I[b] += src.j;
  }
  for (const [a, b, cp, cn, g] of vccsAt) {
    // Уходящий из a ток g·(Vcp − Vcn) — в левую часть уравнения узла a, с обратным знаком для b
    if (a >= 0) {
      if (cp >= 0) G[a][cp] += g;
      if (cn >= 0) G[a][cn] -= g;
    }
    if (b >= 0) {
      if (cp >= 0) G[b][cp] -= g;
      if (cn >= 0) G[b][cn] += g;
    }
  }
  };
  assemble();

  // Разреженное решение по порядку минимальной степени; не вышло (почти нулевой ведущий) — плотное
  // Структура управляемых источников — числом (одна и та же на итерациях, меняется редко)
  let key = vccsAt.length;
  for (const v of vccsAt) for (let q = 0; q < 4; q++) key = (Math.imul(key, 31) + v[q] + 1) | 0;
  if (!t.sym || t.sym.key !== key) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < branches.length; i++) if (t.active[i]) pairs.push([t.ai[i], t.bi[i]]);
    for (const [a, b, cp, cn] of vccsAt) for (const r of [a, b]) for (const c of [cp, cn]) pairs.push([r, c]);
    t.sym = symbolic(size, pairs, key);
  }
  // Исключение идёт прямо в G; не вышло — собираем заново и решаем плотным методом
  let x = sparseSolve(G, I, t.sym);
  if (!x) {
    assemble();
    x = gaussianSolve(G, I);
  }
  let finite = true;
  for (let r = 0; r < size; r++) if (!Number.isFinite(x[r])) finite = false;
  const topo = t;
  const at = (r: number) => (r < 0 ? 0 : x[r]);
  const potential = (n: string) => at(topo.row.get(n)!);

  const nodeOf = new LazyMap<string>(() => topo.row.keys(), (k) => topo.row.has(k), (k) => topo.root.get(k)!);
  const voltage = new LazyMap<number>(() => topo.row.keys(), (k) => topo.row.has(k), potential);
  const branchResult = (id: string): BranchResult => {
    const i = topo.pos.get(id)!;
    const br = branches[i];
    const va = potential(br.a);
    const vb = potential(br.b);
    if (!Number.isFinite(br.r)) return { current: 0, voltage: vb - va, power: 0 };
    const current = (va - vb + (br.emf ?? 0)) / br.r;
    return { current, voltage: vb - va, power: current * current * br.r };
  };
  const results = new LazyMap<BranchResult>(() => topo.pos.keys(), (k) => topo.pos.has(k), branchResult);

  return { nodeOf, voltage, branches: results, finite };
}

/** Метод Гаусса с выбором главного элемента по столбцу. Матрица портится. */
/**
 * Исключение в порядке sym без перестановок строк: у матрицы проводимостей диагональ преобладает
 * (управляемые источники транзисторов её не ломают на практике). Если ведущий элемент почти ноль
 * или ответ не число — undefined, и решает плотный метод с выбором ведущего. A и b портятся.
 */
function sparseSolve(A: Float64Array[], b: Float64Array, sym: Symbolic): Float64Array | undefined {
  const n = b.length;
  for (let k = 0; k < n; k++) {
    const p = sym.order[k];
    const ap = A[p];
    const piv = ap[p];
    const nb = sym.later[p];
    let big = Math.abs(piv);
    for (const j of nb) big = Math.max(big, Math.abs(ap[j]));
    if (!(Math.abs(piv) > 1e-9 * big) || big === 0) return undefined;
    for (const i of nb) {
      const ai = A[i];
      const f = ai[p] / piv;
      if (f === 0) continue;
      ai[p] = 0;
      for (const j of nb) ai[j] -= f * ap[j];
      b[i] -= f * b[p];
    }
  }
  const x = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const p = sym.order[k];
    const ap = A[p];
    let s = b[p];
    for (const j of sym.later[p]) s -= ap[j] * x[j];
    x[p] = s / ap[p];
    if (!Number.isFinite(x[p])) return undefined;
  }
  return x;
}

function gaussianSolve(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    }
    if (Math.abs(A[pivot][col]) < 1e-300) {
      // Не должно случаться: каждая часть цепи связна и заземлена.
      throw new Error("Вырожденная матрица проводимостей");
    }
    if (pivot !== col) {
      [A[pivot], A[col]] = [A[col], A[pivot]];
      [b[pivot], b[col]] = [b[col], b[pivot]];
    }
    // Матрица цепи почти вся из нулей: вычитаем только по ненулевым столбцам ведущей строки
    // (вычитание f·0 ничего не меняло — результат тот же, но в разы быстрее)
    const pr = A[col];
    const nz: number[] = [];
    for (let k = col; k < n; k++) if (pr[k] !== 0) nz.push(k);
    for (let row = col + 1; row < n; row++) {
      const ar = A[row];
      const f = ar[col] / pr[col];
      if (f === 0) continue;
      for (const k of nz) ar[k] -= f * pr[k];
      b[row] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let s = b[row];
    for (let k = row + 1; k < n; k++) s -= A[row][k] * x[k];
    x[row] = s / A[row][row];
  }
  return x;
}
