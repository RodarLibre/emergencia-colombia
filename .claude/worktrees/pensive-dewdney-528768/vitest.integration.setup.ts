// Integration tests talk to the real local Postgres, same as `tsx --env-file=.env`
// does for the CLI. `process.loadEnvFile` is Node's own .env loader, so this
// needs no extra dependency.
process.loadEnvFile();
