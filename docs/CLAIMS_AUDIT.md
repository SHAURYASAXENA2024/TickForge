# Claims audit

Checked on 23 Nov 2026 against `./build.sh test` (all green: ctest 27/27, Rust 16+14+3, binding 11, exchange-api 67 passed 1 skipped, market-data 28, frontend 39), `./build.sh kill9` and `scripts/verify_recovery_demo.sh`.

Status: **Verified** (a passing test or run proves it), **Partial**, **Missing**.

| Claim | Evidence | Status |
|---|---|---|
| Lock-free MPSC queue | `engine/tests/queue_stress_test.cpp` (8 producers, 1.6M messages, nothing lost or duplicated, per-producer order kept), also under TSan and ASan via ctest | Verified |
| Price-time priority | `engine/tests/order_book_tests.cpp` | Verified |
| Self-trade prevention | `order_book_tests` self-trade cases | Verified |
| Round-robin scheduling | `services/exchange-api/tests/test_scheduling.py`. It runs in exchange-api, in front of the engine, not inside the engine | Verified (in exchange-api) |
| WAL and crash consistency (process crash) | `engine/tests/wal_recovery_test.cpp` (cut at every byte, bit flips, SIGKILL), `./build.sh kill9` (20000 orders, hash `69a6a28ee55e622b` before and after), `scripts/verify_recovery_demo.sh` | Verified |
| Survives power loss | No fsync on the WAL write path | Missing (documented as not covered) |
| LSM-tree storage (memtable, SSTable) | `cargo test` (`flush_compact_and_reopen`, `reopen_after_crash_without_flush`), `storage/tests/test_python.py` | Verified |
| Memtable is a mutex skip list | Memtable is a `BTreeMap` (`storage/src/memtable.rs`). The code says a skip list is not built | Missing (not claimed any more) |
| Background compaction | Rust `compaction_merges_similar_tables`, `compaction_leaves_tables_of_very_different_size_alone`, `newer_copy_wins_when_only_some_tables_are_merged`. Compaction runs when tables are flushed, not on a timer thread | Partial |
| Bloom filters | `bloom.rs` tests `no_false_negatives`, `false_positive_rate_is_low`; one filter per SSTable | Verified |
| Time-range index | Sparse index (every 64th record) in each SSTable, `range_queries`, `range_uses_half_open_interval` | Verified |
| Event-driven triggers and real-time alerts | Stop orders fire on price (`scheduling.py`); price alerts (above or below, fire once, stored with fire time) are in `alerts.py`. No database-level triggers | Partial: price alerts added in exchange-api (`services/exchange-api/tests/test_alerts.py`, `AlertsCard.test.tsx`, Alerts card on the Engine tab). There are still no database triggers |
| Mutex-queue baseline | `./build.sh bench`, `docs/BENCHMARKS.md`. Mutex has higher throughput at every producer count. Lock-free has the lower enqueue P99 at 4 and 8 producers (4640 vs 22904 ns, 32749 vs 47193 ns) but not at 1 and 2 | Verified |
| Pointer-based book baseline | `std::map` book next to a dense array book, `order_book_tests`, `docs/BENCHMARKS.md`. The server uses the `std::map` book | Verified |
| B+tree or MySQL baseline | `./build.sh bench-mysql`, `docs/benchmarks/mysql.md` (MySQL 8.4 InnoDB, run 3 Nov 2026, needs a local MySQL). It is a narrow trade-insert comparison. No B+tree baseline was built | Verified (MySQL), Missing (B+tree) |
| Benchmarks | `docs/BENCHMARKS.md` written by `./build.sh bench` | Verified |
| Real reference prices, simulated trades | `engine/tests/reference_test.cpp`, `services/market-data/tests`; Yahoo data is delayed, trades are simulated | Verified |
| Cash and share reservation | `engine/tests/accounts_test.cpp` | Verified |
| Dashboard, order ticket, Journey, How'z that | frontend vitest (39), typecheck | Verified |

## Doc and UI fixes made

- README test counts updated (exchange-api 67, market-data 28, frontend 39).
- How'z that evidence cards updated to the same counts and date.
