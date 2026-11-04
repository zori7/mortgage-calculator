import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3001),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    console.error("Invalid environment. Did you run `scripts/dev-env.sh <slot>`?");
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}
