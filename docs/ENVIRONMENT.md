# Server configuration and local D1

SignalArc Gate targets **Base Mainnet only**, chain ID **8453**, CAIP-2 identifier **eip155:8453**. No public test network is configured.

| Name              | Scope                   | Requirement                                                                                                                                        |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_CHAIN_ID`   | Server, nonsecret       | String `8453`; configured in `wrangler.jsonc`. Missing or different values fail foundation validation.                                             |
| `SIGNALARC_DB`    | Server D1 binding       | Required when a D1 consumer calls `readFoundationConfig`. Must expose D1 `prepare` and `batch` methods. Supplied locally with `--d1 SIGNALARC_DB`. |
| `SG02_LOCAL_ONLY` | Isolated test project   | String `yes` enables the D1 fixture only with a loopback request and loopback Pages URL. Never set in production.                                  |
| `CF_PAGES_URL`    | Wrangler/Pages metadata | The isolated test project explicitly supplies `http://127.0.0.1`; public URLs are rejected by its D1 fixture.                                      |

`server/config.ts` validates only the bindings/configuration needed by the current foundation. It returns typed D1 access and the fixed Base Mainnet identifiers. Errors contain configuration names and requirements, never supplied values. It is a server-only module: do not import it into `src/`.

The unchanged `/api/health` is a basic liveness route, not a D1 readiness endpoint. It remains available without D1 and does not enumerate bindings, configuration values or credentials. The validator is invoked by the isolated D1 consumer and is ready for future server consumers; there is no global startup requirement for features that are not implemented.

## Local development without a database identifier

The [Pages D1 binding documentation](https://developers.cloudflare.com/pages/functions/bindings/#interact-with-your-d1-databases-locally) supports passing D1 bindings directly to `wrangler pages dev`. Installed Wrangler 4.154.0 accepts a binding name without a remote identifier and assigns a local identity. The exact command behind `npm run pages:dev` is:

```sh
wrangler pages dev dist --ip 127.0.0.1 --d1 SIGNALARC_DB
```

This is local emulation. There is intentionally **no `d1_databases` block or fabricated production ID** in `wrangler.jsonc`. Local dev state is under ignored `.wrangler/`; isolated tests use separate temporary state and remove it. No remote database creation or account credential is involved.

`npm run test:d1` generates a native Pages Function in a temporary project and executes this parameterized query through the real local D1 binding:

```sql
SELECT ? AS chainId, ? + ? AS calculation
```

Bindings are 8453, 19 and 23. The returned chain ID and arithmetic result 42 prove actual local SQL execution. This original SELECT check is retained, and the suite now also proves writes and persisted reads across separate loopback HTTP requests.

### Isolated local read/write acceptance test

Each runner invocation creates a fresh `.wrangler/sg02-foundation-*` project and a unique `--persist-to` state directory. Its generated Wrangler configuration has no remote database ID, remote binding or service, and the only D1 binding is the local `--d1 SIGNALARC_DB`. No application data or another test run's database is opened.

The fixture creates only this test table:

```sql
CREATE TABLE sg02_local_d1_write_probe (
  id TEXT PRIMARY KEY,
  marker TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  revision INTEGER NOT NULL
)
```

The runner first queries `sqlite_master` and asserts the table is absent, then performs these fixed actions in separate HTTP requests:

| Action  | SQL and observed assertion                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create  | Prepared `CREATE TABLE`; table exists and is empty.                                                                                                                           |
| Insert  | Prepared `INSERT ... VALUES (?, ?, ?, ?)` binds `sg02-local-record`, `inserted`, 8453, 1; D1 reports one changed row.                                                         |
| Read    | A later request SELECTs the exact row `{id: "sg02-local-record", marker: "inserted", chainId: 8453, revision: 1}`.                                                            |
| Update  | Prepared `UPDATE ... SET marker = ?, revision = ? WHERE id = ?` binds `updated`, 2, `sg02-local-record`; one changed row. A later SELECT verifies the exact updated contents. |
| Delete  | Prepared `DELETE ... WHERE id = ?` binds `sg02-local-record`; one changed row. A later SELECT verifies the table is empty.                                                    |
| Cleanup | Runner `finally` calls prepared `DROP TABLE IF EXISTS sg02_local_d1_write_probe`. A separate bound metadata query verifies `tableExists: false` and `rows: []`.               |

Identifiers and SQL are fixed test code, not request parameters. Every applicable value is bound. State is read from D1 results, not an in-memory record. The test data is deterministic and is not a production record, payment receipt or product metric. No application schema or migration is created.

All `/d1-probe/*` actions exist only in the temporary fixture. They retain loopback host, exact local Pages URL, explicit `SG02_LOCAL_ONLY=yes` and Base Mainnet configuration checks. Mutation actions require POST; reads require GET. Before any write action, native D1 metadata must identify `served_by: "miniflare.db"`, otherwise the fixture fails closed. This is additional protection; isolation primarily comes from the runner's local-only binding and fresh state configuration.

The generated test worker disables global `fetch`, with a runtime rejection test, so it cannot fetch public Cloudflare or other public endpoints. Local D1 uses its native binding transport. No interception or test route is added to production Functions. Tests verify that the normal application exposes neither GET state nor POST create probe data. Cleanup still runs if an intermediate assertion fails, and the runner removes its entire temporary project/state when it exits normally or through its error handler.

Verified results: `npm run test:d1` passes **10** checks; `npm run test:foundation` passes **17** checks, and `npm test` also retains all **14** compatibility checks. INSERT, UPDATE and DELETE each report exactly one changed row. The read results above are asserted against exact contents; final cleanup returns `{tableExists: false, rows: []}` from actual D1 metadata inspection. The original health endpoint remains unchanged. `npm audit` still exits 1 with seven high-severity affected package records; this database proof does not fix the Zod advisory.

A future owner-approved production setup must create/select a real D1 database and configure the real `SIGNALARC_DB` binding/identifier in Cloudflare or Wrangler. That future operation is not performed or required for SG-02 local tests. Merchant, resource, wallet-session and payment schemas are deferred.

## Future CDP credentials

`CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are the existing SDK's facilitator-authentication names. They are **not required by the current screen, health endpoint, D1 proof or compatibility tests**. No environment file is created, and no credential is requested or generated.

If authenticated integration is later approved, provide those names only through server-side Cloudflare secret bindings and validate them at the point of use. Never use a `VITE_` prefix, import server environment objects into React, return credentials in API responses, or log configuration values. A CDP wallet secret is not needed merely to authenticate the facilitator. JWT signing and live CDP authentication/settlement remain unverified.

The existing compatibility harness's loopback bindings (`SG02A_LOCAL_ONLY`, `MOCK_ORIGIN`) remain test-only and unchanged. No live payment endpoint is contacted. The Zod advisory remains a production security/release concern despite local input limits.
