# Viva questions and honest answers

Every answer is backed by a test or a document in this repository; see [CLAIMS_AUDIT.md](CLAIMS_AUDIT.md).

**1. What is TickForge?** A small stock exchange built to study the critical path of order matching: a C++ engine, a write-ahead log, a Rust LSM database, a Python service with 24 virtual traders, and a React dashboard.

**2. What is on the critical path?** Connection threads parse and validate an order, write it to the WAL, acknowledge it and push it onto a lock-free queue. One matching thread takes it off the queue and matches it.

**3. Why a write-ahead log?** An order is acknowledged only after it is in the log. After a crash the engine replays the log and rebuilds the same books.

**4. How do you prove recovery works?** `./build.sh kill9` sends 20,000 orders, kills the engine with `kill -9`, restarts it and compares a state hash and the last sequence number before and after: both are identical (`69a6a28ee55e622b`, sequence 20000). `engine/tests/wal_recovery_test.cpp` also cuts the file at every byte and flips bits. The Crash recovery panel does the same live (`scripts/verify_recovery_demo.sh`).

**5. Does it survive power loss?** No. The WAL write is not followed by `fsync`, so it survives a process crash but not a power cut. This is documented in the README and in LIMITATIONS.md.

**6. Why lock-free?** To avoid a producer stalling while another holds a lock. The queue is a multi-producer, single-consumer linked list, stress-tested with 8 producers and 1.6 million messages (nothing lost, nothing duplicated, per-producer order kept) and clean under ThreadSanitizer and AddressSanitizer.

**7. Is lock-free faster?** Not in throughput. In `docs/BENCHMARKS.md` the mutex queue has higher throughput at every producer count. The lock-free queue has the lower P99 enqueue latency at 4 producers (4,640 ns against 22,904 ns) and 8 producers (32,749 against 47,193 ns). At 1 and 2 producers the mutex queue is as good or better. We claim a better tail at higher contention, not higher speed.

**8. What is the elastic ring queue?** An optional ring plus overflow queue (`--queue elastic`). It is much faster alone, but makes no measurable difference through the whole server, so it is not the default.

**9. How does price-time priority work?** The best price matches first; at the same price the earlier order matches first. Tested in `engine/tests/order_book_tests.cpp`.

**10. Self-trade prevention?** An order that would match a resting order of the same trader is not matched against it; tested in the self-trade cases of `order_book_tests`.

**11. What is cash reservation?** With `--accounts` the engine locks cash for a buy and shares for a sell when the order rests, releases the difference on price improvement and on cancel, and rejects an order that cannot be afforded. Tested in `accounts_test.cpp`, including exact WAL replay.

**12. Round-robin scheduling?** exchange-api dispatches orders from the 24 traders in turn, with manual orders first. It lives in exchange-api, not inside the engine (`test_scheduling.py`).

**13. What storage design does the database use?** An LSM tree: a memtable (a B-tree map, not a skip list), a log for the memtable, flushes to sorted SSTables, and compaction that merges tables of similar size.

**14. What do Bloom filters do here?** Each SSTable has a Bloom filter on trade id so a lookup can skip a table that cannot contain it. Tests check no false negatives and a low false-positive rate.

**15. What is the time-range index?** Each SSTable keeps a sparse index (every 64th record: timestamp, id, file offset), so a range query jumps near its start instead of scanning the table.

**16. Does compaction run in the background?** It runs when tables are flushed and choose to merge, not on a timer thread. We call it compaction, not "background compaction".

**17. How does it compare with MySQL?** `docs/benchmarks/mysql.md` (MySQL 8.4, InnoDB) compares storing trade records only. TickForge acknowledges before fsync, so the fair MySQL rows use `flush=2`. MySQL gives SQL, indexes, transactions and replication tooling that we do not. No B+tree baseline was built.

**18. Where do prices come from?** Reference prices are real Yahoo Finance prices (delayed up to 15 minutes) read through market-data. Trades are simulated: the 24 virtual traders quote around that reference with paper money.

**19. What if Yahoo is down?** exchange-api falls back to saved reference prices, and market-data serves its saved snapshot with an "offline" flag; the UI says "Using saved prices (offline)". `TICKFORGE_OFFLINE=1` forces this.

**20. What is simulated?** The traders, their orders, all trades and all money. Only the price level is real.

**21. How are integers used?** Prices and cash are integer cents everywhere except on screen, so there is no floating-point rounding in matching or P&L.

**22. What happens when the engine dies?** exchange-api reconnects. The dashboard shows a connection banner and clears it when the engine is back. With `TICKFORGE_DEMO=1`, `build.sh` restarts the engine on the same port and WAL.

**23. Is there replication?** Optional leader-to-follower WAL shipping on localhost (`--replicate`, `--follow`), tested to the same state hash. It is asynchronous and has no automatic failover.

**24. What are the manual order limits?** 1 to 10,000 whole shares, price above 0 with at most 2 decimals, a known symbol, and at most 10 orders per second per client.

**25. What would you do next?** `fsync` with group commit, use the dense order book in the server, timer-driven compaction, and a B+tree baseline. See LIMITATIONS.md.
