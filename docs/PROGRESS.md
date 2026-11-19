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
| P4 trading activity (ledger) | about 25 | done | exchange-api 42 passed 1 skipped (5 hand-computed ledger tests, endpoint test), frontend 30 passed, ctest 26 of 26, kill9 --accounts hash d81d2b87eda5de0c identical; engine untouched, no bench needed |
| P5 Journey ranges | about 20 | done | market-data 28 passed (hand-computed long-term test, weekly vs monthly MAX, every range, 5D refused), frontend 32 passed (real MAX fixture parsed), engine untouched |
| P6 scheduling audit | about 20 | done | FIFO proven by existing engine tests; round robin and stop/stop-limit added with 5 tests in test_scheduling.py; findings in DECISIONS.md |
| P7 control without stopping everything | about 90 | done | ctest 27 of 27 incl. amend_test and the e2e amend case under TSan and ASan, kill9 with amends mixed in: hash 69a6a28ee55e622b, and --accounts hash 64eae4cd2a5feecb, both identical after restart; exchange-api 58 passed; frontend typecheck clean; bench no regression (book 8.41 M ops/s, paced RTT P50 125 us, saturated 16295 orders/s vs baseline 7.65, 134, 13982) |
| P8 no dead UI | about 40 | done | Every panel traced to a source in docs/DATA_SOURCES.md; stale How'z that capability and roadmap text brought up to date; headless Chromium (Playwright, system libs unpacked locally without sudo) at 640 px width (= 200 percent zoom) in dark and light: found and fixed one horizontal overflow (hidden table header cell in My orders), now 0 px in both; page scan found no NaN, undefined or null and no console errors; every remaining dash has a hover explanation; frontend 32 passed |
| P9 final cleanup | about 35 | done | AF_XDP removed from the Status page (the card had nothing else, so it is gone), README, docs, roadmap and the design document, and the probe file deleted; README and docs/CONTRACTS.md agree with the code; path sweep and file attribution check print nothing (see DECISIONS.md for five commit trailers that cannot be rewritten); fresh clone in a folder with spaces and parentheses built and ran, Kapinza order seen in UI data, DB and ledger, stack stopped with SIGTERM |

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
ROUND2_ALL_DONE
