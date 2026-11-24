# Five-minute demo

## Before you start
```bash
TICKFORGE_DEMO=1 ./build.sh        # leave it running; open http://localhost:8443
```
Wait until it prints the four URLs. Check the green LIVE badge at the top.

## Script
**0:00 What it is.** Say: "TickForge is a small stock exchange: a C++ matching engine, a write-ahead log and a Rust database. The traders are simulated; the reference prices are real Yahoo prices." Point at the *Simulated* and *Paper money* badges.

**0:45 Engine tab.** Show the live order book and latency numbers. Say: "Orders go through a lock-free queue to one matching thread, with price-time priority."

**1:30 Place an order.** In the Order ticket choose AAPL, Buy, 10 shares, keep the reference price, click *Review order*, then *Confirm and send*. Open *My orders* and show it. Say: "Kapinza is the manual trader; the other 24 are virtual."

**2:15 Validation.** Type 10001 shares: the inline message appears. Say: "Limits are 1 to 10,000 shares and 10 orders per second."

**2:45 Crash recovery panel.** Click the kill button and confirm. Say: "The engine is killed with SIGKILL. It restarts and replays the WAL." Show PASS with equal state hash and last sequence. Say the honest limit: "This covers a process crash, not a power cut."

**4:00 Benchmarks.** Open `docs/BENCHMARKS.md` or How'z that. Say: "The mutex queue has higher throughput. The lock-free queue has the lower P99 at 4 and 8 producers."

**4:30 Close.** Open the Status section: services reachable, trades saved in the database.

## Backup plan
- **No network:** `TICKFORGE_OFFLINE=1 TICKFORGE_REFERENCE=snapshot TICKFORGE_DEMO=1 ./build.sh`. The UI shows saved prices and says "Using saved prices (offline)" where a chart needs them.
- **Demo panel fails:** run `./build.sh kill9` in a terminal and show the identical hashes, or run `scripts/verify_recovery_demo.sh`.
- **Stack will not start:** show the recorded output of `./build.sh test` and `./build.sh kill9` (keep a screen recording of one good run).

## What not to claim
- Not power-loss safe. Not real trading: trades and money are simulated.
- Not "lock-free is faster": it has the better tail latency at higher contention, not better throughput.
- No B+tree baseline, no timer-driven background compaction, no automatic failover.
