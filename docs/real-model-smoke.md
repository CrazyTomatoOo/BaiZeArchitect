# Real-model smoke tests

Run the release smoke suite separately from routine CI. Replace the database
URL with one that is reachable from the process running the tests:

```bash
DATABASE_URL=<database-url> \
BAIZE_MODEL=deepseek/deepseek-v4-flash \
DEEPSEEK_API_KEY=<key> \
npm run test:smoke
```

Inside the Compose environment, pass the provider key explicitly:

```bash
docker compose run --rm \
  -e BAIZE_MODEL=deepseek/deepseek-v4-flash \
  -e DEEPSEEK_API_KEY \
  test npm run test:smoke
```

`BAIZE_MODEL` uses pi's model reference syntax, such as `provider/model-id`.
The selected provider must be authenticated; built-in providers use their
provider API key environment variable. Optional custom model catalogs can be
provided with `BAIZE_MODELS_PATH`.

The smoke suite is excluded from `npm test` and routine CI. It drives the same
CLI acceptance seam as deterministic tests and checks exit status, archived
assets, and trace events without asserting exact model prose.
