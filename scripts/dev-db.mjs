// Local development Postgres without Docker.
// Starts an embedded PostgreSQL server in ./.dev-db and keeps it running until Ctrl+C.
// For production or Docker users, see docker-compose.yml instead.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", ".dev-db");
const port = Number(process.env.DEV_DB_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "veyra",
  password: "veyra",
  port,
  persistent: true,
  onLog: () => {},
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) {
  console.log(`Initialising new database cluster in ${dataDir}`);
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase("veyra");

console.log(`Postgres ready: postgresql://veyra:veyra@localhost:${port}/veyra`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
