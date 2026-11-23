# TickForge

TickForge is a university systems project: a small stock exchange built to study what happens on the critical path of order matching.

- A **C++ matching engine** takes orders from several producer threads through a lock-free queue, matches them on one thread with price-time priority, and writes every accepted order to a write-ahead log (WAL) before acknowledging it.
- A **Rust database** (`tickforge_db`, an LSM tree written from scratch) stores every trade and is used from Python.
- A **Python service** (`exchange-api`) connects the pieces, runs 24 virtual traders with paper money, and streams live numbers to the browser.
- A second Python service (`market-data`) serves real stock prices from Yahoo Finance.
- A **React dashboard** shows the engine live, real market data, a per-stock "Journey", and a research section called *How'z that!*.

## Quick start

You need Python 3.10+, Node 20+, CMake 3.20+, a C++17 compiler, Rust (cargo) and curl. On Windows use WSL2.

```bash
./build.sh
```

That checks your tools (and prints the install command for anything missing), builds everything, starts the stack, and prints the URLs. Open **http://localhost:8443**. Press Ctrl+C to stop all of it. Running it twice is safe; the second run skips whatever has not changed.

| Command | What it does |
|---|---|
| `./build.sh` | build and run the whole stack |
| `./build.sh test` | C++ tests, Rust tests, pytest for both services, frontend typecheck and tests |
| `./build.sh bench` | run the benchmarks and write `docs/BENCHMARKS.md` |
| `./build.sh bench-mysql` | TickForge database vs MySQL; writes `docs/benchmarks/mysql.md` |
| `./build.sh kill9 [engine flags]` | crash check: send orders, `kill -9` the engine, restart it, compare state hashes |
| `./build.sh clean` | delete build output, `.venv`, `node_modules` and runtime data (`.run/`) |

**Test:** `./build.sh test` (about 1 minute; all suites must print PASS). **Demo:** follow [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Claims and their evidence: [docs/CLAIMS_AUDIT.md](docs/CLAIMS_AUDIT.md). Limits: [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Viva notes: [docs/VIVA_QA.md](docs/VIVA_QA.md).

Optional environment flags (the default `./build.sh` needs none): `TICKFORGE_DEMO=1` enables the crash recovery demo and the engine supervisor; `TICKFORGE_OFFLINE=1` makes market-data serve its saved prices instead of calling Yahoo; `TICKFORGE_REFERENCE=snapshot` makes exchange-api use saved reference prices.

### Crash recovery demo

```bash
TICKFORGE_DEMO=1 ./build.sh
```

With `TICKFORGE_DEMO=1` the script restarts the engine (same port, same WAL) if it dies, and the **Crash recovery** panel on the Engine tab can kill it for real with SIGKILL: it pauses the traders, takes a snapshot, kills the engine, waits for the log replay, takes a second snapshot and shows PASS or FAIL per field. This protects against a process crash, not power loss (no fsync). Without the flag the panel is disabled and `POST /recovery/crash-demo` returns 403. `scripts/verify_recovery_demo.sh` runs the whole thing headless (three crashes in a row, the guards, and orders after recovery).

Logs are in `.run/logs/`, data in `.run/data/`. Nothing is installed outside this folder, and the script never uses `sudo`.

## How it fits together

```
Browser :8443 ──┬── exchange-api :8001 ── TCP 127.0.0.1:9100 (JSON lines) ── engine
                │        │                                                   queue -> matcher -> book -> WAL
                │        └── tickforge_db (Rust, imported by Python)
                └── market-data :8000 ── Yahoo Finance (cached)
```

Prices are integer cents everywhere except the screen. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the walk-through and [docs/CONTRACTS.md](docs/CONTRACTS.md) for the exact messages, file formats and API.

## Status

"Verified" means a test or command in this repository checked it. Numbers (latency, throughput) are not quoted here until `./build.sh bench` has produced them; see [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

| Part | Status | Evidence |
|---|---|---|
| exchange-api: real buyer and seller per fill, integer-cent cash and P&L, live book, trade persistence, reconnect, REST and WebSockets | built, verified against a fake engine | `services/exchange-api/tests` (67 tests, 1 skipped) |
| market-data: cached, timeouts on every Yahoo call, Journey analytics | built, verified (no network in tests) | `services/market-data/tests` (28 tests) |
| Frontend: dashboard with live engine data, order ticket, market data, Journey, *How'z that!* | built, verified | typecheck, `vite build`, 39 tests: telemetry parser, cent formatting, behavioural calculations, page smoke test |
| Behavioural features: daily vs long-term window, volatility-scaled axis, scenario preview before an order, return next to worst fall | built | calculations unit-tested; see below |
| `build.sh` | built, verified | `./build.sh test` passes all suites; the full stack was started with the real engine and database, and an order placed through the API matched in the engine, was attributed to the right two traders and appeared in the stored history |
| C++ engine: TCP server, price-time matching, cancel, risk checks, integer cents | built, verified | `ctest` (27 tests, also covering the optional features below) incl. an end-to-end test over TCP |
| Order tracking: orders table, names on fills, Kapinza, self-trade prevention, My orders panel | built, verified | `order_book_tests` (self-trade cases), `storage/tests/test_python.py` (orders and names survive a reopen), `services/exchange-api/tests/test_exchange.py` (status, fill links, counterparties), kill -9 check with owned orders |
| Real reference prices (Yahoo via market-data, snapshot fallback; trades stay simulated) | built, verified | `reference_test` (band from reference, stale levels cleared, kill -9 keeps it, also under TSan and ASan), `test_reference.py` (seeding, refresh, offline, partial reads, quotes within 2%) |
| Cash and share reservation (engine accounts, `--accounts`) | built, verified | `accounts_test` (lock, release, price improvement, partial fill, rejection, exact WAL replay, conservation), accounts crash test under ThreadSanitizer and AddressSanitizer, `./build.sh kill9 --accounts` (balances and locks identical after kill -9), `test_real_engine.py` (real engine and database through the API) |
| WAL and crash recovery | built, verified | `engine/tests/wal_recovery_test.cpp` (file cut at every byte, bit flips, writer killed with SIGKILL) and the engine test that `kill -9`s the server: the book hash is identical after restart. Survives a process crash, **not** a power cut (no fsync yet) |
| Lock-free queue | built, verified | stress test under ThreadSanitizer and AddressSanitizer; review notes in `docs/DECISIONS.md` |
| Dense-array order book (next to the `std::map` book) | built, verified, not used by the server | same random orders give identical trades and hash in `order_book_tests`; speed in `docs/BENCHMARKS.md` |
| Rust LSM database (`tickforge_db`): memtable, SSTable with Bloom filter, compaction | built, verified | `cargo test` and `storage/tests/test_python.py` |
| Engine benchmarks (lock-free vs mutex queue, dense vs map book) | built | `docs/BENCHMARKS.md`. On the test machine the mutex queue had higher raw throughput; read the table before drawing conclusions |
| Core pinning (off by default: `--pin` to enable, `--pin-core N` to choose, `--no-pin` to disable) | built, verified, not the default | `engine/tests/pinning_test.cpp` reads each thread's allowed CPUs from `/proc`. Pinned vs unpinned in `docs/BENCHMARKS.md`: no measurable effect on this WSL2 machine |
| MySQL baseline: the database vs MySQL 8.4 InnoDB, same trades | measured | `./build.sh bench-mysql`, results and settings in `docs/BENCHMARKS.md`. Faster at this one narrow job with the same durability; its P99.99 is no better, and MySQL with fsync is stronger than anything TickForge offers |
| Elastic dual ring queue (off by default, `--queue elastic`, `--ring-size N`) | built, verified, not the default | `engine/tests/elastic_ring_test.cpp` and the `kill -9` test on the real server, both under ThreadSanitizer and AddressSanitizer. Much faster than the list queue alone; no difference through the whole server, see `docs/BENCHMARKS.md` |
| io_uring for storage (off by default: `--wal-io uring` for the engine WAL, `TICKFORGE_DB_IO=uring` for SSTables and compaction) | built, verified, not the default | `engine/tests/uring_wal_test.cpp`, `storage/tests/uring_test.rs`: identical bytes, recovery, `kill -9`. Slower on this machine, see `docs/BENCHMARKS.md`, so the normal path stays |
| Leader to follower WAL shipping (off by default: `--replicate` on the leader, `--follow HOST:PORT` on the follower) | built, verified, on localhost | `engine/tests/replication_test.cpp`: real processes, both nodes end with the same state hash and a byte-identical WAL, `kill -9` on either node, also under ThreadSanitizer and AddressSanitizer. Asynchronous, and there is no automatic failover |
| Journey ranges 1D, 1M, 6M, 1Y and MAX (whole listing, weekly or monthly bars, with splits and dividends) | built, verified | `services/market-data/tests/test_journey.py` (hand-computed since-listing numbers, every range), a real MAX reply parsed by the frontend tests |
| Trading activity (FIFO lots, realized and unrealized P&L, win rate) for Kapinza or any virtual trader | built, verified | `services/exchange-api/tests/test_ledger.py` (hand-computed), `/traders/{id}/activity` test |
| Round robin dispatch, stop and stop-limit orders (exchange-api; stops are in memory only, API only) | built, verified | `services/exchange-api/tests/test_scheduling.py`; see the scheduling audit in `docs/DECISIONS.md` |
| Per-trader and per-symbol pause, resume, stop; cancel; amend (lower quantity keeps priority); manual orders first at dispatch | built, verified | `engine/tests/amend_test.cpp`, `engine_e2e_test` (also under TSan and ASan), `./build.sh kill9` with amends mixed in, `tests/test_control.py` |

### Behavioural features

These follow the research document. They use real Yahoo price history, not forecasts.

- **Evaluation window** (feature 11): the price panel switches between *Daily*, *30 days* and *1 year*.
- **Volatility-scaled axis** (feature 12): the chart's price axis spans what the stock normally does in that window; *Fit to data* is one click away.
- **Scenario preview** (feature 13): *Review order* shows what a position like this did over past holding periods (worst case, middle, best case, and how often it lost) before *Confirm and send*.
- **Return beside worst fall** (feature 14): the price panel and the order review show return and maximum drawdown together.

## Configuration

Defaults work out of the box. See [.env.example](frontend/.env.example) for the frontend addresses. `exchange-api` reads `TICKFORGE_ENGINE_HOST`, `TICKFORGE_ENGINE_PORT`, `TICKFORGE_DATA_DIR` and (tests only) `TICKFORGE_MEMORY_DB`. The database reads `TICKFORGE_DB_IO` (`standard` or `uring`). `./build.sh` passes `TICKFORGE_ENGINE_FLAGS` to the engine, for example `TICKFORGE_ENGINE_FLAGS=--pin ./build.sh`.

## Repository layout

```
build.sh                  build, test, benchmark, run
docs/                     ARCHITECTURE, CONTRACTS, DECISIONS, BENCHMARKS, DATA_SOURCES, PROGRESS
engine/                   C++ matching engine, WAL, tests, benchmarks
storage/                  Rust database tickforge_db (PyO3 + maturin)
services/exchange-api/    FastAPI: engine client, traders, database, REST + WebSockets
services/market-data/     FastAPI: Yahoo prices, Journey analytics
frontend/                 React + Vite: src/features/<dashboard|market|exchange|journey|research|howzthat>, src/lib, src/components
```

The full project specification is in [TickForge_Full_Document.md](TickForge_Full_Document.md); the research pages live in `frontend/src/features/research/papers/` (see the README there).
