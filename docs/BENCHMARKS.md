# Benchmarks

Written by `./build.sh bench`. The numbers below are the engine benchmark's own output,
measured on the machine described here; they will differ on other machines.

## Machine

| | |
|---|---|
| Date (UTC) | 2026-11-19 03:13 |
| CPU | 12th Gen Intel(R) Core(TM) i5-12450H |
| Logical cores | 12 |
| Memory | 7.6 GiB |
| OS | Linux 6.18.58.1-microsoft-standard-WSL2 |
| Compiler | c++ (Ubuntu 15.2.0-16ubuntu1) 15.2.0 |
| Build type | Release |
| Source commit | e63696c |

## Results

# Benchmark run

- CPU: 12th Gen Intel(R) Core(TM) i5-12450H
- Logical cores: 12
- Compiler: 15.2.0
- Flags: -std=c++17 -O3 -DNDEBUG
- Threads are not pinned to cores.

## Queue: lock-free vs mutex

Items per producer: 200000. One consumer thread. Latency is the time inside `enqueue()`.

| Queue | Producers | Throughput (M items/s) | enqueue P50 (ns) | enqueue P99 (ns) |
|---|---|---|---|---|
| lock-free | 1 | 1.78 | 94 | 3689 |
| mutex | 1 | 2.53 | 51 | 3314 |
| elastic ring | 1 | 10.70 | 39 | 122 |
| lock-free | 2 | 3.20 | 74 | 2196 |
| mutex | 2 | 4.32 | 49 | 2303 |
| elastic ring | 2 | 11.37 | 98 | 223 |
| lock-free | 4 | 2.89 | 639 | 4640 |
| mutex | 4 | 4.25 | 58 | 22904 |
| elastic ring | 4 | 17.66 | 182 | 300 |
| lock-free | 8 | 1.95 | 1850 | 32749 |
| mutex | 8 | 3.55 | 71 | 47193 |
| elastic ring | 8 | 5.70 | 403 | 4069 |

## Queue burst: consumer starts 20 ms late

4 producers, 250000 items each. Elastic rings are sized so the burst fits (2^21 slots), half fits (2^18), or barely fits at all (2^8).

| Queue | enqueue P50 (ns) | enqueue P99 (ns) | Drain (ms) | Items through overflow |
|---|---|---|---|---|
| lock-free list | 539 | 4083 | 317.5 | every item is a heap node |
| elastic ring 2^21 | 147 | 366 | 48.4 | 0 |
| elastic ring 2^18 | 184 | 482 | 36.5 | 121370 |
| elastic ring 2^8 | 228 | 868 | 156.4 | 999744 |

## Order book: std::map vs dense array

1000000 operations (about 10% cancels) on one symbol, prices within +-10 cents of a drifting mid price. One thread.

| Book | Throughput (M ops/s) | P50 (ns) | P99 (ns) | Trades |
|---|---|---|---|---|
| MapBook (std::map) | 8.41 | 142 | 544 | 822471 |
| DenseBook (array) | 10.91 | 113 | 589 | 822471 |

## WAL append: write() vs io_uring

200000 frames per run, 5 runs each, taking turns, one thread, no fsync. One frame per system call and the call waits for the result, because the engine must not acknowledge an order before its frame is written. Per-call time includes about 20-30 ns for reading the clock.

| Backend | P50 (ns) | P99 (ns) | P99.9 (ns) | Frames/s |
|---|---|---|---|---|
| write() | 670 | 2502 | 6359 | 960419 |
| io_uring | 45523 | 99119 | 712985 | 20245 |

## Whole server, by engine flag

Measured over TCP by `engine/bench/server_bench.cpp`. RTT is send to ack. The matcher columns are
the server's own numbers, from queue push to matching finished; they show a backlog when the load is
more than the matching thread can take.

### Core pinning

4 connections, 30000 orders per run, 30 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| unpinned | 2000 | 1992 to 2000 | 125.5 | 553.7 | 1903.7 | 44.7 | 642.2 | 303 to 1064 |
| pinned | 2000 | 1992 to 2000 | 125.8 | 538.8 | 1839.6 | 40.0 | 514.1 | 380 to 1249 |

4 connections, 200000 orders per run, 7 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| unpinned | 16295 | 16195 to 16682 | 203.2 | 956.6 | 1449.9 | 2303114.9 | 4028252.1 | 3983389 to 4047326 |
| pinned | 16500 | 16087 to 16946 | 201.8 | 954.3 | 1443.3 | 2343950.9 | 4046695.2 | 3989852 to 4099251 |

### WAL writes

4 connections, 30000 orders per run, 9 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| write() | 2000 | 1999 to 2000 | 123.3 | 541.4 | 1941.7 | 45.2 | 676.2 | 329 to 1156 |
| io_uring | 2000 | 1992 to 2000 | 183.0 | 843.8 | 2611.8 | 45.1 | 242.5 | 179 to 376 |

4 connections, 200000 orders per run, 5 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| write() | 16335 | 16027 to 16941 | 198.5 | 968.2 | 1481.1 | 2279671.8 | 4010861.4 | 3858931 to 4121520 |
| io_uring | 8717 | 8700 to 8767 | 108.7 | 3561.6 | 6153.9 | 26.6 | 587.3 | 548 to 1225 |

### Replication

4 connections, 30000 orders per run, 9 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| no replication | 2000 | 1999 to 2000 | 116.9 | 527.7 | 1971.5 | 43.4 | 524.0 | 385 to 728 |
| --replicate, no follower | 2000 | 1993 to 2000 | 117.4 | 554.7 | 2035.9 | 43.5 | 562.4 | 390 to 989 |
| with a follower | 1995 | 1994 to 2000 | 152.5 | 539.9 | 1982.3 | 46.8 | 312.0 | 241 to 436 |

with a follower: the follower had every order 1 ms after the last ack (median; includes waiting for its own matcher to finish).

4 connections, 200000 orders per run, 5 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| no replication | 16085 | 14720 to 16288 | 206.7 | 967.3 | 1465.9 | 2338686.2 | 3942940.1 | 3877060 to 4083755 |
| with a follower | 10946 | 10609 to 11049 | 306.8 | 1382.9 | 2087.9 | 390529.6 | 513451.0 | 471280 to 757469 |

with a follower: the follower had every order 1 ms after the last ack (median; includes waiting for its own matcher to finish).

### Queue

4 connections, 30000 orders per run, 9 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| lock-free list | 2000 | 1998 to 2000 | 122.5 | 575.8 | 1941.6 | 41.4 | 717.0 | 348 to 889 |
| elastic ring | 2000 | 1992 to 2000 | 124.6 | 514.6 | 1873.1 | 46.7 | 518.4 | 439 to 1112 |

4 connections, 200000 orders per run, 5 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| lock-free list | 16646 | 16192 to 16756 | 194.7 | 952.6 | 1435.0 | 2258495.3 | 3992689.6 | 3936043 to 4053326 |
| elastic ring | 16409 | 16134 to 16575 | 210.6 | 947.9 | 1439.5 | 2359326.6 | 4060447.0 | 4004724 to 4155580 |

### SSTable and compaction writes: normal path vs io_uring

Median of 11 runs. Writing includes fsync and rename. One thread, nothing else running. O_DIRECT on this file system: used.

| Operation | Normal write (ms) | io_uring (ms) |
|---|---|---|
| Write 10,000 trades | 10.0 | 11.9 |
| Write 1,000,000 trades | 276.5 | 318.1 |
| Compact 7 tables, 14,000 trades | 16.2 | 19.6 |


## First run, kept for reference

The research pages quote these numbers. They are the first benchmark, before any of the optional features, and will not change when `./build.sh bench` runs again.

| | |
|---|---|
| Date (UTC) | 2026-11-03 09:57 |
| CPU | 12th Gen Intel(R) Core(TM) i5-12450H |
| Logical cores | 12 |
| Memory | 7.6 GiB |
| OS | Linux 6.18.54.1-microsoft-standard-WSL2 |
| Compiler | c++ (Ubuntu 15.2.0-16ubuntu1) 15.2.0 |
| Build type | Release |
| Source commit | 6b163a6 |

### Queue: lock-free vs mutex

Items per producer: 200000. One consumer thread. Latency is the time inside `enqueue()`.

| Queue | Producers | Throughput (M items/s) | enqueue P50 (ns) | enqueue P99 (ns) |
|---|---|---|---|---|
| lock-free | 1 | 2.07 | 87 | 6086 |
| mutex | 1 | 2.85 | 62 | 3000 |
| lock-free | 2 | 3.98 | 64 | 1692 |
| mutex | 2 | 5.70 | 40 | 2254 |
| lock-free | 4 | 3.70 | 432 | 3920 |
| mutex | 4 | 4.99 | 45 | 20564 |
| lock-free | 8 | 2.41 | 1289 | 26537 |
| mutex | 8 | 3.66 | 74 | 45319 |

### Order book: std::map vs dense array

1000000 operations (about 10% cancels) on one symbol, prices within +-10 cents of a drifting mid price. One thread.

| Book | Throughput (M ops/s) | P50 (ns) | P99 (ns) | Trades |
|---|---|---|---|---|
| MapBook (std::map) | 10.12 | 114 | 402 | 822471 |
| DenseBook (array) | 14.82 | 84 | 347 | 822471 |

## TickForge database vs MySQL

Written by `./build.sh bench-mysql` (`bench/mysql_baseline/`). This compares a narrow job, storing fixed-schema trade records. It says nothing about general database quality: MySQL also provides SQL, secondary indexes, multi-row transactions, replication tooling and backups, and TickForge's database provides none of those.

| | |
|---|---|
| Date (UTC) | 2026-11-03 19:34 |
| MySQL | Ver 8.4.11-0ubuntu0.26.04.1, from the Ubuntu packages, InnoDB |
| MySQL settings, all runs | `--innodb-buffer-pool-size=1G --innodb-redo-log-capacity=1G --skip-networking --mysqlx=OFF --performance-schema=OFF --secure-file-priv=NULL`, everything else default |
| Client | One Rust thread. MySQL over a Unix socket (`mysql` crate); TickForge called in-process |
| Disk | ext4 on the WSL2 virtual disk, `.run/`, same disk for both systems |
| Kernel | 6.18.54.1-microsoft-standard-WSL2 |
| Workload | 200,000 trades one per commit (5,000 for fsync MySQL), and 200,000 trades in commits of 100; same generator, 9 columns, primary key on `trade_id` |
| Repeats | 3 runs, median shown |

Latency is per commit: `insert_trade` returning, or `COMMIT` returning. TickForge has no multi-insert, so its "commit of 100" is 100 single inserts, each written to its log. MySQL commits are autocommit `INSERT`s, one socket round trip each. CPU includes mysqld and the client. Bytes are what the disk received (`/proc/diskstats`, file system journal included) until dirty pages, the memtable and the page cache were written out, on an otherwise idle machine.

**Compare like with like.** TickForge's database acknowledges before an fsync, so the fair MySQL rows are the two with `flush=2`. The `flush=1` row is stronger than anything TickForge offers and is shown for reference only. fsync speed on a WSL2 virtual disk is not representative of a real NVMe drive.

| System | A commit means | Trades per commit | Trades/s | P50 (us) | P99 (us) | P99.99 (us) | CPU per trade (us) | Bytes written per trade |
|---|---|---|---|---|---|---|---|---|
| TickForge database (LSM) | page cache: survives a process crash, not a power cut | 1 | 291,675 | 1.1 | 3.9 | 7,451.4 | 2.5 | 130 |
| TickForge database (LSM) | page cache: survives a process crash, not a power cut | 100 | 349,098 | 105.7 | 6,938.0 | 76,445.2 | 2.2 | 130 |
| MySQL, no binlog, flush=2 | page cache: survives a process crash, not a power cut | 1 | 3,990 | 185.1 | 952.2 | 17,186.0 | 240.3 | 736 |
| MySQL, no binlog, flush=2 | page cache: survives a process crash, not a power cut | 100 | 51,692 | 1,023.2 | 10,512.4 | 86,304.8 | 13.8 | 537 |
| MySQL, binlog, flush=2, sync_binlog=0 | page cache: survives a process crash, not a power cut | 1 | 5,312 | 163.9 | 435.4 | 6,725.4 | 182.0 | 1,216 |
| MySQL, binlog, flush=2, sync_binlog=0 | page cache: survives a process crash, not a power cut | 100 | 83,584 | 894.4 | 7,200.3 | 37,615.4 | 11.0 | 612 |
| MySQL, binlog, flush=1, sync_binlog=1 | fsync: also survives a power cut (stronger than TickForge) | 1 | 142 | 6,728.9 | 12,339.1 | 22,960.8 | 1594.0 | 39,397 |
| MySQL, binlog, flush=1, sync_binlog=1 | fsync: also survives a power cut (stronger than TickForge) | 100 | 8,475 | 11,404.2 | 19,844.6 | 55,481.6 | 38.3 | 1,182 |

### Recovery after kill -9, 99,999 trades stored

Time from process start to "ready", and every trade verified present afterwards. The database's open reads all its SSTables and replays 9,999 trades from its log; MySQL's clean restart shows how much of its time is normal startup. The database has no clean shutdown, so it always takes the same path.

| System | After kill -9 (s) | After clean stop (s) |
|---|---|---|
| TickForge database (LSM) | 0.04 | same path |
| MySQL, no binlog, flush=2 | 3.31 | 1.02 |
| MySQL, binlog, flush=2, sync_binlog=0 | 3.60 | 0.90 |
| MySQL, binlog, flush=1, sync_binlog=1 | 2.18 | 1.13 |

MyRocks, which the project document suggests as the closest baseline, is not in the Ubuntu packages and was not run.
