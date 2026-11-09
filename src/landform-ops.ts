/** Binary min-heap keyed by a number, carrying an integer payload. */
class MinHeap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;
  topKey = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(key: number, val: number) {
    const { keys, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Removes the smallest entry, returns its payload and leaves its key in `topKey`. */
  pop(): number {
    const { keys, vals } = this;
    const result = vals[0];
    this.topKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        vals[i] = vals[child];
        i = child;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return result;
  }
}

/**
 * Fills every depression in the raster up to the level at which water would spill out of it
 * (priority-flood, Barnes et al. 2014). Water can leave through the raster border or through
 * `NaN` pixels. Returns the filled surface, so `filled - data` is the depth of each depression.
 */
export function priorityFlood(
  data: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const n = width * height;
  const filled = new Float32Array(data);
  const visited = new Uint8Array(n);
  const heap = new MinHeap(n);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const idx = j * width + i;
      const border = i === 0 || j === 0 || i === width - 1 || j === height - 1;
      if (isNaN(data[idx])) {
        visited[idx] = 1;
        heap.push(-Infinity, idx);
      } else if (border) {
        visited[idx] = 1;
        heap.push(data[idx], idx);
      }
    }
  }
  while (heap.size > 0) {
    const idx = heap.pop();
    const level = heap.topKey;
    const i = idx % width;
    const j = (idx - i) / width;
    for (let dj = -1; dj <= 1; dj++) {
      const nj = j + dj;
      if (nj < 0 || nj >= height) continue;
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        if (ni < 0 || ni >= width || (di === 0 && dj === 0)) continue;
        const nidx = nj * width + ni;
        if (visited[nidx]) continue;
        visited[nidx] = 1;
        const v = data[nidx];
        const f = v > level ? v : level;
        filled[nidx] = f;
        heap.push(f, nidx);
      }
    }
  }
  return filled;
}

/** Labels 8-connected groups of set pixels with 1..count. */
export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = count;
    while (sp > 0) {
      const idx = stack[--sp];
      const i = idx % width;
      const j = (idx - i) / width;
      for (let dj = -1; dj <= 1; dj++) {
        const nj = j + dj;
        if (nj < 0 || nj >= height) continue;
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          if (ni < 0 || ni >= width) continue;
          const nidx = nj * width + ni;
          if (mask[nidx] && !labels[nidx]) {
            labels[nidx] = count;
            stack[sp++] = nidx;
          }
        }
      }
    }
  }
  return { labels, count };
}

/** Zhang-Suen thinning: reduces blobs to one-pixel wide skeletons. Pixels on the raster border are cleared. */
export function thin(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const img = Uint8Array.from(mask);
  for (let i = 0; i < width; i++) {
    img[i] = 0;
    img[(height - 1) * width + i] = 0;
  }
  for (let j = 0; j < height; j++) {
    img[j * width] = 0;
    img[j * width + width - 1] = 0;
  }
  const remove: number[] = [];
  let changed = true;
  for (let iteration = 0; changed && iteration < 200; iteration++) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      remove.length = 0;
      for (let j = 1; j < height - 1; j++) {
        for (let i = 1; i < width - 1; i++) {
          const idx = j * width + i;
          if (!img[idx]) continue;
          const p2 = img[idx - width];
          const p3 = img[idx - width + 1];
          const p4 = img[idx + 1];
          const p5 = img[idx + width + 1];
          const p6 = img[idx + width];
          const p7 = img[idx + width - 1];
          const p8 = img[idx - 1];
          const p9 = img[idx - width - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          let a = 0;
          if (!p2 && p3) a++;
          if (!p3 && p4) a++;
          if (!p4 && p5) a++;
          if (!p5 && p6) a++;
          if (!p6 && p7) a++;
          if (!p7 && p8) a++;
          if (!p8 && p9) a++;
          if (!p9 && p2) a++;
          if (a !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          remove.push(idx);
        }
      }
      for (const idx of remove) img[idx] = 0;
      if (remove.length > 0) changed = true;
    }
  }
  return img;
}

/**
 * Walks a one-pixel skeleton and returns its branches as flat `[i0, j0, i1, j1, ...]` pixel
 * coordinates. Short side branches (`spurLength` pixels or fewer) that end in a free tip are
 * dropped, and branches that meet at a node with nothing else attached are joined.
 */
export function traceSkeleton(
  skeleton: Uint8Array,
  width: number,
  height: number,
  spurLength: number,
): number[][] {
  const n = width * height;
  const neighborsOf = (idx: number): number[] => {
    const out: number[] = [];
    const i = idx % width;
    const j = (idx - i) / width;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
        const nidx = nj * width + ni;
        if (skeleton[nidx]) out.push(nidx);
      }
    }
    return out;
  };

  const degree = new Uint8Array(n);
  for (let idx = 0; idx < n; idx++) {
    if (skeleton[idx]) degree[idx] = neighborsOf(idx).length;
  }

  const usedEdges = new Set<number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const walk = (start: number, first: number): number[] => {
    const path = [start, first];
    usedEdges.add(edgeKey(start, first));
    let prev = start;
    let cur = first;
    while (degree[cur] === 2) {
      const nb = neighborsOf(cur);
      const next = nb[0] === prev ? nb[1] : nb[0];
      if (next === undefined || usedEdges.has(edgeKey(cur, next))) break;
      usedEdges.add(edgeKey(cur, next));
      path.push(next);
      prev = cur;
      cur = next;
    }
    return path;
  };

  let paths: (number[] | null)[] = [];
  const onPath = new Uint8Array(n);
  for (let idx = 0; idx < n; idx++) {
    if (!skeleton[idx] || degree[idx] === 2) continue;
    for (const nidx of neighborsOf(idx)) {
      if (usedEdges.has(edgeKey(idx, nidx))) continue;
      const path = walk(idx, nidx);
      for (const p of path) onPath[p] = 1;
      paths.push(path);
    }
  }
  // closed loops that have no node on them
  for (let idx = 0; idx < n; idx++) {
    if (!skeleton[idx] || onPath[idx] || degree[idx] !== 2) continue;
    const path = walk(idx, neighborsOf(idx)[0]);
    path.push(idx);
    for (const p of path) onPath[p] = 1;
    paths.push(path);
  }

  // drop short spurs that end in a free tip and attach to a junction
  if (spurLength > 0) {
    paths = paths.map((path) => {
      if (!path) return path;
      const a = degree[path[0]];
      const b = degree[path[path.length - 1]];
      const spur = (a === 1 && b >= 3) || (b === 1 && a >= 3);
      return spur && path.length - 1 <= spurLength ? null : path;
    });
  }

  // join branches that are the only two meeting at a node
  const ends = new Map<number, number[]>();
  const addEnd = (node: number, pi: number) => {
    const list = ends.get(node);
    if (list) list.push(pi);
    else ends.set(node, [pi]);
  };
  paths.forEach((path, pi) => {
    if (!path) return;
    addEnd(path[0], pi);
    addEnd(path[path.length - 1], pi);
  });
  for (const [node, list] of ends) {
    if (list.length !== 2 || list[0] === list[1]) continue;
    const [a, b] = list;
    const first = paths[a] as number[];
    const second = paths[b] as number[];
    if (first[0] === node) first.reverse();
    if (second[second.length - 1] === node) second.reverse();
    const farEnd = second[second.length - 1];
    paths[a] = first.concat(second.slice(1));
    paths[b] = null;
    // whatever was attached to the far end of the second branch is now attached to the joined one
    const farList = ends.get(farEnd);
    if (farList) {
      for (let k = 0; k < farList.length; k++) {
        if (farList[k] === b) farList[k] = a;
      }
    }
  }

  const result: number[][] = [];
  for (const path of paths) {
    if (!path || path.length < 2) continue;
    const flat: number[] = [];
    for (const idx of path) {
      const i = idx % width;
      flat.push(i, (idx - i) / width);
    }
    result.push(flat);
  }
  return result;
}

/** Three-point moving average of a flat polyline, keeping the end points fixed. */
export function smoothPath(points: number[], passes: number): number[] {
  let current = points;
  const count = points.length / 2;
  if (count < 3) return points.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let k = 1; k < count - 1; k++) {
      next[2 * k] =
        (current[2 * k - 2] + current[2 * k] + current[2 * k + 2]) / 3;
      next[2 * k + 1] =
        (current[2 * k - 1] + current[2 * k + 1] + current[2 * k + 3]) / 3;
    }
    current = next;
  }
  return current;
}

/** Douglas-Peucker simplification of a flat polyline. */
export function simplifyPath(points: number[], tolerance: number): number[] {
  const count = points.length / 2;
  if (count < 3 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const ax = points[2 * first];
    const ay = points[2 * first + 1];
    const dx = points[2 * last] - ax;
    const dy = points[2 * last + 1] - ay;
    const len = Math.hypot(dx, dy);
    let maxDist = 0;
    let maxIdx = -1;
    for (let k = first + 1; k < last; k++) {
      const px = points[2 * k] - ax;
      const py = points[2 * k + 1] - ay;
      const dist =
        len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = k;
      }
    }
    if (maxIdx >= 0 && maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([first, maxIdx], [maxIdx, last]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    if (keep[k]) out.push(points[2 * k], points[2 * k + 1]);
  }
  return out;
}

/** Length of a flat polyline. */
export function pathLength(points: number[]): number {
  let total = 0;
  for (let k = 2; k < points.length; k += 2) {
    total += Math.hypot(
      points[k] - points[k - 2],
      points[k + 1] - points[k - 1],
    );
  }
  return total;
}

/** Shoelace area of a flat ring (positive when clockwise on screen, with y pointing down). */
export function signedArea(ring: number[]): number {
  let sum = 0;
  const count = ring.length / 2;
  for (let k = 0; k < count; k++) {
    const l = (k + 1) % count;
    sum += ring[2 * k] * ring[2 * l + 1] - ring[2 * l] * ring[2 * k + 1];
  }
  return sum / 2;
}

/** Ray-casting point in ring test. */
export function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let k = 0, l = count - 1; k < count; l = k++) {
    const xk = ring[2 * k];
    const yk = ring[2 * k + 1];
    const xl = ring[2 * l];
    const yl = ring[2 * l + 1];
    if (yk > y !== yl > y && x < ((xl - xk) * (y - yk)) / (yl - yk) + xk) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Clips a flat polyline to a rectangle, interpolating new vertices where it crosses the edge.
 * A line that leaves and re-enters the rectangle becomes several pieces.
 */
export function clipPolyline(
  points: number[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[][] {
  const pieces: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 4) pieces.push(current);
    current = [];
  };
  for (let k = 0; k + 3 < points.length; k += 2) {
    const x0 = points[k];
    const y0 = points[k + 1];
    const dx = points[k + 2] - x0;
    const dy = points[k + 3] - y0;
    // Liang-Barsky
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
    for (let e = 0; e < 4 && inside; e++) {
      if (p[e] === 0) {
        if (q[e] < 0) inside = false;
      } else {
        const r = q[e] / p[e];
        if (p[e] < 0) {
          if (r > t1) inside = false;
          else if (r > t0) t0 = r;
        } else if (r < t0) {
          inside = false;
        } else if (r < t1) {
          t1 = r;
        }
      }
    }
    if (!inside) {
      flush();
      continue;
    }
    if (current.length === 0 || t0 > 0) {
      flush();
      current.push(x0 + dx * t0, y0 + dy * t0);
    }
    current.push(x0 + dx * t1, y0 + dy * t1);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
