import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";

if (process.argv[2] === "--test-declarations") {
  for (const file of readdirSync(dist)) {
    if (file.endsWith(".test.d.ts") || file.endsWith("-jest.d.ts")) {
      rmSync(join(dist, file));
    }
  }
} else {
  rmSync(dist, { recursive: true, force: true });
}
