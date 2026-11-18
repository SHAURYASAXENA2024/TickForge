# Benchmarks

Written by `./build.sh bench`. The numbers below are the engine benchmark's own output,
measured on the machine described here; they will differ on other machines.

## Machine

| | |
|---|---|
| Date (UTC) | 2026-11-18 19:40 |
| CPU | 12th Gen Intel(R) Core(TM) i5-12450H |
| Logical cores | 12 |
| Memory | 7.6 GiB |
| OS | Linux 6.18.58.1-microsoft-standard-WSL2 |
| Compiler | c++ (Ubuntu 15.2.0-16ubuntu1) 15.2.0 |
| Build type | Release |
| Source commit | 0436b3d |

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
| lock-free | 1 | 1.63 | 81 | 16843 |
| mutex | 1 | 2.50 | 115 | 962 |
| elastic ring | 1 | 12.10 | 35 | 126 |
| lock-free | 2 | 3.33 | 74 | 1735 |
| mutex | 2 | 4.43 | 49 | 3399 |
| elastic ring | 2 | 11.49 | 147 | 227 |
| lock-free | 4 | 3.08 | 556 | 4913 |
| mutex | 4 | 3.97 | 64 | 25041 |
| elastic ring | 4 | 17.34 | 188 | 301 |
| lock-free | 8 | 2.07 | 1403 | 26372 |
| mutex | 8 | 3.53 | 71 | 46471 |
| elastic ring | 8 | 4.77 | 350 | 2494 |

## Queue burst: consumer starts 20 ms late

4 producers, 250000 items each. Elastic rings are sized so the burst fits (2^21 slots), half fits (2^18), or barely fits at all (2^8).

| Queue | enqueue P50 (ns) | enqueue P99 (ns) | Drain (ms) | Items through overflow |
|---|---|---|---|---|
| lock-free list | 673 | 5026 | 353.5 | every item is a heap node |
| elastic ring 2^21 | 242 | 611 | 70.2 | 0 |
| elastic ring 2^18 | 183 | 642 | 42.0 | 187588 |
| elastic ring 2^8 | 218 | 704 | 153.4 | 999744 |

## Order book: std::map vs dense array

1000000 operations (about 10% cancels) on one symbol, prices within +-10 cents of a drifting mid price. One thread.

| Book | Throughput (M ops/s) | P50 (ns) | P99 (ns) | Trades |
|---|---|---|---|---|
| MapBook (std::map) | 7.65 | 145 | 538 | 822471 |
| DenseBook (array) | 11.09 | 109 | 524 | 822471 |

## WAL append: write() vs io_uring

200000 frames per run, 5 runs each, taking turns, one thread, no fsync. One frame per system call and the call waits for the result, because the engine must not acknowledge an order before its frame is written. Per-call time includes about 20-30 ns for reading the clock.

| Backend | P50 (ns) | P99 (ns) | P99.9 (ns) | Frames/s |
|---|---|---|---|---|
| write() | 681 | 2474 | 8609 | 949781 |
| io_uring | 45483 | 101904 | 440073 | 20128 |

## Whole server, by engine flag

Measured over TCP by `engine/bench/server_bench.cpp`. RTT is send to ack. The matcher columns are
the server's own numbers, from queue push to matching finished; they show a backlog when the load is
more than the matching thread can take.

### Core pinning

4 connections, 30000 orders per run, 30 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| unpinned | 2000 | 1993 to 2000 | 134.3 | 664.8 | 2104.1 | 50.2 | 704.0 | 271 to 2367 |
| pinned | 2000 | 1998 to 2000 | 137.8 | 657.8 | 2044.8 | 47.2 | 675.7 | 344 to 1008 |

4 connections, 200000 orders per run, 7 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| unpinned | 14221 | 13109 to 15494 | 229.6 | 1115.4 | 1950.6 | 2704650.2 | 3892993.9 | 3572768 to 4208848 |
| pinned | 14792 | 13664 to 15510 | 223.7 | 1054.6 | 1732.8 | 2368426.4 | 3635694.6 | 3467447 to 3854079 |

### WAL writes

4 connections, 30000 orders per run, 9 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| write() | 2000 | 2000 to 2000 | 127.2 | 658.8 | 2454.2 | 46.1 | 674.6 | 375 to 1330 |
| io_uring | 2000 | 2000 to 2000 | 229.4 | 1061.0 | 2952.4 | 47.7 | 300.7 | 246 to 484 |

4 connections, 200000 orders per run, 5 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| write() | 13982 | 12588 to 15837 | 227.7 | 1189.0 | 2019.2 | 2657739.6 | 4049016.0 | 3814865 to 4294967 |
| io_uring | 7263 | 6498 to 7845 | 133.7 | 3807.1 | 6776.7 | 29.3 | 1658.3 | 668 to 8514 |

### Replication

4 connections, 30000 orders per run, 9 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| no replication | 2000 | 1993 to 2000 | 168.4 | 884.7 | 3137.7 | 53.9 | 953.2 | 436 to 5723 |
| --replicate, no follower | 2000 | 2000 to 2000 | 154.1 | 904.8 | 3117.6 | 53.4 | 905.9 | 522 to 1982 |
| with a follower | 1996 | 1994 to 2000 | 191.4 | 819.7 | 2706.9 | 51.0 | 431.4 | 414 to 1876 |

with a follower: the follower had every order 1 ms after the last ack (median; includes waiting for its own matcher to finish).

4 connections, 200000 orders per run, 5 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| no replication | 13503 | 12775 to 14075 | 239.5 | 1183.2 | 2302.8 | 2688090.3 | 3953720.3 | 3412576 to 4077833 |
| with a follower | 9660 | 9393 to 10030 | 335.2 | 1635.1 | 2687.9 | 2717.9 | 55406.3 | 7677 to 151056 |

with a follower: the follower had every order 1 ms after the last ack (median; includes waiting for its own matcher to finish).

### Queue

4 connections, 30000 orders per run, 9 runs per configuration, paced at 2000 orders/s in total. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| lock-free list | 2000 | 2000 to 2000 | 141.4 | 798.9 | 3120.5 | 50.3 | 1008.4 | 350 to 1854 |
| elastic ring | 2000 | 2000 to 2000 | 163.8 | 861.4 | 3096.8 | 53.5 | 1060.9 | 416 to 5729 |

4 connections, 200000 orders per run, 5 runs per configuration, closed loop, as fast as possible. Median over the runs; throughput also shows the slowest and fastest run.

| Configuration | Throughput (orders/s) | Range | RTT P50 (us) | RTT P99 (us) | RTT P99.9 (us) | Matcher P50 (us) | Matcher P99 (us) | Matcher P99 range |
|---|---|---|---|---|---|---|---|---|
| lock-free list | 19201 | 16070 to 20050 | 180.4 | 785.4 | 1193.0 | 1955211.1 | 3320197.0 | 3011476 to 4071555 |
| elastic ring | 19887 | 15996 to 20229 | 167.5 | 767.6 | 1175.9 | 1925882.3 | 3319752.8 | 3234568 to 4109994 |

### SSTable and compaction writes: normal path vs io_uring

Median of 11 runs. Writing includes fsync and rename. One thread, nothing else running. O_DIRECT on this file system: used.

| Operation | Normal write (ms) | io_uring (ms) |
|---|---|---|
| Write 10,000 trades | 6.3 | 7.0 |
| Write 1,000,000 trades | 157.7 | 184.3 |
| Compact 7 tables, 14,000 trades | 14.3 | 15.9 |


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
