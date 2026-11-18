# Round 2 progress

Work branch: `features-round2` (base: tag `v2-stable`, commit 0436b3d on `completion`).
Machine: 12th Gen Intel i5-12450H, 12 logical cores, 7.6 GiB, WSL2 Ubuntu (kernel 6.18), g++ 15.2.

## Baseline (before any change)

| Check | Result |
|---|---|
| C++ engine tests (ctest) | 19 of 19 passed |
| Rust tests (cargo test) | 11 unit + 14 database + 3 uring passed |
| Database Python binding | 8 passed |
| exchange-api (pytest) | 16 passed, 1 skipped |
| market-data (pytest) | 19 passed |
| frontend typecheck / vitest | clean / 26 passed |
| kill -9 recovery (`./build.sh kill9`) | 20000 orders, last_seq 20000, state hash `826c6e0cb3a15467` before and after restart |
| Benchmarks | see the section below (taken on the unmodified code) |

## Tasks

| Task | Minutes | Status | Evidence |
|---|---|---|---|
| P1 order tracking, names on fills, Kapinza, self-trade prevention | about 150 | done | ctest 19 of 19 (self-trade cases in order_book_tests; owned orders in the crash, replication and sanitizer runs), cargo and binding tests for orders and names, exchange-api 20 passed 1 skipped, frontend 26 passed, kill -9 hash `0b8f83997668347d` identical, bench no regression (book 10.84 M ops/s, paced RTT P50 119 us, saturated 18833 orders/s vs baseline 7.65, 134, 14221) |
| P2 cash and share reservation | about 120 | done | ctest 23 of 23 incl. accounts_test and accounts crash tests under TSan and ASan, exchange-api 27 passed (incl. real engine kill -9 test), frontend 28 passed, `./build.sh kill9 --accounts`: hash `f58ad75f742e45a5` and balances and locks identical (418505260 cents and 15488 shares locked, 7597 rejected for funds), bench no regression (book 9.99 M ops/s, paced RTT P50 105.6 us, saturated 19243 orders/s) |
| P3 real reference prices | about 60 | done | ctest 26 of 26 (reference_test also under TSan and ASan), exchange-api 36 passed, frontend 28 passed, kill9 --accounts hash d81d2b87eda5de0c identical, bench saturated 19102 orders/s (baseline 14221) |

## Baseline benchmarks (unmodified engine, , full numbers in docs/BENCHMARKS.md)

Same machine as above. Run on 2026-11-18 from commit 0436b3d.

| Measure | Baseline |
|---|---|
| Order book, MapBook, 1M ops, one thread | 7.65 M ops/s, P50 145 ns, P99 538 ns |
| WAL append, write() | P50 681 ns, 949781 frames/s |
| Whole server, unpinned, 2000 orders/s paced | RTT P50 134.3 us, P99 664.8 us |
| Whole server, write() WAL, 2000 orders/s paced | RTT P50 127.2 us, P99 658.8 us |
| Whole server, lock-free queue, 2000 orders/s paced | RTT P50 141.4 us, P99 798.9 us |
| Whole server, write() WAL, saturated (200000 orders) | 13982 orders/s, RTT P50 227.7 us |
| Whole server, lock-free queue, saturated | 19201 orders/s, RTT P50 180.4 us |

Regression gate: no more than 10 percent worse than these on the same machine. Saturated runs vary
by about 10 percent from run to run on this laptop, so a borderline result is repeated before it counts.
