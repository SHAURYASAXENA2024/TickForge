# Limitations

- **No fsync on the WAL.** Recovery covers a process crash (`kill -9`), not a power cut or kernel crash.
- **Dense order book not used.** The server uses the `std::map` book; the dense-array book is built and tested but only benchmarked.
- **Mutex queue has higher throughput.** The lock-free queue wins only on tail latency at 4 and 8 producers (`docs/BENCHMARKS.md`).
- **Yahoo data is delayed up to 15 minutes**, and when the market is closed it is the last close.
- **Trades are simulated.** Virtual traders use paper money; only the reference price level is real.
- **Memtable is a B-tree map**, not a skip list; compaction runs on flush, not on a timer thread; `get_trade` scans a table when the Bloom filter says maybe.
- **No B+tree baseline.** The only database comparison is MySQL, for trade inserts only, run once on a WSL2 disk whose fsync is not representative.
- **Scheduling is in exchange-api**, not in the engine.
- **Stop and stop-limit orders** are held in memory in exchange-api and are lost if it restarts (API only, no UI).
- **Replication is asynchronous**, localhost only, with no automatic failover.
- **Crash recovery demo** needs `TICKFORGE_DEMO=1` and blocks order entry while it runs.
- **Rate limit** is per client address and only on manual orders; the order book is per symbol, 10 symbols.
- **Benchmarks** come from one WSL2 laptop, unpinned threads, and will differ elsewhere.
- **No database triggers.** Alerts are evaluated in exchange-api on every trade and tick, and saved to a JSON file; they are not an LSM-level trigger mechanism.
- **Replay uses default engine settings.** `wal_replay` replays with the default account and self-trade settings; an engine started with other `--start-*` flags would not give matching hashes.
