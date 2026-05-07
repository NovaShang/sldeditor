/**
 * Tiny Union-Find (disjoint set) keyed by string. Used to merge `connections`
 * into ConnectivityNode equivalence classes.
 */
export class UnionFind<K> {
  private parent = new Map<K, K>();
  private rank = new Map<K, number>();

  add(k: K): void {
    if (!this.parent.has(k)) {
      this.parent.set(k, k);
      this.rank.set(k, 0);
    }
  }

  find(k: K): K {
    this.add(k);
    let cur = k;
    while (this.parent.get(cur) !== cur) {
      const p = this.parent.get(cur)!;
      const gp = this.parent.get(p)!;
      this.parent.set(cur, gp);
      cur = gp;
    }
    return cur;
  }

  union(a: K, b: K): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const da = this.rank.get(ra)!;
    const db = this.rank.get(rb)!;
    if (da < db) this.parent.set(ra, rb);
    else if (da > db) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, da + 1);
    }
  }

  /** Group all known keys by their representative. Insertion order preserved. */
  groups(): Map<K, K[]> {
    const out = new Map<K, K[]>();
    for (const k of this.parent.keys()) {
      const root = this.find(k);
      const arr = out.get(root);
      if (arr) arr.push(k);
      else out.set(root, [k]);
    }
    return out;
  }
}
