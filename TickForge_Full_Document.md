# TickForge: Problem Statement, Differentiators and Research Foundation

<!-- Page 1 -->

TickForge: Problem Statement, Differentiators and
 Research Foundation
A low-latency mini stock exchange with a lock-free matching engine, an LSM-tree storage engine built from scratch,
and a behavior-aware trading UI.
1. Overview
TickForge is an integrated systems project. Multiple threads submit buy and sell orders through a lock-free
multi-producer single-consumer (MPSC) queue built on atomic compare-and-swap (CAS). One matching-engine
thread matches orders on a limit order book using price-time priority. Every executed trade is made durable through a
write-ahead log (WAL) into a custom LSM-tree storage engine with background compaction, time-range indexing,
Bloom filters and event-driven triggers for alerts. The frontend and market-data service run on FastAPI.
2. Problem Statement
Existing exchange-style projects and many real systems suffer from two groups of problems.
Systems problems

Mutex-based queues and memtables cause blocking and unpredictable latency.

Orders are serialized and copied between components (queue, engine, log), wasting CPU cycles and polluting
caches.

Pointer-heavy order books cause cache misses on the hottest code path.

LSM compaction causes latency spikes (the "compaction wall") that hurt the matching path.

After a crash, memory state and stored state can disagree, so recovery is not exact.

The OS scheduler, the kernel network stack and the page cache add jitter to tail latency (P99 and P99.99).
User-behavior problems

Retail users who check profit and loss too often see small dips, feel loss pain more strongly than gains, and
panic-sell (myopic loss aversion).

Chart design, especially a narrow Y-axis, changes how risky an asset feels.

Showing only returns encourages greed and over-leverage. Showing only losses discourages participation. Neither
supports good decisions.
Problem statement in one line: Build an exchange that keeps predictable, low tail latency on the critical path,
recovers exactly after failure, and presents risk and return in a way that helps users decide better.
3. Differentiators and How We Solve Each Problem
A. Systems differentiators
#
Differentiator
Problem it solves
How TickForge solves it
1
Zero-copy fixed-width binary
pipeline
Serialization and copying between
queue, engine and WAL
One fixed-width struct layout is used in the MPSC queue, the engine
and the WAL frame, so bytes are written to the log without conversion
2
Lock-free MemTable (atomic
skip list)
Mutex contention between
ingestion and flush
Skip list with atomic pointers and CAS, so the flush thread reads while
the engine writes without stalling it
3
Cache-conscious
dense-array order book
Pointer chasing and cache misses
Price levels pre-allocated in contiguous, cache-aligned arrays indexed
by price tick, which suits the hardware prefetcher
4
Activity-aware compaction
Compaction latency spikes
Compaction rate is throttled by MPSC queue depth, runs harder in
quiet periods and backs off in bursts
5
Deterministic replay and
crash recovery
Memory and storage diverge after
a crash
Every input is sequence-numbered and logged. Recovery loads a
snapshot and replays the same inputs to reach the exact pre-crash
state
6
Core affinity and isolation
Scheduler jitter and context
switches
The matching thread is pinned to an isolated core. Compaction and I/O
run on other cores or NUMA nodes
7
Inline pre-trade risk checks
Extra hop for a separate risk
service
Limit checks run on the fixed-layout order header before it enters the
matching loop

---

<!-- Page 2 -->

#
Differentiator
Problem it solves
How TickForge solves it
8
Elastic dual-ring ingestion
Fixed ring overflow in bursts
A fast ring for normal flow plus an overflow segmented buffer, with
depth monitoring and non-blocking handoff
9
eBPF/XDP ingestion
(advanced)
Kernel network stack overhead
An XDP program filters order packets early and delivers them toward
user space with less overhead (AF_XDP)
10
io_uring with O_DIRECT
compaction (advanced)
Page-cache copies and blocking
I/O during compaction
Asynchronous batched I/O to the NVMe device, bypassing the page
cache
B. Behavioral and UX differentiators
#
Feature
Behavioral problem
How TickForge solves it
11
Evaluation-window toggle ("Daily
Noise" vs "Long-Term Growth")
Myopic loss aversion
The user switches between the daily PnL view and a rolling 30-day or
yearly view, so short-term dips are seen in context
12
Smart Y-axis scaling
Chart scale distorts perceived
risk
The default axis is scaled from the asset's historical volatility so small
moves do not look like crashes
13
Scenario visualizer before order
confirmation
Overconfidence and poor risk
understanding
A graphical distribution of historical outcomes for a similar trade,
shown before the user confirms
14
Dual framing (return and
drawdown)
One-sided greed or fear
The order page shows historical return potential next to maximum
historical drawdown, and the dashboard shows progress against a
benchmark
C. An honest positioning note
Individual techniques here (core pinning, kernel bypass, io_uring, throttled compaction, deterministic replay) are known
and used in industry, and parts of them exist in research and open-source systems. For example, SILK studies latency
spikes in LSM stores, and RocksDB has io_uring support. So the claim to make is not "nobody has done this". The
defensible claim is: TickForge integrates these techniques in one transparent, from-scratch exchange stack,
measures them against a baseline, and pairs them with a behavior-aware UI. Back every performance claim with
your own benchmarks, such as P50, P99 and P99.99 latency and throughput, with and without each feature. Avoid
unmeasured figures like "sub-nanosecond".
4. Research Foundation
A. Systems papers
Topic
Paper
Why it matters for TickForge
Zero-copy and ring
buffer
Thompson, Farley, Barker, Gee, Stewart (2011). Disruptor: High
performance alternative to bounded queues for exchanging data between
concurrent threads. LMAX. PDF:
https://lmax-exchange.github.io/disruptor/files/Disruptor-1.0.pdf
Pre-allocated ring buffer and single-writer
design for low-latency exchange of data
between threads
Binary encoding
FIX Trading Community. Simple Binary Encoding (SBE) specification.
https://github.com/FIXTradingCommunity/fix-simple-binary-encoding
Fixed-width binary message layout. This is
a FIX standard, not an ISO standard
LSM-tree origin
O'Neil, Cheng, Gawlick, O'Neil (1996). The Log-Structured Merge-Tree
(LSM-Tree). Acta Informatica 33(4)
Foundation of the storage engine, memory
component, merges and compaction
LSM survey
Luo and Carey (2020). LSM-based Storage Techniques: A Survey. The
VLDB Journal. arXiv:1812.07527
Overview of concurrency, flush, merge and
compaction design choices
Compaction latency
spikes
Balmau et al. (2019). SILK: Preventing Latency Spikes in Log-Structured
Merge Key-Value Stores. USENIX ATC
Closest prior work to activity-aware
compaction. Cite it and explain how your
queue-depth throttle differs
Tunable compaction
Dayan and Idreos (2018). Dostoevsky: Better Space-Time Trade-Offs for
LSM-Tree Based Key-Value Stores via Adaptive Removal of Superfluous
Merging. SIGMOD
Merge policy and write amplification
trade-offs
Bloom filters in LSM
Dayan, Athanassoulis, Idreos (2017). Monkey: Optimal Navigable
Key-Value Store. SIGMOD
Allocating Bloom filter memory across
LSM levels
Bloom filter
Bloom (1970). Space/time trade-offs in hash coding with allowable errors.
CACM
Basis of the Bloom filters in SSTables
Skip list
Pugh (1990). Skip lists: a probabilistic alternative to balanced trees. CACM
33(6); and Pugh (1990), Concurrent Maintenance of Skip Lists, tech report
Skip list basics and concurrent
maintenance
Lock-free structures
Fraser (2004). Practical lock-freedom. PhD thesis, University of Cambridge;
Herlihy and Shavit, The Art of Multiprocessor Programming
Lock-free skip list design with CAS, and
correctness reasoning

---

<!-- Page 3 -->

Topic
Paper
Why it matters for TickForge
Lock-free queues
Michael and Scott (1996). Simple, fast, and practical non-blocking and
blocking concurrent queue algorithms. PODC
Background for the CAS-based queue
Cache-conscious
layout
Chilimbi, Davidson, Larus (1999). Cache-conscious structure definition.
PLDI
Cache-aware data layout, supporting the
dense-array order book
Limit order books
Gould et al. (2013). Limit order books. Quantitative Finance 13(11)
Background on order book structure and
behavior
Tail latency
Dean and Barroso (2013). The Tail at Scale. CACM 56(2)
Why P99 and P99.99 matter more than
averages
Value of speed
Budish, Cramton, Shim (2015). The High-Frequency Trading Arms Race.
Quarterly Journal of Economics
Why latency matters in electronic markets
Deterministic replay
Schneider (1990). Implementing fault-tolerant services using the state
machine approach. ACM Computing Surveys 22(4)
Same input sequence leads to the same
state, which is the basis of replay recovery
Replicated log
Ongaro and Ousterhout (2014). In Search of an Understandable
Consensus Algorithm (Raft). USENIX ATC
Optional reading on log-based replication,
if you extend to multiple nodes
Kernel network
bypass
Høiland-Jørgensen et al. (2018). The eXpress Data Path: Fast
Programmable Packet Processing in the Operating System Kernel.
CoNEXT. https://dl.acm.org/doi/10.1145/3281411.3281443
Foundation for the XDP ingestion idea
Asynchronous I/O
Axboe (2019). Efficient IO with io_uring. https://kernel.dk/io_uring.pdf
Design of io_uring for asynchronous disk
I/O
B. Behavioral finance papers
Topic
Paper
Why it matters for TickForge
Myopic loss aversion
Benartzi and Thaler (1995). Myopic Loss Aversion and the Equity Premium
Puzzle. Quarterly Journal of Economics 110(1)
Frequent evaluation makes losses visible
and lowers risk-taking. Supports the
evaluation-window toggle
Myopia experiment
Thaler, Tversky, Kahneman, Schwartz (1997). The Effect of Myopia and
Loss Aversion on Risk Taking: An Experimental Test. Quarterly Journal of
Economics 112(2)
Experimental evidence that less frequent
feedback increases risk-taking
Chart display
Kaufmann, Weber, Haisley (2013). The Role of Experience Sampling and
Graphical Displays on One's Investment Risk Appetite. Management
Science 59(2)
How graphs and experience sampling
change risk perception. Supports smart
axis scaling and the scenario visualizer
Prospect theory
Kahneman and Tversky (1979). Prospect Theory: An Analysis of Decision
under Risk. Econometrica 47(2)
Foundation for loss aversion and the dual
loss and return framing
Overreaction
De Bondt and Thaler (1985). Does the Stock Market Overreact? Journal of
Finance 40(3)
Overreaction and mean reversion in prices
Overtrading
Barber and Odean (2000). Trading Is Hazardous to Your Wealth. Journal of
Finance 55(2)
Overconfidence leads to excess trading
and lower returns. Supports pre-trade risk
context
Source corrections to note. The chart display paper is by Kaufmann, Weber and Haisley, not "Coffman". The "Silu"
paper mentioned earlier is most likely SILK (Balmau et al., USENIX ATC 2019). Please verify every citation and link
against the publisher's page or Google Scholar before submitting, because these were written from memory and some
links may have moved.
5. Evaluation Plan (to back the claims)

Baselines: a mutex-based queue, a mutex skip list memtable, a pointer-based order book, and default compaction.

Metrics: throughput (orders per second), P50, P99 and P99.99 order-to-ack latency, and WAL write latency during
compaction.

Experiments: burst load tests, compaction on and off, pinned and unpinned core, crash and replay tests that
compare state hashes.

UX study (optional): a small user test comparing the evaluation-window toggle and the dual-framing order page
against a plain view, measuring panic exits and confidence.
6. Suggested Implementation Order
1
Complete component integration (queue, engine, WAL, storage, FastAPI).

---

<!-- Page 4 -->

2
Fixed-width structs shared across queue, engine and WAL.
3
Dense-array order book and benchmarks.
4
Activity-aware compaction.
5
Deterministic replay with snapshots.
6
Core pinning, then inline risk checks.
7
Behavioral UI features.
8
Advanced: elastic dual ring, io_uring, XDP.
7. Added Differentiators (Round 2)
Five more features, each written as: current problem, how TickForge solves it, and the research behind it.
15. Cache-line padding (false sharing elimination)

Current problem: CPUs move data in 64-byte cache lines. If two threads write to different variables that sit in the
same line, each write invalidates the other core's copy. This is called false sharing, and it adds hidden jitter to
multi-threaded code. In an MPSC queue the producer-side head and the consumer-side tail are the usual victims.

How we solve it: Put the queue head, tail and per-thread metrics on separate cache lines. In C++ use alignas(64)
(or std::hardware_destructive_interference_size). In Rust use #[repr(align(64))] or crossbeam_utils::CachePadded.

Research: Bolosky and Scott (1993), False Sharing and its Effect on Shared Memory Performance, USENIX
SEDMS. Torrellas, Lam, Hennessy (1994), False Sharing and Spatial Locality in Multiprocessor Caches, IEEE
Transactions on Computers 43(6). Drepper (2007), What Every Programmer Should Know About Memory.
Thompson et al. (2011), Disruptor (padding of sequence counters).
16. Single-writer MemTable with atomic pointer swap

Current problem: In an LSM tree, the matching thread writes new trades to the MemTable while a background
thread reads it to build SSTables. Read-write locks make one side wait for the other, which stalls the live path during
flushes.

How we solve it: Only the matching thread writes to the active MemTable. When it is full, the thread publishes a
fresh empty MemTable with one atomic pointer swap and marks the old one immutable. The flush thread reads the
immutable table with no lock and writes the SSTable to disk.

Research: O'Neil et al. (1996), The Log-Structured Merge-Tree. Luo and Carey (2020), LSM-based Storage
Techniques: A Survey (memtable, flush and concurrency design). Balmau et al. (2019), SILK (flush and compaction
stalls).
17. Busy-spin polling (no thread sleep)

Current problem: A thread that blocks on a lock or condition variable is put to sleep by the OS and needs a
wake-up and a context switch, which adds microseconds and jitter.

How we solve it: The matching thread spins on the queue sequence number on a dedicated, pinned core, so a new
order is picked up as soon as it is published. Use a pause/yield hint in the spin loop and a fallback wait strategy for
the non-critical threads.

Research: Thompson et al. (2011), Disruptor (wait strategies, including busy spin). Belay et al. (2014), IX: A
Protected Dataplane Operating System for High Throughput and Low Latency, OSDI. Peter et al. (2014), Arrakis:
The Operating System is the Control Plane, OSDI. Dean and Barroso (2013), The Tail at Scale.
18. Pre-allocated object pools (no heap allocation at runtime)

Current problem: malloc and new on the hot path can take locks, fragment memory and have variable latency.

How we solve it: Allocate order, trade and price-level objects once at startup in fixed-size pools (slab or arena).
The hot path only takes and returns slots from a free list, so no heap call happens while trading.

Research: Bonwick (1994), The Slab Allocator: An Object-Caching Kernel Memory Allocator, USENIX Summer.
Berger et al. (2000), Hoard: A Scalable Memory Allocator for Multithreaded Applications, ASPLOS. Wilson et al.
(1995), Dynamic Storage Allocation: A Survey and Critical Review, IWMM.
19. SIMD for price aggregation and analytics

---

<!-- Page 5 -->


Current problem: Computing aggregates over many prices (VWAP, moving averages, volatility, risk exposure) one
value at a time is slow.

How we solve it: Use AVX2/AVX-512 (or ARM NEON) intrinsics on contiguous arrays for these batch
computations, run on a non-critical core.

Research: Zhou and Ross (2002), Implementing Database Operations Using SIMD Instructions, SIGMOD.
Polychroniou, Raghavan, Ross (2015), Rethinking SIMD Vectorization for In-Memory Databases, SIGMOD.
Accuracy notes for this round

Rust syntax: #[link_section] does not add padding. Use #[repr(align(64))] or CachePadded.

Overclaims to avoid: padding reduces false sharing, but it does not make collisions "completely zero" (true sharing
and coherence traffic remain). Do not promise "zero" or "nanosecond" results without measurements.

SIMD scope: The matching step itself is branchy, sequential logic and does not benefit much from SIMD. Apply
SIMD to analytics and risk batches, and describe it that way.

Busy spin cost: it uses 100% of a core, so reserve that core and say so in the design.

Not novel alone: the single-writer MemTable with immutable-table swap is the standard design in LevelDB and
RocksDB. The contribution is combining it with the lock-free queue, WAL and activity-aware compaction in one
stack, with measurements.
8. Clear View: Problem, Solution, Research
#
Current problem
How TickForge solves it
Main research
1
Serialization and copying between queue,
engine and WAL
Zero-copy fixed-width structs
Disruptor (Thompson 2011); SBE spec
2
Lock contention on the MemTable
Lock-free skip list; single-writer pointer swap
Pugh 1990; Fraser 2004; O'Neil 1996; Luo
and Carey 2020
3
Cache misses from pointer-based order
books
Dense cache-aligned price array
Chilimbi et al. 1999; Gould et al. 2013
4
Compaction latency spikes
Activity-aware throttled compaction
SILK (Balmau 2019); Dostoevsky (Dayan
2018)
5
State mismatch after a crash
Deterministic sequence replay with snapshots
Schneider 1990
6
Scheduler jitter and context switches
Core pinning and isolation; busy-spin polling
Dean and Barroso 2013; IX and Arrakis
(OSDI 2014)
7
Extra hop for risk checks
Inline pre-trade risk checks
Budish et al. 2015 (value of speed); Barber
and Odean 2000
8
Queue overflow in bursts
Elastic dual-ring ingestion
Michael and Scott 1996; Disruptor
9
Kernel network stack overhead
eBPF/XDP (AF_XDP) ingestion
Hoiland-Jorgensen et al. 2018 (XDP)
10
Page-cache copies and blocking I/O in
compaction
io_uring with O_DIRECT
Axboe 2019
11
Myopic loss aversion
Evaluation-window toggle
Benartzi and Thaler 1995; Thaler et al. 1997
12
Chart scale distorts risk perception
Volatility-based Y-axis
Kaufmann, Weber, Haisley 2013
13
Overconfidence and poor risk
understanding
Scenario visualizer
Kaufmann et al. 2013; Barber and Odean
2000
14
One-sided return or loss display
Dual framing of return and drawdown
Kahneman and Tversky 1979
15
False sharing between threads
64-byte cache-line padding
Bolosky and Scott 1993; Torrellas et al.
1994
16
Flush stalls from read-write locks
Single-writer MemTable with atomic pointer
swap
O'Neil 1996; Luo and Carey 2020
17
Thread sleep and wake-up delay
Busy-spin polling on a pinned core
Disruptor; IX; Arrakis
18
Heap allocation latency
Pre-allocated object pools
Bonwick 1994; Berger et al. 2000
19
Slow batch price aggregation
SIMD on contiguous arrays
Zhou and Ross 2002; Polychroniou et al.
2015
9. Presentation Outline

---

<!-- Page 6 -->

1
Network layer: eBPF/XDP ingestion (AF_XDP) to cut kernel network overhead.
2
Threading: busy-spin polling, core pinning and cache-line padding.
3
Memory: pre-allocated contiguous object pools and a dense-array order book.
4
Analytics core: SIMD for batch price and risk calculations.
5
Storage: io_uring asynchronous NVMe I/O, atomic MemTable swap, activity-aware compaction and deterministic
replay.
6
User behavior layer: evaluation windows, smart axes, scenario visualizer and dual framing.
7
Evidence: benchmark results against baselines (P50, P99, P99.99, throughput) for every feature above.
10. Recovery: ARIES vs TickForge Redo-Only WAL
Reference paper: Mohan, Haderle, Lindsay, Pirahesh, Schwarz (1992). ARIES: A Transaction Recovery Method
Supporting Fine-Granularity Locking and Partial Rollbacks Using Write-Ahead Logging. ACM Transactions on
Database Systems 17(1), pp. 94-162.
10.1 Current problem
A general-purpose database lets a transaction change data and then abort or crash before it commits. Dirty
(uncommitted) changes can reach disk because the buffer manager may write pages early (a STEAL policy). After a
crash, the system must therefore be able to undo those changes. ARIES is the standard answer, and it is powerful but
complex.
10.2 How ARIES recovers (three passes)
Phase
What ARIES does
1. Analysis
Starts from the last checkpoint and scans the log forward. It rebuilds the transaction table (which transactions were active
at the crash) and the dirty page table (which pages may be out of date on disk), and finds where redo must start.
2. Redo
Repeats history: it reapplies every logged update from the redo start point, including updates of transactions that never
committed, but only when the page's stored LSN is older than the log record. This brings the database to its exact state at
the crash.
3. Undo
Rolls back the transactions that were still active (the "losers") by walking their log records backward. Each undo step
writes a compensation log record (CLR) so that undo is never repeated if the system crashes again during recovery.
This design is needed because ARIES uses a STEAL, NO-FORCE buffer policy and in-place page updates:
uncommitted data may be on disk (so undo is required), and committed data may not be on disk yet (so redo is
required).
10.3 How TickForge recovers (redo only)
TickForge only lets committed work reach the log and the storage engine. A trade is written to the WAL as one
complete record at the moment it is matched and committed, and uncommitted changes are never allowed into the
MemTable or into any SSTable.
1
On restart, read the last checkpoint position (the WAL position up to which data is already in SSTables).
2
Scan the WAL forward from that position and verify each record with its checksum. A half-written record at the very
end is simply discarded, because it was never acknowledged as committed.
3
Replay the valid records into a fresh MemTable. Use the record's sequence number to skip anything already
applied, so replay is idempotent.
4
Resume trading. There is no undo pass.
10.4 Side-by-side comparison
Aspect
ARIES
TickForge redo-only WAL
Buffer policy
STEAL, NO-FORCE
NO-STEAL for uncommitted data (it never reaches storage),
NO-FORCE for data files (WAL is forced, SSTables are flushed
later)
What is logged
Redo and undo information for every update,
plus CLRs during rollback
Only the committed trade or event (after-image)
Uncommitted changes on disk
Possible
Not allowed
Recovery passes
Analysis, Redo, Undo
Checkpoint lookup, then Redo

---

<!-- Page 7 -->

Aspect
ARIES
TickForge redo-only WAL
Undo and CLRs
Required
Not needed
Dirty page table and page
LSN checks
Required for page-oriented in-place updates
Not needed. LSM SSTables are immutable, and replay only fills
the MemTable
Recovery work
Three scans plus rollback of losers
One forward scan from the checkpoint
Log volume
Larger (before and after images, CLRs)
Smaller (one committed record per event)
Partial rollback and
fine-grained locking
Supported
Not needed for TickForge's workload
Implementation complexity
High
Low, easy to test and to verify
10.5 Advantage of our approach

No reason for undo. We only pass committed transactions to the log and storage, and we do not allow
uncommitted changes anywhere durable. Since nothing uncommitted can exist after a crash, there is nothing to roll
back.

Faster, simpler recovery. One forward pass from the checkpoint instead of three phases, with no loser-transaction
rollback time.

Smaller log. No before-images and no compensation records, so less write volume on the critical path.

Lower latency on the hot path. Fewer bytes per record and no undo bookkeeping, which fits the zero-copy
fixed-width record design (Section 3, feature 1).

Fits the LSM design. Immutable SSTables mean no in-place page updates, so ARIES machinery such as the dirty
page table and per-page LSN checks is not needed.

Fits deterministic replay. Sequence-numbered committed events replay to the same state every time (Section 3,
feature 5).

Easier to verify. Fewer recovery states, so crash tests can compare a state hash before and after recovery.
10.6 Conditions that must hold for the redo-only claim
The argument is only valid if these are true in the implementation, so test each one:

Commit before durability: a record is added to the WAL only when the trade is final, and the acknowledgement to
the client is sent only after the record is flushed (fsync, ideally with group commit).

No early writes: the MemTable and SSTables never contain data that is not yet committed.

Atomic records: each trade (or each atomic group of fills) is one WAL record protected by a checksum, so a torn
write at the tail is detected and dropped.

Idempotent replay: every record carries a sequence number, and the checkpoint stores the last sequence already
flushed to SSTables.

Safe log truncation: WAL segments are deleted only after the matching MemTable has been fully flushed to an
SSTable.
10.7 Limitations (state these honestly)

Not a new idea. Redo-only logging is standard in LSM stores such as LevelDB and RocksDB (WAL replay into the
MemTable) and in main-memory databases that log only committed transactions. The advantage is that TickForge's
workload makes it sufficient, not that it is novel.

No general transactions. If TickForge later adds multi-step operations that can abort halfway (for example an
atomic cancel-and-replace across several books), you must either buffer the changes until commit or add undo for
that case.

Order intake is a separate question. If orders are logged before they are matched (for deterministic replay of
inputs), the replay must re-run matching deterministically, and the log must make clear which events are inputs and
which are committed outcomes.

Durability cost. Forcing the WAL at commit adds fsync latency. Use group commit, a fast NVMe device and
batching, and measure the effect.
10.8 Research references

---

<!-- Page 8 -->

Topic
Paper
Why it matters
ARIES
Mohan, Haderle, Lindsay, Pirahesh, Schwarz (1992). ARIES. ACM
TODS 17(1)
The baseline: analysis, redo (repeating
history) and undo with CLRs
Recovery taxonomy
Haerder and Reuter (1983). Principles of Transaction-Oriented
Database Recovery. ACM Computing Surveys 15(4)
Defines STEAL/NO-STEAL and
FORCE/NO-FORCE, and shows that
NO-STEAL removes the need for undo
Write-ahead logging in
LSM trees
O'Neil et al. (1996), The Log-Structured Merge-Tree; Luo and Carey
(2020), LSM-based Storage Techniques: A Survey
WAL and MemTable recovery design in
LSM storage
Redo-only logging in
main-memory systems
Diaconu et al. (2013). Hekaton: SQL Server's Memory-Optimized OLTP
Engine. SIGMOD
Example of an engine that logs only
committed transactions, with no undo log
Replay-based recovery
Schneider (1990). Implementing fault-tolerant services using the state
machine approach. ACM Computing Surveys 22(4)
Same ordered inputs lead to the same
state
11. MySQL at Scale vs TickForge: Large Data and the WAL
11.1 Current problem
Companies such as Groww must store very large, ever-growing transaction data and still commit quickly. A
general-purpose database like MySQL (InnoDB) has to support many query types, many concurrent users, rollback,
replication and backups. Every commit pays for these features, even when the core job is only to record a trade safely.
TickForge targets one narrow job, so it can drop most of that cost.
11.2 How MySQL (InnoDB) handles durability
Component
What it does
Redo log (the WAL)
A sequential log of page changes, written before the data pages. At commit it is flushed according to the setting
innodb_flush_log_at_trx_commit (value 1 flushes at every commit for full durability).
Undo log
Stores before-images so a transaction can roll back and so readers can see consistent older versions (MVCC).
Doublewrite buffer
Protects data pages from torn writes (a page that is half written at a crash).
Binary log
A server-level logical log used for replication and point-in-time recovery. With sync_binlog=1, the server runs an
internal two-phase commit so the binary log and the InnoDB redo log agree.
Buffer pool
Caches data pages in memory. Dirty pages are written later (STEAL, NO-FORCE), which is why ARIES-style
recovery with undo is needed.
Group commit
Lets several concurrent commits share one fsync to reduce cost.
Important: the InnoDB redo log is already a separate sequential file from the data files. So "our WAL is separate" is
true for MySQL too, and it is not by itself the reason TickForge can be faster. The real reasons are in Section 11.5.
11.3 How companies scale MySQL for very large data

Keep hot data small: archive or purge old rows and partition tables by time, so the active working set fits in
memory.

Indexing and query tuning: composite indexes and slow-query analysis.

Split reads and writes: send reads to replicas and writes to the primary.

Caching: put a cache (such as Redis) in front of frequent reads.

Sharding: split data across servers by a key such as user ID, with routing in the application.

Separate OLTP and OLAP: keep the transactional database small and move history and analytics to a warehouse.

Move to distributed SQL when sharding becomes too costly: per public Cockroach Labs material, Groww kept
active transactional data hot, split read and write workflows and used caching to run on MySQL for years, then
migrated in stages to CockroachDB to support its cell-based architecture.
11.4 Side-by-side comparison
Aspect
MySQL (InnoDB)
TickForge
Purpose
General-purpose relational database
Exchange core: match orders and record trades
WAL content
Redo log, undo log and binary log
One committed event per record (redo only)
Recovery
ARIES-style: analysis, redo, undo
Redo only from the last checkpoint (Section 10)

---

<!-- Page 9 -->

Aspect
MySQL (InnoDB)
TickForge
Commit path
Parse SQL, optimize, take locks and MVCC, write redo and
binary log with two-phase commit, network round trip
Lock-free queue, match, append one fixed-width
record to the WAL
Record format
Row and page formats, converted from SQL values
Fixed-width binary struct, same layout from queue to
WAL (zero-copy)
Storage structure
B+tree pages updated in place, with random I/O and a
doublewrite buffer
LSM tree: append-only writes, immutable SSTables
Concurrency
Many threads, row locks, MVCC
Single matching writer, lock-free queue, pinned core
Replication
Built in through the binary log
Not yet implemented
Query flexibility
Full SQL, secondary indexes
Key and time-range lookups
Scale-out
Replicas, sharding, or distributed SQL
Single node for now
11.5 Why TickForge can be faster on its narrow workload
1
Redo only: no undo log and no before-images (Section 10).
2
One log, one flush: a single WAL fsync per commit group, instead of redo log plus binary log with two-phase
commit.
3
Smaller, fixed-width records: less data written and no conversion step (zero-copy).
4
No SQL layer: no parser, optimizer, lock manager or MVCC version tracking on the hot path.
5
Append-only LSM writes: no in-place page updates and no doublewrite buffer.
6
Single writer, no lock contention: the matching thread owns the write path, pinned to a core.
7
In-process call: no network protocol round trip per statement.
So the correct claim is: lower commit-path overhead for a narrow trade-recording workload, not "a better
database than MySQL".
11.6 Conditions for a fair comparison, and limits

Same durability: compare against MySQL with innodb_flush_log_at_trx_commit=1 and sync_binlog=1 only if
TickForge also acknowledges after fsync. If TickForge acknowledges before the flush, say so and compare against
relaxed MySQL settings.

The device sets the floor: fsync time on the NVMe drive limits both systems. The gain is in software overhead,
throughput and tail latency, so measure P99 and P99.99, not only averages.

MySQL offers things TickForge does not: full SQL, secondary indexes, replication, backups, point-in-time
recovery, mature tooling and multi-row ACID transactions.

Do not claim to beat a specific company's system. Groww and others run MySQL or distributed SQL with
replication, sharding and failover, which TickForge does not yet provide.

Closer baseline: MyRocks (MySQL with the RocksDB LSM engine) is a fairer baseline for an LSM-based design
than plain InnoDB.
11.7 Benchmark plan

Workload: insert fixed-schema trade records, one per transaction and in batches.

Systems: MySQL InnoDB, MySQL with MyRocks, and TickForge, on the same machine and the same NVMe drive.

Metrics: throughput, P50, P99 and P99.99 commit latency, CPU use, bytes written per trade (write amplification),
and recovery time after kill -9 with a fixed number of records.

Reporting: state the durability settings of every system next to each result.
11.8 Research and source references
Topic
Source
Why it matters
InnoDB internals
MySQL Reference Manual, InnoDB storage engine chapters (redo log, undo
log, doublewrite buffer, binary log), dev.mysql.com
Official description of the MySQL
durability components in Section 11.2
ARIES
Mohan et al. (1992). ARIES. ACM TODS 17(1)
The recovery model InnoDB follows in
spirit (steal, no-force, undo)
Group commit
DeWitt et al. (1984). Implementation Techniques for Main Memory Database
Systems. SIGMOD
Origin of group commit for cheaper
fsync

---

<!-- Page 10 -->

Topic
Source
Why it matters
LSM inside MySQL
Matsunobu, Dong, Lee (2020). MyRocks: LSM-Tree Database Storage Engine
Serving Facebook's Social Graph. PVLDB 13(12)
Closest MySQL comparison for an
LSM-based design
Log as the database
Verbitski et al. (2017). Amazon Aurora: Design Considerations for High
Throughput Cloud-Native Relational Databases. SIGMOD
Shows how separating and simplifying
the log path improves performance
Distributed SQL
Taft et al. (2020). CockroachDB: The Resilient Geo-Distributed SQL Database.
SIGMOD
The system Groww migrated to
LSM trees
O'Neil et al. (1996), The Log-Structured Merge-Tree; Luo and Carey (2020),
LSM-based Storage Techniques: A Survey
Storage design behind TickForge
Groww case
Cockroach Labs, "Groww: Preparing an Investment Platform for Its Next 10x"
(cockroachlabs.com/blog/fintech-companies-scaled-distributed-sql); Groww
Engineering Blog, "How Groww Migrated from MySQL to CockroachDB to
Power Its Cell-Based Architecture (Part 1)"
Public account of how Groww scaled
on MySQL and then moved; read the
originals for details, as this document
only summarizes them
12. Lock-Free Queue vs Locking and Deadlock Handling in Traditional
Systems
12.1 Current problem
A general-purpose database such as MySQL must let many transactions touch many rows at the same time and still
stay correct. To do that it uses locks, and locks bring extra work and extra risk:

Lock acquisition and release for every row or table access, managed by a lock manager.

Waiting: a thread that cannot get a lock is blocked, put to sleep by the OS, and woken later (a context switch).

Deadlocks: two transactions can wait for each other forever, so the system needs deadlock detection or prevention
(for example a wait-for graph check, lock timeouts, and rolling back a victim transaction).

Priority inversion and convoying: if the thread holding a lock is slowed or descheduled, every thread behind it is
delayed too.

Many stages per request: parse, optimize, execute, lock, version (MVCC), log, commit. Each stage adds time, and
any of them can wait on another.
The stage structure of a typical database engine is described in Hellerstein, Stonebraker and Hamilton, Architecture of
a Database System.
12.2 How TickForge solves it

Lock-free MPSC queue: producers claim a slot with an atomic operation (CAS or fetch-and-add) and never wait for
a lock. A thread that is slow or paused cannot stop the others from making progress.

Single-writer matching engine: one thread owns the order book and the MemTable write path, so no lock is
needed to protect them.

No deadlock by construction: with no locks held while waiting for other locks, a circular wait cannot form.
TickForge needs no deadlock detector, no wait-for graph and no victim rollback.

Short, fixed pipeline: queue, risk check, match, WAL append. No parse, optimize or lock-manager stages.
12.3 Comparison
Aspect
Traditional lock-based database
TickForge
Synchronization
Lock manager, row and table locks, latches
Atomic CAS or fetch-and-add on the queue; single
writer for state
Waiting
Blocking, sleep and wake-up through the OS
Producers do not block; the consumer busy-spins on a
pinned core
Deadlock
Possible, so detection or prevention is required
Cannot occur, since no thread holds one lock while
waiting for another
Effect of a slow thread
Can hold a lock and delay everyone behind it
Does not block other producers
Progress guarantee
None for a blocked thread
Lock-free: some thread always makes progress
Request stages
Parse, optimize, execute, lock, MVCC, log, commit
Queue, risk check, match, WAL append
Rollback on conflict
Victim transaction is rolled back and retried
Not needed (see Section 10)

---

<!-- Page 11 -->

12.4 Why it should be faster in theory

No blocking: removing sleep and wake-up removes context-switch time and its jitter, which is what hurts P99 and
P99.99 latency.

No lock bookkeeping: no lock table updates, no wait-for graph, no deadlock checks, no lock timeouts.

Fewer stages: each stage removed is time saved on every order.

Better tail behavior: a lock-free queue is not hurt when one thread is descheduled while holding a lock, because no
thread holds one.

Published evidence: the LMAX Disruptor paper reports that locks are far more expensive than atomic operations in
a contended test, and that its lock-free ring buffer achieves much lower latency than queue-based designs. Check
the exact figures in the paper before quoting them.
12.5 Limits and honest caveats

"Lock-free" is not automatically "faster". When there is no contention, an uncontended mutex costs about the
same as a CAS. The gains appear under contention, with many producers, and in tail latency.

Contention still costs. Many producers retrying CAS on the same variable can slow each other. A fetch-and-add
slot claim (as in Vyukov-style MPSC queues) scales better than a CAS retry loop, and cache-line padding (Section
7, feature 15) is needed to avoid false sharing.

Lock-free is not wait-free. A producer can in principle retry many times. State this precisely.

Hard to get right. Memory ordering, the ABA problem and safe memory reclamation (for example hazard pointers)
are common sources of bugs, so test with stress tests and tools such as ThreadSanitizer.

Traditional databases lock for a reason. Locks and deadlock handling are what give them correctness for
arbitrary multi-row transactions from many clients. TickForge avoids them because its workload is narrow (one
matching thread, committed events only), not because locks are a mistake. Claim this advantage for the exchange
workload only.

Do not claim anything about a specific company's internals. Say "general-purpose lock-based databases", and
measure TickForge against a mutex-based baseline rather than assuming the result.
12.6 How to prove it

Baselines: (a) a mutex-protected queue, (b) a CAS-based MPSC queue without padding, (c) the final queue with
padding and fetch-and-add slot claiming.

Load: 1, 2, 4, 8 and 16 producer threads at fixed and bursty rates.

Metrics: throughput, P50, P99 and P99.99 enqueue-to-match latency, context switches per second, and CPU use.

Optional: run the same order stream through a MySQL table with row locks to show the cost of lock-based commit
paths, using the benchmark plan in Section 11.7.
12.7 Research references
Topic
Paper
Why it matters
Progress guarantees
Herlihy (1991). Wait-Free Synchronization. ACM TOPLAS 13(1)
Defines the hierarchy of wait-free and
lock-free and why it matters
Lock-free queues
Michael and Scott (1996). Simple, Fast, and Practical Non-Blocking and
Blocking Concurrent Queue Algorithms. PODC
Reference CAS-based queue
Ring buffer vs locks
Thompson et al. (2011). Disruptor. LMAX
Measures the cost of locks and CAS and
shows a lock-free design
MPSC queue design
Vyukov, Intrusive MPSC node-based queue and bounded MPMC queue
(1024cores.net)
Practical MPSC designs with low
contention
Lock contention
Mellor-Crummey and Scott (1991). Algorithms for Scalable Synchronization
on Shared-Memory Multiprocessors. ACM TOCS 9(1)
Why contended locks scale badly
Memory reclamation
Michael (2004). Hazard Pointers: Safe Memory Reclamation for Lock-Free
Objects. IEEE TPDS 15(6)
Solves the reclamation and ABA
problems
Database locking and
deadlocks
Gray and Reuter (1993). Transaction Processing: Concepts and
Techniques; Bernstein, Hadzilacos, Goodman (1987). Concurrency Control
and Recovery in Database Systems
Lock managers, deadlock detection and
the cost of locking
Database engine
stages
Hellerstein, Stonebraker, Hamilton (2007). Architecture of a Database
System. Foundations and Trends in Databases 1(2)
Describes the parse, optimize, execute,
lock and log stages

---

<!-- Page 12 -->

Topic
Paper
Why it matters
Tail latency
Dean and Barroso (2013). The Tail at Scale. CACM 56(2)
Why tail latency, not averages, is the
right metric
Please verify all citations against Google Scholar or the publisher before submitting; they were written from memory.