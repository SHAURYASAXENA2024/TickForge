# Decisions

Short notes on why things are the way they are. Newest at the bottom.

## Baseline (before the cleanup)

Checked on Ubuntu 26.04 (WSL2), cmake 4.2, g++ 15, rustc 1.99, Python 3.14, Node 22.

| Claim | What I found |
|---|---|
| `engine_server` target does not exist | Worse: `matching-engine/src/engine_server.cpp` was an **empty file**, and `CMakeLists.txt` also named `order_book_tests.cpp` and `btree_baseline.cpp`, which do not exist. `cmake` could not even configure. |
| Engine only prints random trades | True. `main.cpp` is a demo; prices are `double`; no server, cancel, snapshot or stats. |
| `telemetry-bridge/` missing | True. The README points at it. The dashboard can only show "simulation". |
| Two Rust crates | **Three**: a crate at the repo root (`src/`, `tests/`, `benches/`), `tickforge-db/` and `tickforge_db/`. The root crate and `tickforge_db` compile. `tickforge-db` fails on pyo3 0.21 with Python 3.14. |
| Nothing is persisted | True: the Python wrapper expected a class the module does not export, and silently used a list. |
| Committed junk | `matching-engine/build/`, `tickforge-db/target/`, `market-data/__pycache__/`, root `package-lock.json`, `exchange-api/data/wal.log`, `src/wal/new1111.cpp`: all removed. No `.vscode/` was tracked on this branch. |
| Ports disagree | Vite 8443, `start.sh` said 5173. Using 8443. |

Not re-checked individually (will be covered by the work that fixes them): random buyer/seller attribution in `exchange-api/main.py`, empty `_order_book`, Yahoo calls without cache or timeout, size of `App.tsx` (1,517 lines), `HowzThatPage.tsx` (907), `howzthat/content.ts` (939).

## Layout

`git mv` into `engine/`, `storage/`, `services/`. The three Rust crates are not merged yet: `storage/` holds the one that has the PyO3 binding; the other two sit in `storage/_to_merge/` until their SSTable reader, B-tree baseline and tests are folded in. That folder is deleted when the merge is done.

## Decisions

- **Prices are integer cents everywhere.** Floats cannot represent most prices exactly, and the recovery test compares hashes, so the state must be bit-exact.
- **One TCP connection, JSON lines.** Easy to debug with `nc`, no extra dependency. Throughput is limited by JSON parsing, which is fine here; the benchmarks measure the queue and book directly, not the socket.
- **Engine assigns `order_id` = `seq`.** One number to track, and replay reproduces it.
- **Rejected orders are not written to the WAL.** They change no state. Risk checks depend only on book state, so replay of accepted inputs gives the same result.
- **`start / pause / stop / reset / speed` control the virtual traders, not the engine.** The engine is a server that is always on.
- **Engine reports its own CPU and memory** from `/proc/self`, so the API does not need the engine's pid.
- **Fills are attributed from the acks.** exchange-api remembers `order_id -> trader` from each `ack` and shrinks the remaining quantity on every trade. A manual order has trader id 0 and no account, so the other side of such a trade is the only one whose cash changes.
- **Resting orders do not reserve cash or shares.** Simpler than a reservation system; the order generator checks balances when it creates an order. A trader can end up slightly short; cash and shares are still conserved exactly across all traders.
- **Telemetry shows one symbol (AAPL).** The contract has one `book` in the stats message; the dashboard's order book panel uses `/ws/orderbook?symbol=` for any symbol.
- **The dashboard shows empty states, not sample data, when a service is down.** The old "simulation mode" mixed invented numbers with real ones.
- **Removed the wheel-scroll hijack** (`useSmoothScroll`). It broke keyboard and zoom use, and nothing depended on it.
- **Journey "MAX" is hidden.** The frontend code for it exists, but the market-data side was reverted before this cleanup and has no `max` range. Listed as planned.
- **Frontend colours go through role names** (`canvas`, `surface`, `line`, `fg`, `muted`, `accent`, `up`, `down`, `warn`) defined as CSS variables, so light and dark themes only redefine the variables.
- **Linux and macOS only.** `build.sh` is bash; the sanitizer tests and `kill -9` recovery check need a Unix. On Windows use WSL2.

## Engine (C++)

- **The old engine code was replaced, not patched.** The previous WAL wrote text lines and key/value records, the book used `double` prices, and nothing could run as a server. The new engine is `engine/include/*.hpp` plus `engine/src/engine_server.cpp` and `engine/src/wal.cpp`.
- **Ingress lock.** Connection threads take one mutex for "assign seq, write WAL frame, send ack, push to queue". That keeps queue order equal to seq order, which replay needs. The lock-free queue is still the hand-off to the matching thread; the lock is only held for one `write()` call.
- **WAL durability.** Each frame is one `write()` on an `O_APPEND` file. That survives a killed process (`kill -9`, tested) but not a power cut; there is no `fsync` per order because it would cap throughput at disk speed. Planned: group commit.
- **Price band is checked outside the matcher.** Connection threads read the last trade price of the symbol (an atomic). It can be one trade old. Replay does not repeat risk checks: an order in the WAL was accepted once and is applied as logged, so replay is exact.
- **Cancels are logged before we know they work.** The connection thread can only reject ids that were never issued. A cancel of an order that has since been filled is logged, then the matching thread answers `reject` with `unknown_order`. Replaying that cancel does nothing, so state stays exact. (CONTRACTS says rejected inputs are not logged; this is the one exception.)
- **`trade.seq` is the seq of the input that caused the trade** (the incoming order). Trade ids come from their own counter.
- **Valid symbol ids are 1 to 1000** (`MAX_SYMBOL_ID`). Anything else is `unknown_symbol`.
- **Two order books, one interface.** `MapBook` (std::map + deque) is the baseline and the one `engine_server` uses, because it accepts any price. `DenseBook` is an array with one 64-byte-aligned level per cent; it only accepts prices inside a fixed range, so it is used by the benchmark and by a test that feeds both books the same random orders and compares trades and state hash. Measured numbers are in `engine/bench/last_run.md`.
- **Latency numbers** are from "pushed onto the queue" to "matching finished" and exclude socket writes. p50/p99 come from the last 65,536 orders; `lat_hist` counts all orders since start.
- **Matching thread sleeps** on a condition variable when the queue is empty (10 ms timeout as a safety net); idle CPU measured at 0.2%.
- **Connection limit 100.** The queue supports 128 producer threads; extra connections are closed.

## Queue audit (`lock_free_queue.hpp`)

Found by reading the code. The old stress test passes on the old queue, so none of 1 to 3 is proven by a failing test; 4 and 5 are visible in the numbers.

1. **Possible use after free.** `dequeue()` freed the old head even if `tail_` still pointed to it (a producer had linked its node but not yet moved the tail). Another producer could then read the freed node. Fix: the consumer moves the tail first.
2. **Memory ordering.** A hazard pointer was published with `release` and checked with a later `acquire` load. Those can be reordered (store then load), so the free-scan might not see the hazard. Fix: `seq_cst` on publish, validation and scan.
3. **64-thread cap.** Slot numbers came from a counter that wrapped (`% 64`); two threads could share a hazard slot and overwrite each other. A server that makes one thread per connection reaches 64 quickly. Fix: slots come from a pool and are returned when a thread ends; limit raised to 128; the 129th concurrent thread aborts with a message instead of corrupting memory.
4. **Retire array of 1,024 slots.** When full, a node that was still hazardous was leaked, and `try_reclaim()` scanned 1,024 x 64 slots on every `dequeue()`. Fix: a consumer-only `std::vector` of retired nodes, scanned once per 64 retirements (no overflow, no leak).
5. **Cost.** Same stress test, same machine: old queue 153 / 177 / 196 ms (-O2), new queue 65 / 53 / 85 ms; under ThreadSanitizer the three cases took about 70 s with the old queue and about 1.5 s with the new one.

Both versions pass `queue_stress_test` under ThreadSanitizer and AddressSanitizer (15 runs each for the new one).

## Database (Rust)

- **One crate.** The three crates are merged into `storage/` (library name `tickforge_db`, `crate-type = ["cdylib", "rlib"]` under `[lib]`). Their code was rewritten around the contract: the JSON-lines SSTables, the `println!` triggers, the C++ WAL linked through `build.rs` and the half-finished PyO3 class are gone.
- **Matching code removed from Rust.** The root crate had its own order book and matcher (`exchange/`). The C++ engine owns matching, so a second implementation could only drift out of sync. Deleted.
- **B-tree baseline.** The memtable is a `BTreeMap` (a B-tree). The old "skip list" was also a `BTreeMap`, so it was renamed rather than faked. No separate B-tree file existed to keep.
- **SSTable reader kept in spirit, format replaced:** binary records sorted by `(timestamp_ms, trade_id)`, a sparse index entry every 64 records, a Bloom filter on `trade_id`, CRC-32 over the whole file in the footer. `open` refuses a file whose CRC does not match; a test flips every byte of a small file and checks each one is caught.
- **Python feature flag.** PyO3 is an optional dependency (`python` feature, turned on by `pyproject.toml`). Plain `cargo test` then needs no libpython. PyO3 is 0.30.1, the current release on crates.io (checked with `cargo search`); it builds and runs on Python 3.14.
- **The database has its own log** (`wal.log`, length + CRC frames). It is emptied after a flush. A crash between writing the SSTable and emptying the log only replays trades that are already in the table; ids are unique, so nothing doubles.
- **Compaction merges neighbours only.** Tables are ordered by file number and newer wins. Merging two tables with an older one in between could bring back an old copy of a replaced trade. `compact()` therefore takes the longest run of adjacent tables whose sizes are within 4x of each other, writes the result over the newest input's file number, then deletes the others. The memtable also flushes by itself at 10,000 trades, and a flush that leaves 8 or more tables triggers a compaction.
- **`get_trade` on an SSTable scans the data section** when the Bloom filter and the min/max id say "maybe", because the file is sorted by time, not by id. Misses (most lookups) never touch the disk. Planned: an id index per table.
- **`count()`** is kept as a number: computed once at open (one pass over all tables), then +1 for every insert of a new id.

## Core pinning

- **Built, off by default.** `--pin` turns it on, `--pin-core N` chooses the core and `--no-pin` turns it off. The request was for a disable flag, which suggests on by default, but the rule for this work was that a feature stays off unless it shows no regression, and it did not clearly pass that.
- **The default changed during the work, and the reason matters.** It first went on by default after a 15-run comparison favoured pinning (matcher P99 1234 against 1504 us). That run overlapped with other work on the machine. On the idle machine, the next 15-run comparison went the other way (RTT P50 132 against 122 us, P99.9 931 against 810 us). A 30-run comparison on the idle machine then came out level: RTT P50 135 against 139 us, P99 475 against 460 us, P99.9 968 against 927 us, matcher P99 297 against 295 us. The 30-run comparison in `docs/BENCHMARKS.md`, from the final run, came out level again with the small differences the other way (RTT P99 474 against 477 us). So: no measurable effect in either direction, with differences that change sign from run to run. An earlier 5-run comparison was also unstable (1470 against 766 us). A feature with no shown benefit does not earn a place in the default.
- **Why it may not help here.** WSL2 pins to a virtual CPU, and Hyper-V still moves that between physical cores. A bare-metal run with `isolcpus` is what would really test the idea, and it could reverse this.
- **Why the last CPU.** The kernel keeps most interrupts and housekeeping on the low-numbered CPUs. `--pin-core` overrides it.
- **Only the matcher gets a core of its own.** Connection threads can be up to 100, so they share the remaining CPUs. They inherit that set from the main thread.
- **Pinning is not isolation.** Without `isolcpus` the kernel can still schedule other processes on that core.
- **A benchmark finding, separate from pinning.** At full closed-loop load (4 connections, about 18,000 orders/s) the matcher is the bottleneck: its P50 reaches about 2 s of queue backlog, because it sends each trade to every client from the matching thread. RTT stays low because the ack is sent before matching. So `server_bench` has a paced mode, and the matcher columns only mean "latency" when the load is paced.

## MySQL baseline

- **Real MySQL, no root.** `run.py` unpacks the Ubuntu packages into `.run/mysql`, so nothing is installed on the system, as with the rest of `build.sh`. `TICKFORGE_MYSQLD` points it at another `mysqld`.
- **Separate crate.** `bench/mysql_baseline` has its own `Cargo.toml`, so `storage/` and `./build.sh test` never depend on a MySQL client.
- **Same durability is the only fair row.** Following section 11.6 of the project document: TickForge's database acknowledges before fsync, so it is compared with MySQL at `innodb_flush_log_at_trx_commit=2`. The `flush=1, sync_binlog=1` row is shown for reference, labelled as stronger. Commits there took about 7 ms on this virtual disk, so it uses 5,000 trades instead of 200,000.
- **Settings chosen in MySQL's favour.** Autocommit (one socket round trip per commit; the first version used `BEGIN` / `INSERT` / `COMMIT` and paid three), performance schema off, a Unix socket.
- **What the numbers say.** One trade per commit, about 55x MySQL's best fair row, most of that because a function call replaces a socket round trip. In batches of 100, about 4x. **P99.99 is not better:** 7 ms against 7 to 17 ms singly, 76 ms against 38 to 86 ms in batches, because flush and compaction run on the insert path. This is the cost the activity-aware compaction idea is meant to address.
- **Bytes written come from `/proc/diskstats`.** This WSL2 kernel has no `/proc/<pid>/io` (the first run reported 0 for everything, and those numbers were thrown away), so the count is the whole disk, which needs an idle machine.
- **Recovery test size.** 99,999 trades, one short of a memtable flush. The first attempt used 100,000, which left the log empty and made TickForge's recovery look better than its worst case.
- **Not explained.** MySQL without the binlog came out slower than with it, in both full runs (3,990 against 5,312 trades/s). The no-binlog configuration always ran first and the order was not varied, so this may be an artefact. Do not read it as a finding about MySQL.
- **P99.99 of the batch rows** comes from 2,000 commits, so it is close to the single worst commit.
- **MyRocks not run.** It is the closer LSM baseline according to the project document, but it is not in the Ubuntu packages.

## Elastic dual ring

- **One ticket counter instead of two modes.** The usual design has a "ring mode" and an "overflow mode", and the hard part is switching back without reordering. Here every enqueue takes a ticket with `fetch_add` and the consumer always takes tickets in order, wherever each item went. An item in overflow can never be overtaken, because the consumer does not move past its ticket. There is no switch.
- **Why order matters here.** The server needs queue order to be `seq` order, or replay gives a different state hash. `elastic_ring_test` feeds real orders through a ring of 2 and compares the state hash with direct matching.
- **Overflow is a Treiber stack of single nodes, not the segmented buffer in the project document.** The consumer takes the whole stack with `exchange` and files nodes by ticket in a private hash map. Nothing is popped singly, so there is no ABA problem and no hazard pointers. Segments would need memory reclamation on a path that only runs during a burst.
- **Off by default.** The queue alone is much faster (3.3x to 8.4x throughput, enqueue P99 8x to 34x lower, in the final run in `docs/BENCHMARKS.md`, because normal flow allocates nothing). Through the whole server, the difference is inside the noise: `ingress_mu_` serialises the orders and the sockets take the time. So there is no regression, but no gain that would justify changing the default on the critical path, and it preallocates about 6 MB.
- **Testing the tests.** Five bugs were put into copies of the ring: relaxed ordering on publish, wrong overflow order, wrong slot sequence, a leaked node, overwriting a full slot. All five were caught (TSan, the order check, the order check, ASan, a hang). A broken ring can hang, so these tests have a timeout. Then 45 runs of the stress test (normal, TSan, ASan) and 15 rounds of the server tests under both sanitizers, no failures.
- **The server is now also tested under the sanitizers**, which it was not before: `engine_e2e_elastic_thread` and `_address` run the real `engine_server` with the crash test driving it, and fail if a sanitizer prints anything.
- **A known limit.** A producer stopped between taking its ticket and publishing holds up the consumer until it runs again. Nothing is lost. In the server, orders are enqueued under `ingress_mu_` anyway.

## io_uring for storage

- **Kernel support, checked first.** `CONFIG_IO_URING=y`, `kernel.io_uring_disabled=0`, and creating a ring works on this kernel (6.18, WSL2). Both code paths check by really creating a ring, because containers can block the system call on a kernel that has it. Asking for io_uring where it cannot work is a startup error, not a quiet fallback.
- **No liburing.** `liburing-dev` is not installed and `build.sh` does not install things, so the C++ side uses the system calls directly (`engine/src/uring.cpp`). The Rust side uses the `io-uring` crate, Linux only.
- **Two places, because storage means two things here.** The engine WAL, which the critical path waits on, and SSTable writes for flush and compaction, which is what the project document asks for ("io_uring with O_DIRECT compaction"). The database's own log still uses `write()`: it is small writes through a Python call, where io_uring has nothing to batch.
- **Measured slower, so off by default.** WAL append: 37 us against 0.5 us per frame, about 70x. Whole server at full load: 9,966 against 17,870 orders/s. RTT P50 at paced load: 273 against 134 us. SSTable and compaction writes: 10 to 18% slower (200 against 170 ms for 1,000,000 trades).
- **Why the WAL is so slow.** An `iou-wrk` kernel thread was present in all 10 samples taken under load, with about 3 context switches per order. So the writes go through a kernel worker thread instead of finishing inside the system call. The likely reason is that a buffered append on ext4 cannot be done without blocking; that part was not checked further. The engine cannot batch to win this back, because an order must be logged before its ack and acks go out one at a time. A different file system or a group-commit design might change this; neither was tried.
- **One side effect worth noting.** With `--wal-io uring` at full load the matcher is no longer saturated (P50 22 us, against seconds of backlog), because the slower WAL holds the input rate below what the matcher can take. That is back-pressure from a slower log, not an improvement.
- **What was not measured.** O_DIRECT is meant to keep a large compaction from evicting the page cache and to make its I/O less disruptive to the rest of the machine. Time per file does not show that, and a benchmark under memory pressure was not done. So "slower" is the whole result here for now, not the last word on compaction.
- **Short writes and errors.** A short write continues where it stopped. A failed SSTable write stops new requests and waits for the ones in flight before returning, so the buffer is never freed while the kernel may read it. `EINVAL` from O_DIRECT (tmpfs, for example) repeats the write without it.

## Replication

- **WAL shipping, because the engine is already a replicated state machine in waiting.** Same inputs in the same order give the same state, which is what the crash recovery relies on. A follower runs the same matching code on the same frames.
- **The shipper reads the file, not a queue.** Each follower has a thread on the leader that reads the WAL file from its position and sends whole frames. A slow or absent follower costs the critical path nothing and needs no buffer: the backlog is the WAL. A new follower catches up the same way live ones are served.
- **Asynchronous.** Waiting for a follower before the ack would add a network round trip on the critical path. The price: an acknowledged order can be missing from the follower if the leader's disk is lost. Since neither node fsyncs, a power cut can lose data on both.
- **Same port, a new message type.** No second port to configure. `--replicate` is required, so a server without it answers `bad_request` exactly as before.
- **Followers refuse to run on a bad history.** The handshake compares the CRC of the follower's last frame with the leader's frame at that seq. A follower ahead of its leader, or with other data at that point, exits with code 3 rather than serve wrong numbers. This checks one frame, not the entire file.
- **No automatic failover, no chains.** Choosing a new leader safely needs a consensus protocol, which was not in scope. Promotion is manual: restart the follower without `--follow`; the test covers this. `--replicate` with `--follow` together is refused because it is not tested.
- **What the test proves.** Same state hash, same books and a byte-identical WAL, after: catch-up, live flow, 4 clients at once, `kill -9` of the follower under load, `kill -9` of the leader under load, and a restart. All of it also under TSan and ASan (10 runs each) and 20 plain runs, no failures.
- **Testing the test.** Six bugs were put into copies of the server. Three were caught at once: no WAL on the follower, dropped cancels, followers taking orders. Missing CRC check showed up as a hang (the timeout catches it). One is harmless: without the `follower_ahead` check, the next check refuses that follower as `diverged`. **One got through at first:** JSON lines mixed into the WAL stream, because the follower reconnects after a damaged frame and still ends up correct. So the follower now counts `damaged_frames` and the test requires 0; that catches it.
- **Cost, measured on one machine.** `--replicate` with no follower: nothing consistent (RTT P50 150 against 124 us in the final run, but 143 against 153 and 122 against 122 in two others). With a follower on the same machine: RTT P50 124 to 164 us at paced load; at full load 16,082 to 11,720 orders/s. The follower had everything about 1 ms after the last ack. This is why it is off by default. Localhost only: a real network was not tested.

## AF_XDP is out of scope

Kernel-bypass networking (AF_XDP) is not part of this project: it is not built, not investigated and not listed as planned.

## Aurora theme

- **Tokens only, plus two lines of CSS, because a gradient is not a colour.** `--accent` is used for text, borders and charts, so it stays one solid colour, and `--accent-gradient` and `--canvas-gradient` are new tokens. Two rules in `index.css` apply them: `body` and `.bg-accent:not(:disabled)`. No component changed. Without `:not(:disabled)`, the gradient covers the plain colour a disabled button sets, which a screenshot showed.
- **Dark mode uses the palette exactly. Light mode cannot.** `#22d3ee` on white has a contrast of about 1.8, so light mode uses darker versions of the same hues (`#0e7490` to `#6d28d9`) on pale backgrounds.
- **Checked.** Every text colour on every background is at least 4.5 (WCAG AA) in both modes, and `--on-fill` on both ends of the gradient. The lowest are 4.60 in dark mode (`--on-fill` on violet) and 4.74 in light mode (`--up` and `--accent`). The old light `--faint` was 4.41; it is 4.91 now. `--up`, `--down`, `--warn` and `--on-fill` are unchanged.

## Round 2

### P1: order tracking and counterparties

- **The owner of an order lives in the engine and the WAL.** Self-trade prevention has to happen inside the atomic match, so the engine must know who owns an order. A new WAL frame type 3 is type 1 plus a `u32 trader_id`; orders without an owner are still written as type 1, so old logs replay unchanged.
- **Self-trade prevention is on by default; `--no-stp` turns it off.** It only does anything for orders with a `trader_id`, so benchmarks and old clients are unaffected. Measured on the same machine: no regression (see docs/PROGRESS.md).
- **Own orders are skipped, not cancelled or reduced.** The incoming order matches the next order in price-time order; if nothing else crosses, the remainder rests (a trader can then have a bid above their own ask). It is the least surprising option and keeps recovery a pure replay.
- **The engine names both traders on every trade** (`buyer_id`, `seller_id`). The API no longer depends on an in-memory order-to-trader map, which was lost on restart.
- **The orders table is its own CRC-protected log (`orders.log`), not an LSM table.** It is small, updated in place per order, and needs "last row wins", which append-and-replay gives in about 200 lines. It is rewritten when it holds 4 times more frames than live rows.
- **Names on fills use a flag bit in the symbol length**, so records without names stay byte-identical and old SSTables still read.
- **Rejected orders are stored under ids from 2^62 upward**, because the engine gives a rejected order no id. The reason is stored with the row.
- **Trader 25 is Kapinza.** `trader_id` 0 on `POST /orders` means "the order ticket" and is stored as 25. The 24 virtual traders keep ids 1 to 24; `/traders` lists them under `traders` and Kapinza under `manual`.
- **`trades_by_trader` scans every table** (there is no index by trader). It serves a small panel; an index is not worth it until something needs it on a hot path.

### P2: cash and share reservation

- **The engine owns the balances, not exchange-api.** Balances kept in the API were lost on a restart and could not be checked against the WAL. With `--accounts` the engine keeps cash, shares and locks per trader, changes them only in the matching thread in WAL order, and includes them in `state_hash`, so "exact after replay" is checked by the same hash as the books. exchange-api reads them (`command accounts`) and only keeps realized P&L and fill counts itself.
- **Behind a flag, on in the stack.** `--accounts` is off in the engine by default (clients that send no `trader_id`, and the benchmarks, are unaffected), and `./build.sh` starts the stack with it. The benchmark orders carry no trader id, so they never touch accounts: the cost of accounts per order is not measured by `./build.sh bench`.
- **Funds are checked before the WAL write, with a promise ledger.** The connection thread asks `Accounts::hold()`, which counts locked funds and funds promised to logged-but-unmatched orders. Rejected orders take no sequence number and are not logged. The matching thread turns the promise into a lock. The promise ledger is not state and is not hashed.
- **Why replay cannot go negative.** Fills only raise availability (buyer: cash falls by the trade value, the lock falls by the limit value, which is at least as much; seller: shares and locked shares fall together, cash rises), cancels raise it, and a promise is only made against availability that already exists. So replaying in order sees at least as much available as the live check did.
- **Reasons are `insufficient_cash` and `insufficient_shares`** (snake case like the other reasons); the UI shows them as plain sentences.
- **Reset moved into the engine.** The "Reset" button cancels the virtual traders' open orders and sends `reset_accounts 1..24`; the engine cancels anything left, restores balances and logs the reset, so a restart does not bring old balances back. Kapinza (25) is not reset.
- **A lock is released at the order's own limit.** A resting buyer trades at its own limit, so only the incoming buyer can get price improvement; the engine passes the incoming order's limit to the settle step and the trade price for resting buyers.
- **Unknown traders get an account on first use** with the starting balances. This is deterministic, so replay creates the same accounts.

### P3: real reference prices

- **Only the price level is real.** Yahoo (through market-data, delayed up to 15 minutes) gives each symbol a reference price; every trade is still simulated. The UI says so: "Reference price: Yahoo (delayed up to 15 min). Trades: simulated."
- **The engine owns the reference.** `set_reference` is a WAL record (type 5), so the band and the cleared book replay exactly after kill -9. The alternative (exchange-api cancelling orders one by one) would leave a half-cleared book if it died in the middle.
- **Band from the reference, not the last trade.** Before, the band drifted with the last trade; with simulated trades that is a random walk away from the real price. 20% around the reference keeps order prices honest.
- **Clearing at 5% (`reference_clear_pct`).** A new reference removes resting orders more than 5% away, so two price levels never share one book (the old 189.50 sample orders vs a real 352.20). Normal 45-second refreshes move prices far less than 5%, so the book is not wiped every time. When orders are cleared that far, the API's last-trade price for the symbol is reset to the reference too.
- **Virtual traders quote within 2% of the reference** (the strategies' offsets are clamped), not of their own last price.
- **Refresh every 45 s** (inside the requested 30 to 60). Prices that did not change are not sent again. After an engine restart the API asks the engine what it has and re-sends only the differences.
- **Fallback: snapshot file.** Order: live read, else `<data dir>/reference_snapshot.json` (the last live prices the API saved), else the bundled `app/reference_snapshot.json` (real Yahoo closes of 2026-11-18, cents). If a live read fails the previous prices stay and `/reference` says `snapshot` (or `mixed` if only some symbols were read live). Tests never use the network: the live read is a function they pass in, and they use `tests/reference_prices.json`.
- **Tests use the old sample prices on purpose** (`reference_prices.json`) so earlier tests keep their price level.
- **Alignment with the Market and Journey tabs.** Both read the same market-data price (`price` of the 1-day series, the last bar), so the reference price equals the number those tabs show, up to market-data's 30-second cache.
- **Live mode is the default when run with `./build.sh`** (`TICKFORGE_REFERENCE=snapshot` forces offline).

## P4 trading activity (ledger)
- **Computed on request from the fills in the database** (`GET /traders/{id}/activity?symbol=`), not stored: fills are the single source of truth, so the numbers cannot drift after a restart.
- **FIFO on fills only.** Starting holdings of the virtual traders are not fills, so a sell beyond the bought shares opens a short lot that later buys close. One "trade" for win rate, best and worst is one closing fill (sum over the lots it closed).
- **Unrealized P&L** marks open lots against the engine's last price for the symbol; shown as dash until a price exists.
- Only the ten exchange symbols have activity; other Journey stocks show an explanation.

## P5 Journey ranges
- Ranges are 1D, 1M, 6M, 1Y and MAX; 5D is removed from market-data (the API answers 400) and the UI.
- **MAX** asks Yahoo for the full history with weekly bars; if the listing is longer than 25 years it asks again with monthly bars (at most about 1300 weekly or 600 monthly bars). The API reply carries the "since listing" block (`longTerm`) that the UI already knew how to draw: total return, CAGR, yearly returns, falls of 20 percent or more (up to five), splits and dividends from `Ticker.actions`.
- Prices are Yahoo's adjusted prices; the block says so in its notes. Linear and log scale and the rule-based story work for every range (MAX opens on log scale).
- Offline tests use a fake provider only; a vitest fixture holds a real backend reply for MAX.

## P6 Scheduling audit (FIFO, round robin, triggers)
- **Price-time FIFO: exists** in the engine's order book (`engine/include/map_book.hpp`, `dense_book.hpp`). Proven by the price-priority and time-priority cases in `engine/tests/order_book_tests.cpp`.
- **Round robin: was missing** (virtual traders were picked with `rng.choice`, which only starves nobody on average). Added in exchange-api (`app/scheduling.py`, `RoundRobin`): every trader gets a turn before any gets a second. On by default (`TICKFORGE_DISPATCH=random` restores the old choice). Tested for fairness and order.
- **Stop and stop-limit orders: were missing.** Added in exchange-api, not in the engine: `POST/GET/DELETE /stops`. A BUY stop fires when the last trade price is at or above the stop price, a SELL stop at or below. A stop-limit then sends a limit order at its limit price; a plain stop sends a limit 5 percent through the trigger (so it crosses the book and stays inside the 20 percent band). On by default (`TICKFORGE_STOP_ORDERS=0` switches it off).
- **Limits, stated honestly:** held stops live in exchange-api memory only and are lost on a restart; cash and shares are reserved when the stop fires, not when it is placed, so a fired stop can be rejected for funds; re-seeding the reference price does not fire stops (only real trades do); there is no order-ticket control for stops yet, only the API.

## P7 Control without stopping the whole system
- **Per-trader and per-symbol pause, resume, stop** live in exchange-api (`POST /traders/{id}/control`, `POST /symbols/{symbol}/control`, body `{"action": "pause"|"resume"|"stop"}`), with buttons in the Exchange tab. Paused: no new orders, resting orders stay. Stopped: no new orders and the resting orders are cancelled (which releases their reservations). A paused or stopped symbol refuses new orders from everyone, Kapinza included (reason `symbol paused`). The global Start/Pause/Stop/Reset are unchanged and apply on top. These states live in exchange-api memory and reset when it restarts; the cancels they cause are real engine cancels and are in the WAL.
- **Cancel** already existed in the engine (WAL type 2) and releases the lock of what is left.
- **Amend** is new in the engine as a WAL record (type 6, `amend`) that only lowers the remaining quantity of a resting order *in place*, so the order keeps its place in the queue, and the lock of the quantity taken off is released. It is applied by the same code live and in recovery, so replay is exact (unit replay of 6000 mixed inputs, and the kill -9 check now mixes amends in). A price change or a bigger quantity loses priority, as it must, so exchange-api does it as a cancel plus a new order (`PATCH /orders/{id}`): the new order has a new id and goes to the back. Before cancelling it checks the price band and the funds, and if the engine still refuses the new order it puts the old one back (at the back).
- **Kapinza's priority** is applied at dispatch in exchange-api: while one of Kapinza's orders is on its way to the engine, the virtual traders send nothing, so the manual order goes first. The engine's queue itself stays one FIFO queue in arrival order, and matching stays price-time. A real two-lane queue inside the engine was not built: it would change the hot path and the WAL order, and the gain is a few microseconds.
- **A match in progress is never interrupted.** One thread does all matching, and it takes one job at a time: an order is matched against the book completely (a few microseconds) before the next job is looked at. Pause, stop, cancel and amend are jobs like any other, so they run between matches, never inside one. That is why a book is always consistent and the WAL order is the matching order.

## Round 2 housekeeping
- **Attribution lines.** Five commits on `features-round2` (c3d34af, cbdac7f, e63696c, ebe24f8, 71e12ca) carry a `Co-Authored-By` trailer that the run rules did not want. They were already pushed when this was noticed and pushed history is never rewritten, so they stay; no later commit has one. The files themselves contain no attribution.
- **Fresh clone.** A clone into a folder with spaces and parentheses built from zero with `./build.sh`, started, took an order from Kapinza that showed in My orders (with the counterparty), the database fills and the ledger, and stopped cleanly.
- **Headless browser.** Playwright's Chromium was installed with pip; its three missing system libraries were unpacked locally with `apt-get download` (no root), outside the repo.

## Recovery demo (branch `recovery-demo`, base tag `v3-stable`)
- **WAL append and replay.** Append: `Server::write_wal` in `engine/src/engine_server.cpp` (calls `WalWriter::append`, `engine/src/wal.cpp`). Replay: the `Server` constructor calls `wal_recover` (`engine/src/wal.cpp`) with `apply_record` (`engine/include/replay.hpp`), which feeds orders, cancels, amends, resets and reference prices into the same `Exchange` code as live. That restores the order book, the trade counter and the accounts (state hash covers last_seq, next trade id and every resting order). The trade history in `tickforge_db` is written by exchange-api, not replayed; the demo compares the trade counts in both places.
- **`wal_status` command.** New engine command, answered through the same job queue as `state_hash` (so the hash and sequence are read on the matching thread, as they must be). It takes no lock; the counters are relaxed atomics and the WAL size comes from the file system. `frames_written` is every frame in the file (recovered plus appended). `crc_errors` is 1 when recovery cut a damaged tail frame, else 0 (the WAL format was not touched to count more).
- **Restart on crash only with `TICKFORGE_DEMO=1`.** The supervisor is `build.sh` itself (its watch loop). Without the flag it behaves exactly as before (any dead process stops the stack); with it, a dead engine is restarted within about 0.2 s on the same port and WAL, and `.run/data/supervisor.json` records the engine PID, restart count and restart time.
- **Kill only the supervisor's PID.** exchange-api reads the engine PID from `supervisor.json`, checks `/proc/<pid>/cmdline` really is an `engine_server`, and sends SIGKILL to that PID. No name search anywhere.
- **Own connection for demo reads.** Snapshots use a fresh TCP connection to the engine, not the shared client, so they keep working while the shared client is reconnecting after the crash.
- **Demo blocks every writer to the engine log.** While a demo runs, `place_order`, `cancel_order`, `amend_order`, `reset_traders` and the reference seeding are refused (`409 recovery demo in progress`), because any of them would change `last_sequence` between the two snapshots.
- **Quiesce also drains the database queue.** Besides engine queue depth 0 and `last_sequence` stable for 500 ms, a barrier marker goes through the persist queue so trade and order counts in `tickforge_db` are final before the BEFORE snapshot.
- **A restart must be proved.** The AFTER status only counts if `last_recovery.recovered_at` is later than the kill time, so an engine that never died cannot give a PASS. `frames_replayed` must also equal the frames in the log before the crash.
- **Traders resume to their earlier state.** The global state is saved at the start and restored in `finally`, also on FAIL or an exception.
- **`wal_status` goes through the job queue** (like `state_hash`) because the hash is read on the matching thread; `frames_written` is one relaxed atomic add per logged frame, the only change on the write path.
- **The 403 check uses a second API.** `verify_recovery_demo.sh` starts a throwaway exchange-api on port 8002 without the flag (no engine, in-memory store), so the real stack keeps demo mode on.
- **"Traders resumed" is observed, not read.** The script checks the engine's frame count grows after the demo without any manual order.
- **Panel layout.** Order books are compared per symbol and virtual traders as one group row; Kapinza has his own row. Display numbers are rounded; the full hash is in the hover title.
- **Branch.** Commits carry no attribution trailer, as the job rules say.

### Not completed and why
- `./build.sh bench` was not run: the matching hot path logic did not change; the only change on the write path is one relaxed atomic increment per frame. TSan and ASan engine tests ran inside `./build.sh test` and passed.
- Panel not checked in a real browser in this run; it is covered by the render tests (demo off, API error, PASS, FAIL) and by the API checks in the verify script.

## Final polish decisions
- Phase C: market-data saves each successful quote to `$TICKFORGE_DATA_DIR/market_snapshot.json` and serves it with `"offline": true` when Yahoo fails or `TICKFORGE_OFFLINE=1`; the market panel shows "Using saved prices (offline)". With no saved entry the old error panel stays.
- Phase C: manual order limits are 1 to 10,000 shares (matches the engine's max_qty) and price above 0 with at most 2 decimals; the rate limit (10 per second per client) applies to manual orders (trader 0 and Kapinza) only; virtual-trader ids sent through the API are not limited.
- Phase C: tests that used a 20,000-share order to get an engine reject now use an unaffordable BUY (insufficient_cash), because 20,000 shares is refused earlier with 422.
- Phase C: scripts/verify_recovery_demo.sh sleeps 0.15 s between its 24 orders to stay under the rate limit.
- Phase C: panels already had loading, empty and error states (checked EngineSection, ExchangeSection, MyOrders, TradingActivity, OrderTicket); no change needed.
- Phase E: the Report is a section of the dashboard page (nav item "Report", lazy loaded), like the other tabs. Fill rate = orders with a fill / orders; symbol split counts orders; "open" is added as a fifth order outcome so the shares add up; reports with fewer than 10 fills show "Place more orders to see this report". "Download report" opens a plain print page built from the same reply.
