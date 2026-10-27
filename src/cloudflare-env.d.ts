import type { Bindings } from "./config/env";

// Types `import { env } from "cloudflare:workers"` (used by the test setup) with our bindings.
declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
