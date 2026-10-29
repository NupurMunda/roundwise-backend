import { createApp } from './app';
import { workersRateLimiter, type RateLimitBinding } from './rate-limit';
import { d1Store, type D1Like } from './store/d1';

interface Env {
  DB: D1Like;
  RATE_LIMITER: RateLimitBinding;
  ALLOWED_ORIGIN?: string;
  API_KEY?: string;
}

let app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(request: Request, env: Env, ctx: unknown) {
    app ??= createApp(d1Store(env.DB), {
      allowedOrigin: env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
      apiKey: env.API_KEY,
      rateLimiter: workersRateLimiter(env.RATE_LIMITER),
      clientIp: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
    });
    return app.fetch(request, env, ctx as never);
  },
};
