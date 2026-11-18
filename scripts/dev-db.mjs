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

// Postgres is chatty on a normal boot, so its log is kept quiet but remembered:
// if the server fails to start, the last lines of it are the only thing that says why.
// DEV_DB_VERBOSE=1 streams it live instead.
const verbose = process.env.DEV_DB_VERBOSE === "1";
const log = [];

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "veyra",
  password: "veyra",
  port,
  persistent: true,
  onLog: (message) => {
    const line = String(message).trimEnd();
    if (verbose) console.log(`[pg] ${line}`);
    else if (line) log.push(line);
  },
});

const fail = (err) => {
  console.error(`\nPostgres failed to start on port ${port}.`);
  console.error(`  ${err?.message ?? err}\n`);
  if (log.length) {
    console.error("Last lines from Postgres:");
    for (const line of log.slice(-15)) console.error(`  ${line}`);
    console.error("");
  }
  console.error("Common causes:");
  console.error(`  - something else is already on ${port}:`);
  console.error(`      Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object OwningProcess`);
  console.error(`  - a stale lock from an unclean shutdown: delete ${path.join(dataDir, "postmaster.pid")}`);
  console.error("  - run with DEV_DB_VERBOSE=1 to see the full Postgres log.");
  process.exit(1);
};

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
try {
  if (fresh) {
    console.log(`Initialising new database cluster in ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();
  if (fresh) await pg.createDatabase("veyra");
} catch (err) {
  fail(err);
}

console.log(`Postgres ready: postgresql://veyra:veyra@localhost:${port}/veyra`);
console.log("Press Ctrl+C to stop.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
