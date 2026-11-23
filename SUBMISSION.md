# TickForge submission

Code commit: `665bcb7` on branch `completion` (tag `v-final`; the commit after it only records FINAL_ALL_DONE in docs/PROGRESS.md).

## Run
```bash
./build.sh            # checks tools, builds, starts the stack; open http://localhost:8443
```
No flags needed. Optional: `TICKFORGE_DEMO=1` (crash recovery demo and engine supervisor), `TICKFORGE_OFFLINE=1` (market-data serves saved prices), `TICKFORGE_REFERENCE=snapshot` (saved reference prices).

## Test
```bash
./build.sh test                     # all suites
./build.sh kill9                    # kill -9 the engine, compare state hash and last sequence
scripts/verify_recovery_demo.sh     # the live crash recovery demo, headless
```

## Demo
Follow [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): `TICKFORGE_DEMO=1 ./build.sh`, open http://localhost:8443.

## Built
C++ engine (lock-free MPSC queue, price-time matching, self-trade prevention, cash and share reservation, WAL with crash recovery, optional elastic ring, core pinning, io_uring WAL and WAL shipping), Rust LSM database (memtable, SSTables, Bloom filters, sparse time index, compaction), exchange-api (24 virtual traders, round robin, stops, price alerts, report, replay, crash demo), market-data (Yahoo with a saved offline snapshot), React dashboard (Engine, Market, Journey, Exchange, Report, Status, How'z that). Claims and evidence: [docs/CLAIMS_AUDIT.md](docs/CLAIMS_AUDIT.md).

## Not built or limited
No fsync (a power cut is not covered), no skip list (the memtable is a B-tree map), no timer-driven background compaction, no B+tree baseline, no database-level triggers (alerts live in exchange-api), no automatic failover. Trades and money are simulated. Full list: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Test results (23 Nov 2026)
| Suite | Result |
|---|---|
| C++ engine (ctest, incl. TSan and ASan runs) | 28 of 28 passed |
| Rust (cargo test) | 16 unit + 14 database + 3 io_uring passed |
| Database Python binding | 11 passed |
| exchange-api (pytest) | 104 passed, 1 skipped |
| market-data (pytest) | 32 passed |
| Frontend | typecheck clean, 59 vitest passed |
| `./build.sh kill9` | 20000 orders, last_seq 20000, hash 69a6a28ee55e622b before and after |
| `scripts/verify_recovery_demo.sh` | passed |
| Fresh clone check | three clean clones built from zero; all four services healthy; manual Kapinza order in the API, the database and the ledger; recovery demo passed each time |
