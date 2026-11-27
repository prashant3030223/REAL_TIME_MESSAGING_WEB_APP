import fs from "node:fs";
import path from "node:path";

const src = path.resolve("apps/api/src/db/migrations");
const dest = path.resolve("apps/api/dist/db/migrations");

if (fs.existsSync(src)) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}
