export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; retryAfter: number }>;
}

export function memoryRateLimiter(limit = 60, windowMs = 60_000, now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    async check(key) {
      const t = now();
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      const entry = hits.get(key) ?? { count: 0, resetAt: t + windowMs };
      entry.count += 1;
      hits.set(key, entry);
      return { allowed: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) };
    },
  };
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function workersRateLimiter(binding: RateLimitBinding, periodSeconds = 60): RateLimiter {
  return {
    async check(key) {
      const { success } = await binding.limit({ key });
      return { allowed: success, retryAfter: periodSeconds };
    },
  };
}
