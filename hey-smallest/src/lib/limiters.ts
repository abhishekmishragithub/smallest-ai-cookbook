import { NARRATE_LIMIT, RATE_WINDOW_MS, TOKEN_LIMIT } from "./http";
import { createRateLimiter } from "./rate-limit";

export const tokenLimiter = createRateLimiter({ limit: TOKEN_LIMIT, windowMs: RATE_WINDOW_MS });
export const narrateLimiter = createRateLimiter({ limit: NARRATE_LIMIT, windowMs: RATE_WINDOW_MS });
