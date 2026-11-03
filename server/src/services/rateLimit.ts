/** Fixed-size sliding window counter kept in memory: enough for one instance, resets on restart. */
export interface RateLimiter {
  /** Records one attempt for `key`; false once the key went over the limit inside the window. */
  hit(key: string): boolean;
}

export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      recent.push(t);
      hits.set(key, recent);
      // Keep the map from growing without bound under a flood of distinct keys.
      if (hits.size > 5000) {
        for (const [k, list] of hits) if (list.every((at) => t - at >= windowMs)) hits.delete(k);
      }
      return recent.length <= max;
    },
  };
}
