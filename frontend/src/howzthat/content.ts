// Content for the "how'z that!" research page (/howz-that).
//
// Sources of truth: the team's research document "TickForge: Problem Statement, Differentiators and
// Research Foundation" (the PDF) and the code in this repository. Every status below was checked against the
// code on 18 Oct 2026. Rule: nothing is "implemented" just because the PDF or the roadmap mentions it, and no
// performance number appears here unless it was measured.
//
// Paper pages live in ../research/*.md; `papers` fields below are slugs of those files.

export type Status = "implemented" | "partial" | "planned" | "unverified";

export const STATUS_LABEL: Record<Status, string> = {
  implemented: "Implemented",
  partial: "Partially implemented",
  planned: "Planned",
  unverified: "Not verified",
};

export type SectionMeta = { id: string; number: string; title: string; short: string };

export const SECTIONS: SectionMeta[] = [
  { id: "big-picture", number: "01", title: "The big picture", short: "Big picture" },
  { id: "problem-statement", number: "02", title: "The problem statement", short: "Problem" },
  { id: "existing-work", number: "03", title: "Existing work and the research gap", short: "Existing work" },
  { id: "how-tickforge-works", number: "04", title: "How TickForge works", short: "How it works" },
  { id: "differentiators", number: "05", title: "What we added: engineering differentiators", short: "Differentiators" },
  { id: "capabilities", number: "06", title: "What TickForge provides", short: "Capabilities" },
  { id: "evaluation", number: "07", title: "Evaluation and evidence", short: "Evaluation" },
  { id: "paper-library", number: "08", title: "Research paper library", short: "Paper library" },
  { id: "limitations", number: "09", title: "Limitations and future work", short: "Limitations" },
  { id: "references", number: "10", title: "References and acknowledgments", short: "References" },
];

export const INTRO_POINTS = [
  "the problems TickForge addresses",
  "the research that informed the design",
  "the engineering decisions in the code",
  "what users can do with it today",
  "how the system should be evaluated",
  "its limitations and what comes next",
];

// ---- 01 The big picture ----------------------------------------------------------------------------

export const ABSTRACT =
  "TickForge is a small exchange built to study what happens on the critical path of order matching. Producer threads submit buy and sell orders through a lock-free multi-producer / single-consumer queue; one matching thread applies price-time priority on a limit order book and emits trades; a telemetry driver streams throughput, queue depth, book depth and a latency histogram to a web dashboard. A separate Python service serves real stock histories from Yahoo Finance, with long-horizon analytics designed around research on how people perceive risk. Durable storage (a write-ahead log and an LSM-tree) is designed in the research document but not built yet.";

export const OBJECTIVE =
  "Keep latency on the matching path predictable, make every result explainable from the code, and present risk and return in a way that helps people decide better. Every performance claim must eventually be backed by a measurement against a baseline.";

export const THEMES: { title: string; text: string; status: Status }[] = [
  { title: "Concurrency", text: "Lock-free MPSC ingestion with hazard-pointer memory reclamation.", status: "implemented" },
  { title: "Market microstructure", text: "Limit order book with price-time priority, one matching thread.", status: "implemented" },
  { title: "Observability", text: "Telemetry every 250 ms: orders/s, queue depth, book depth, latency histogram.", status: "implemented" },
  { title: "Storage and recovery", text: "WAL, LSM-tree, compaction and replay recovery.", status: "planned" },
  { title: "Tail latency", text: "p50 / p99 from a power-of-two histogram; p99.99 and baselines still missing.", status: "partial" },
  { title: "Behaviour-aware UX", text: "Evaluation windows up to MAX, log-scale charts, falls shown beside gains.", status: "partial" },
];

// ---- 02 Problem statement ----------------------------------------------------------------------------

export type Problem = { title: string; text: string; today: string; status: Status };

export const SYSTEM_PROBLEMS: Problem[] = [
  {
    title: "Blocking and synchronization overhead",
    text: "Mutex-based queues make threads wait for each other; a thread delayed while holding a lock stalls everyone.",
    today: "Order ingestion uses a lock-free queue. The telemetry trade buffer still takes a mutex on the matching thread.",
    status: "partial",
  },
  {
    title: "Unpredictable latency on the critical path",
    text: "Averages hide the rare slow orders (the tail) that dominate what users experience.",
    today: "p50 and p99 are reported as histogram bucket bounds. No p99.99 and no baseline comparison yet.",
    status: "partial",
  },
  {
    title: "Copying and serialization between components",
    text: "Orders converted and copied between queue, engine and log waste CPU and pollute caches.",
    today: "Orders are fixed-size structs, but they are copied into a heap node per enqueue. There is no log to write to yet.",
    status: "planned",
  },
  {
    title: "Cache misses from pointer-heavy structures",
    text: "Tree- and list-based order books chase pointers on the hottest code path.",
    today: "The book is a std::map of std::deque per price level: the pointer-based baseline.",
    status: "planned",
  },
  {
    title: "Flush and compaction interference",
    text: "Background merging in LSM stores causes latency spikes on the write path (the compaction wall).",
    today: "No storage engine yet, so this does not occur yet. Activity-aware compaction is designed, not built.",
    status: "planned",
  },
  {
    title: "Consistent recovery after failure",
    text: "After a crash, in-memory state and stored state can disagree, so recovery is not exact.",
    today: "Trades live only in memory. A single deterministic matching thread is the foundation for replay, but there is no log.",
    status: "planned",
  },
  {
    title: "OS scheduling and network-stack jitter",
    text: "The scheduler, the kernel network stack and the page cache add jitter to P99 and P99.99.",
    today: "Threads are not pinned; orders arrive over a local pipe, not a network. Core pinning, io_uring and XDP are future work.",
    status: "planned",
  },
];

export const BEHAVIOUR_PROBLEMS: Problem[] = [
  {
    title: "Myopic loss aversion",
    text: "Checking returns too often shows many small dips; losses feel stronger than gains, which drives panic selling.",
    today: "The Journey view shows one stock over 1D to MAX, with calendar-year returns and recovery times of big falls.",
    status: "partial",
  },
  {
    title: "Chart scaling distorts perceived risk",
    text: "A narrow or linear Y-axis can make small moves look like crashes, or decades of growth look flat.",
    today: "Journey has a Linear / Log scale switch and opens MAX on a log scale. A volatility-based axis is planned.",
    status: "partial",
  },
  {
    title: "One-sided framing of gains or losses",
    text: "Showing only returns encourages greed; showing only losses discourages participation.",
    today: "Journey shows the biggest fall beside the biggest rise, and MAX shows total return beside the five biggest falls.",
    status: "partial",
  },
  {
    title: "No historical risk context before a decision",
    text: "Users confirm orders without seeing how similar trades have played out historically.",
    today: "The order ticket shows no risk context yet. The scenario visualizer is planned.",
    status: "planned",
  },
];

export const CENTRAL_PROBLEM =
  "Build an exchange that keeps predictable, low tail latency on the critical path, recovers exactly after failure, and presents risk and return in a way that helps users decide better.";

// ---- 03 Existing work --------------------------------------------------------------------------------

export type ResearchArea = {
  topic: string;
  problem: string;
  finding: string;
  relevance: string;
  decision: string;
  gap: string;
  status: Status;
  papers: string[]; // slugs in ../research
  pdfOnly?: string[]; // works cited in the research document that have no page yet
};

export const RESEARCH_AREAS: ResearchArea[] = [
  {
    topic: "Concurrent queues and ring buffers",
    problem: "Many threads must hand work to one another without a lock becoming the bottleneck.",
    finding: "Michael and Scott give a lock-free linked-list queue built on CAS with tail helping; the LMAX Disruptor uses a pre-allocated ring buffer with a single writer.",
    relevance: "Every order enters TickForge through such a queue.",
    decision: "A Michael–Scott style linked-list queue, simplified for a single consumer.",
    gap: "No ring buffer, no back-pressure, a heap allocation per order, and no throughput measurement against a mutex baseline.",
    status: "implemented",
    papers: ["michael-scott-1996", "disruptor-2011"],
  },
  {
    topic: "Lock-free structures and memory reclamation",
    problem: "In lock-free code a node can be freed while another thread is about to read it.",
    finding: "Hazard pointers let each thread publish the nodes it is about to use; a node is freed only when no hazard points to it.",
    relevance: "Our queue must free nodes safely without a garbage collector.",
    decision: "Hazard pointers for producers, a consumer-private retire list, seq_cst on publish and scan.",
    gap: "The scan is O(retired × slots); the old reclamation bug was fixed by reasoning and never reproduced in a test.",
    status: "implemented",
    papers: ["hazard-pointers-2004"],
    pdfOnly: ["Fraser (2004), Practical lock-freedom", "Herlihy and Shavit, The Art of Multiprocessor Programming"],
  },
  {
    topic: "Limit order books and cache-conscious layout",
    problem: "Matching needs a clear priority rule and a data layout that is fast on the hottest path.",
    finding: "Gould et al. survey order books and note price-time priority is by far the most common rule; Chilimbi et al. show data layout drives cache behaviour.",
    relevance: "Defines how our book matches and what a faster layout would look like.",
    decision: "Price-time priority, trades at the resting order's price, the remainder rests.",
    gap: "The book is pointer-based (std::map + std::deque), prices are doubles not integer ticks, and there is no unit test of matching.",
    status: "implemented",
    papers: ["gould-2013-limit-order-books"],
    pdfOnly: ["Chilimbi, Davidson and Larus (1999), Cache-conscious structure definition"],
  },
  {
    topic: "LSM trees, flushing and compaction",
    problem: "Write-heavy stores must turn random writes into sequential ones without stalling the writer.",
    finding: "The LSM-tree buffers writes in memory and merges sorted runs on disk; SILK studies the latency spikes compaction causes; Monkey and Dostoevsky tune filters and merge policy.",
    relevance: "The planned trade store, and the risk that compaction hurts matching latency.",
    decision: "Planned: single-writer MemTable with an atomic swap, SSTables with Bloom filters, compaction throttled by queue depth.",
    gap: "Nothing of the storage engine exists in the code yet.",
    status: "planned",
    papers: ["oneil-1996-lsm-tree", "silk-2019", "bloom-1970"],
    pdfOnly: ["Luo and Carey (2020), LSM-based storage techniques: a survey", "Dayan and Idreos (2018), Dostoevsky", "Dayan, Athanassoulis and Idreos (2017), Monkey"],
  },
  {
    topic: "Tail latency",
    problem: "Rare slow responses dominate user experience, and averages hide them.",
    finding: "Dean and Barroso show how variability is amplified at scale and argue for tail-tolerant design; Budish et al. explain why speed matters in electronic markets.",
    relevance: "Why TickForge reports percentiles and a histogram instead of an average.",
    decision: "A latency histogram with p50 and p99 in the telemetry stream.",
    gap: "Power-of-two buckets only give upper bounds; no p99.9 / p99.99; the load is rate-limited, so the numbers are not a benchmark.",
    status: "partial",
    papers: ["dean-barroso-2013-tail-at-scale"],
    pdfOnly: ["Budish, Cramton and Shim (2015), The high-frequency trading arms race"],
  },
  {
    topic: "Logging and deterministic recovery",
    problem: "After a crash, memory and storage must be brought back to exactly the same state.",
    finding: "The state-machine approach: replicas that apply the same inputs in the same order reach the same state.",
    relevance: "Our matcher is a single thread, so replaying logged inputs in order should rebuild the exact book.",
    decision: "Planned: sequence-numbered inputs, snapshots, replay, and a state-hash check.",
    gap: "No log, no snapshots, no replay test. Orders carry a seq field (today equal to the order id) but nothing records it.",
    status: "planned",
    papers: ["schneider-1990-state-machine"],
    pdfOnly: ["Ongaro and Ousterhout (2014), Raft (optional, for multi-node)"],
  },
  {
    topic: "Behavioural finance and risk visualization",
    problem: "How often and how risk is shown changes how much risk people take.",
    finding: "Benartzi and Thaler link frequent evaluation with loss aversion; Kaufmann, Weber and Haisley show presentation formats change risk-taking and understanding.",
    relevance: "Shapes the Journey view and the planned order-page features.",
    decision: "Evaluation windows from 1D to MAX, log-scale charts, falls shown beside gains.",
    gap: "No user study; the P&L evaluation toggle and the scenario visualizer need the paper-trading ledger.",
    status: "partial",
    papers: ["benartzi-thaler-1995-myopic-loss-aversion", "kaufmann-2013-graphical-displays"],
    pdfOnly: [
      "Kahneman and Tversky (1979), Prospect theory",
      "Thaler, Tversky, Kahneman and Schwartz (1997), myopia experiment",
      "Barber and Odean (2000), Trading is hazardous to your wealth",
      "De Bondt and Thaler (1985), Does the stock market overreact?",
    ],
  },
];

export const RESEARCH_GAP = [
  "None of the techniques above is new, and TickForge does not claim to have invented lock-free queues, LSM-trees or replay recovery. Industry and open-source systems already use core pinning, kernel bypass, io_uring, throttled compaction and deterministic replay.",
  "The defensible contribution is integration plus evidence: one transparent, from-scratch exchange stack where each technique can be switched on and measured against a baseline, paired with a user interface designed around documented behavioural effects.",
  "Today the integration covers ingestion, matching and observation. The evidence part (benchmarks against baselines) has not been done yet, so the contribution is not yet demonstrated.",
];

// ---- 04 How TickForge works --------------------------------------------------------------------------

export type Component = {
  id: string;
  name: string;
  responsibility: string;
  problem: string;
  talksTo: string;
  status: Status;
  files: string[];
};

export const COMPONENTS: Component[] = [
  {
    id: "submission",
    name: "Order submission",
    responsibility: "Creates orders. Four producer threads generate synthetic buy/sell orders around $150 (40 orders/s × the 1x/10x/100x speed), and the dashboard's order ticket sends manual orders.",
    problem: "Gives the engine a steady, controllable load and lets a person place an order by hand.",
    talksTo: "Producers call MatchingEngine::submit(). Ticket orders go browser → WebSocket bridge → engine stdin → submit().",
    status: "implemented",
    files: ["matching-engine/src/telemetry_main.cpp (producer, submit_order, command_reader)", "frontend/src/App.tsx (order ticket)"],
  },
  {
    id: "validation",
    name: "Validation",
    responsibility: "The bridge accepts only a fixed set of commands, checks their fields and rebuilds them; the engine checks again (side BUY/SELL, quantity 1–100,000, price 0.01–100,000, rounded to cents).",
    problem: "No browser text ever reaches the engine directly; only localhost pages on the allowed origins can connect.",
    talksTo: "Browser → bridge (WebSocket, 127.0.0.1:9001) → engine stdin.",
    status: "implemented",
    files: ["telemetry-bridge/bridge.py (handle_command, num)", "matching-engine/src/telemetry_main.cpp (command_reader)"],
  },
  {
    id: "ingestion",
    name: "Concurrent ingestion",
    responsibility: "A lock-free multi-producer / single-consumer queue between the producers and the matcher.",
    problem: "Producers never block one another or the matcher on a lock.",
    talksTo: "submit() enqueues; the matching thread dequeues.",
    status: "implemented",
    files: ["matching-engine/include/lock_free_queue.hpp (MPSCQueue)"],
  },
  {
    id: "matcher",
    name: "Matching engine",
    responsibility: "One thread takes orders in arrival order, matches each against the book, and reports trades and processed orders through callbacks. When the queue is empty it yields and polls again.",
    problem: "A single writer means the book needs no locks and results are repeatable for a given input order.",
    talksTo: "Dequeues from the queue, calls OrderBook::match(), fires the trade and order callbacks.",
    status: "implemented",
    files: ["matching-engine/include/matching_engine.hpp (MatchingEngine::run)"],
  },
  {
    id: "book",
    name: "Limit order book · price-time priority",
    responsibility: "Holds resting orders: bids best-first and asks best-first in maps keyed by price, each level a FIFO deque. Best price first, oldest order first; trades at the resting price; the remainder rests.",
    problem: "The standard, fair priority rule for an equity-style book.",
    talksTo: "Called only from the matching thread; depth() gives aggregated levels for telemetry.",
    status: "implemented",
    files: ["matching-engine/include/order_book.hpp", "matching-engine/src/order_book.cpp (match, insert_resting, depth)"],
  },
  {
    id: "telemetry",
    name: "Trades and market-data updates",
    responsibility: "Every 250 ms the telemetry driver prints one JSON line: orders/s, trades, queue depth, latency histogram with p50/p99, book depth, CPU, memory and up to 15 recent trades.",
    problem: "Makes the engine observable without touching the matching logic.",
    talksTo: "Trade and order callbacks on the matching thread → stats thread → stdout → bridge → WebSocket → dashboard.",
    status: "implemented",
    files: ["matching-engine/src/telemetry_main.cpp", "telemetry-bridge/bridge.py", "frontend/src/telemetry.ts"],
  },
  {
    id: "api",
    name: "Backend / market-data API",
    responsibility: "FastAPI service with GET /api/stocks/{symbol} and GET /api/stocks/{symbol}/journey: real Yahoo Finance prices, a range/interval whitelist, a bounded cache and rule-based Journey analytics.",
    problem: "Real market context next to the synthetic engine, with every number unit-tested.",
    talksTo: "Browser → HTTP (127.0.0.1:8000) → yfinance. Independent of the engine: the engine trades one synthetic instrument, not these stocks.",
    status: "implemented",
    files: ["market-data/main.py", "market-data/stocks.py", "market-data/journey.py"],
  },
  {
    id: "frontend",
    name: "Frontend",
    responsibility: "React dashboard (engine controls, book, trade tape, latency, market data, Journey) and this research page.",
    problem: "Shows what the engine is doing and puts market risk in context.",
    talksTo: "WebSocket to the bridge; HTTP to the market-data API. Falls back to a labelled simulation when the bridge is offline.",
    status: "implemented",
    files: ["frontend/src/App.tsx", "frontend/src/Journey.tsx", "frontend/src/HowzThatPage.tsx"],
  },
  {
    id: "persistence",
    name: "Persistence and recovery",
    responsibility: "Not implemented. Trades exist only in memory (the telemetry keeps a bounded buffer of recent trades). Nothing survives a restart.",
    problem: "—",
    talksTo: "—",
    status: "planned",
    files: [],
  },
  {
    id: "future",
    name: "Proposed storage infrastructure",
    responsibility: "Write-ahead log → single-writer MemTable → SSTables with Bloom filters, activity-aware compaction, snapshots and deterministic replay.",
    problem: "Durable trades and exact recovery after a crash, without compaction spikes on the matching path.",
    talksTo: "Would hang off the trade callback of the matching thread.",
    status: "planned",
    files: [],
  },
];

// Architecture diagram: what runs today, and what is only designed. Labels must match COMPONENTS.
export type FlowNode = { label: string; detail: string; status: Status; component?: string };

export const ENGINE_FLOW: FlowNode[] = [
  { label: "Producers + order ticket", detail: "4 threads · manual orders", status: "implemented", component: "submission" },
  { label: "Validation", detail: "bridge + engine", status: "implemented", component: "validation" },
  { label: "MPSC queue", detail: "lock-free · hazard pointers", status: "implemented", component: "ingestion" },
  { label: "Matching thread", detail: "single consumer", status: "implemented", component: "matcher" },
  { label: "Order book", detail: "price-time priority", status: "implemented", component: "book" },
  { label: "Telemetry", detail: "JSON every 250 ms", status: "implemented", component: "telemetry" },
  { label: "WebSocket bridge", detail: "127.0.0.1:9001", status: "implemented", component: "telemetry" },
  { label: "Dashboard", detail: "engine panels", status: "implemented", component: "frontend" },
];

export const MARKET_FLOW: FlowNode[] = [
  { label: "Yahoo Finance", detail: "via yfinance", status: "implemented", component: "api" },
  { label: "FastAPI service", detail: "whitelist · cache", status: "implemented", component: "api" },
  { label: "Journey analytics", detail: "rule-based, tested", status: "implemented", component: "api" },
  { label: "Dashboard", detail: "market + Journey", status: "implemented", component: "frontend" },
];

export const STORAGE_FLOW: FlowNode[] = [
  { label: "Trades", detail: "from the matcher", status: "implemented", component: "matcher" },
  { label: "Write-ahead log", detail: "not built", status: "planned", component: "future" },
  { label: "MemTable → SSTables", detail: "not built", status: "planned", component: "future" },
  { label: "Compaction", detail: "activity-aware · not built", status: "planned", component: "future" },
  { label: "Replay recovery", detail: "not built", status: "planned", component: "future" },
];

// ---- 05 Differentiators --------------------------------------------------------------------------------

export type Differentiator = {
  id: string;
  title: string;
  status: Status;
  problem: string;
  research: string;
  approach: string;
  implementation: string;
  difference: string;
  verification: string;
  limitations: string;
  papers?: string[];
  files?: string[];
};

export type DifferentiatorGroup = { id: string; letter: string; title: string; items: Differentiator[] };

export const DIFFERENTIATORS: DifferentiatorGroup[] = [
  {
    id: "concurrency",
    letter: "A",
    title: "Concurrency and ingestion",
    items: [
      {
        id: "mpsc",
        title: "Lock-free MPSC order ingestion",
        status: "implemented",
        problem: "A mutex-protected queue makes producers wait for each other and for the matcher.",
        research: "Michael and Scott's CAS-based linked-list queue with a dummy node and tail helping.",
        approach: "Keep their enqueue; exploit the single consumer so dequeue needs no CAS on head.",
        implementation: "MPSCQueue: CAS on tail->next, then swing tail; consumer helps tail forward before moving head.",
        difference: "Single-consumer simplification and hazard pointers instead of counted pointers. The algorithm itself is not ours.",
        verification: "queue_stress_test: 8 producers, 1.6M messages, nothing lost, nothing duplicated, per-producer order kept; clean under ThreadSanitizer and AddressSanitizer.",
        limitations: "Heap allocation per order; unbounded (no back-pressure); CAS retries not counted; throughput vs a mutex queue not measured.",
        papers: ["michael-scott-1996"],
        files: ["matching-engine/include/lock_free_queue.hpp", "matching-engine/tests/queue_stress_test.cpp"],
      },
      {
        id: "hazard",
        title: "Safe memory reclamation with hazard pointers",
        status: "implemented",
        problem: "Freeing a dequeued node while a producer still reads it is a use-after-free.",
        research: "Michael's hazard pointers: publish, validate, retire, scan.",
        approach: "Only producers publish hazards; only the consumer retires, into a private list scanned every 64 nodes.",
        implementation: "hazard_ slots, thread_slot(), retired_, reclaim(), seq_cst publication and scan.",
        difference: "Single-retirer layout and the tail-before-head rule needed by our queue.",
        verification: "AddressSanitizer and ThreadSanitizer runs of the stress test (800,000 messages) report nothing.",
        limitations: "O(R × H) scan; 64 thread slots for the program's lifetime; the earlier bug was fixed by reasoning, not reproduced.",
        papers: ["hazard-pointers-2004"],
        files: ["matching-engine/include/lock_free_queue.hpp"],
      },
      {
        id: "zero-copy",
        title: "Fixed-width, zero-copy pipeline",
        status: "planned",
        problem: "Converting and copying orders between queue, engine and log wastes CPU and cache.",
        research: "LMAX Disruptor (pre-allocated entries); FIX Simple Binary Encoding (fixed-width messages).",
        approach: "One fixed-width struct layout shared by the queue slot, the engine and the WAL frame.",
        implementation: "Not built. Order is already a fixed-size struct, but it is copied into a new heap node on enqueue and copied out on dequeue, and there is no WAL.",
        difference: "—",
        verification: "Planned: count copies/allocations per order and compare latency with the current path.",
        limitations: "Depends on the WAL and on a pre-allocated ring.",
        papers: ["disruptor-2011"],
      },
      {
        id: "padding",
        title: "Cache-line padding",
        status: "planned",
        problem: "Variables written by different threads on the same 64-byte line cause false sharing.",
        research: "Bolosky and Scott (1993); Torrellas et al. (1994); padded sequence counters in the Disruptor.",
        approach: "Put head, tail and per-thread counters on separate cache lines with alignas(64).",
        implementation: "Not built: no alignas or padding in the engine today.",
        difference: "—",
        verification: "Planned: throughput with and without padding under the benchmark.",
        limitations: "Reduces false sharing; true sharing and coherence traffic remain.",
      },
      {
        id: "spin",
        title: "Busy-spin polling",
        status: "partial",
        problem: "A thread that sleeps on a lock or condition variable pays a wake-up and context switch.",
        research: "Disruptor wait strategies; IX and Arrakis (OSDI 2014); Dean and Barroso.",
        approach: "The matcher polls the queue instead of sleeping.",
        implementation: "MatchingEngine::run() polls and calls std::this_thread::yield() when the queue is empty. There is no pinned core and no pause hint.",
        difference: "—",
        verification: "Not measured. Side effect: the matcher always shows high CPU.",
        limitations: "Burns a core; without pinning the OS can still preempt it.",
        files: ["matching-engine/include/matching_engine.hpp"],
      },
      {
        id: "dual-ring",
        title: "Elastic dual-ring ingestion",
        status: "planned",
        problem: "A fixed ring overflows in bursts.",
        research: "Michael and Scott; the Disruptor.",
        approach: "A fast ring for normal flow plus an overflow buffer, with non-blocking hand-off.",
        implementation: "Not built. Today's queue is an unbounded linked list, so it never overflows but can grow without limit.",
        difference: "—",
        verification: "Planned: burst load test (queue depth and latency during and after a burst).",
        limitations: "—",
      },
    ],
  },
  {
    id: "matching",
    letter: "B",
    title: "Matching and memory layout",
    items: [
      {
        id: "price-time",
        title: "Price-time priority matching",
        status: "implemented",
        problem: "Orders need a fair, predictable rule for who trades first.",
        research: "Gould et al. (2013): price-time is by far the most common priority rule.",
        approach: "Best price first; at the same price, oldest first; trade at the resting price; remainder rests.",
        implementation: "OrderBook::match() and insert_resting(); one book for all orders.",
        difference: "Standard rule. Simplifications: no market orders, no cancel/modify, one instrument, double prices.",
        verification: "Not verified by a dedicated unit test yet; observed through telemetry only.",
        limitations: "Doubles as map keys can split equal prices; symbol_id is ignored.",
        papers: ["gould-2013-limit-order-books"],
        files: ["matching-engine/src/order_book.cpp"],
      },
      {
        id: "dense-book",
        title: "Cache-conscious dense-array order book",
        status: "planned",
        problem: "std::map + std::deque chase pointers on every match.",
        research: "Chilimbi et al. (1999) on cache-conscious layout.",
        approach: "Pre-allocated, cache-aligned price levels indexed by integer tick.",
        implementation: "Not built. The current map/deque book is the baseline it would be measured against.",
        difference: "—",
        verification: "Planned: matching throughput and cache misses, map book vs dense book.",
        limitations: "Needs integer ticks and a bounded price range.",
      },
      {
        id: "pools",
        title: "Pre-allocated object pools",
        status: "planned",
        problem: "new/malloc on the hot path can lock, fragment memory and vary in latency.",
        research: "Bonwick (1994) slab allocator; Berger et al. (2000) Hoard; Wilson et al. (1995).",
        approach: "Allocate order, trade and level objects once; take and return slots from a free list.",
        implementation: "Not built. Every enqueue calls new; trades are returned in a std::vector.",
        difference: "—",
        verification: "Planned: latency distribution with and without pools.",
        limitations: "—",
      },
      {
        id: "risk-checks",
        title: "Inline pre-trade risk checks",
        status: "planned",
        problem: "A separate risk service adds a hop before matching.",
        research: "Budish et al. (2015) on the value of speed; Barber and Odean (2000) on overtrading.",
        approach: "Limit checks on the fixed-layout order header before it enters the matching loop.",
        implementation: "Not built. Only input validation exists (side, quantity and price ranges); there are no position or exposure limits.",
        difference: "—",
        verification: "Planned.",
        limitations: "Needs positions, i.e. the ledger.",
      },
    ],
  },
  {
    id: "storage",
    letter: "C",
    title: "Storage and reliability",
    items: [
      {
        id: "wal",
        title: "Write-ahead log",
        status: "planned",
        problem: "Without a log, every trade is lost on a crash.",
        research: "Log-structured storage (O'Neil et al. 1996) and the state-machine approach (Schneider 1990).",
        approach: "Append every input and trade, sequence-numbered, before acknowledging it.",
        implementation: "Not built.",
        difference: "—",
        verification: "Planned: WAL write latency, with and without compaction running.",
        limitations: "—",
        papers: ["oneil-1996-lsm-tree", "schneider-1990-state-machine"],
      },
      {
        id: "lsm",
        title: "LSM-tree storage: MemTable and SSTables",
        status: "planned",
        problem: "Random writes to disk are slow; mutex-protected MemTables stall the writer during flushes.",
        research: "O'Neil et al. (1996); Luo and Carey (2020); Pugh (1990) skip lists; Fraser (2004).",
        approach: "Single-writer MemTable published with an atomic pointer swap; the flush thread reads the immutable table lock-free.",
        implementation: "Not built.",
        difference: "The single-writer swap is the standard LevelDB/RocksDB design; the contribution would be combining it with the queue and the WAL and measuring it.",
        verification: "Planned.",
        limitations: "—",
        papers: ["oneil-1996-lsm-tree"],
      },
      {
        id: "bloom",
        title: "Bloom filters and time-range indexing",
        status: "planned",
        problem: "Lookups would otherwise read every SSTable.",
        research: "Bloom (1970); Monkey (Dayan et al. 2017) on allocating filter memory across levels.",
        approach: "A Bloom filter per SSTable plus a time-range index.",
        implementation: "Not built.",
        difference: "—",
        verification: "Planned: false-positive rate and lookup latency.",
        limitations: "—",
        papers: ["bloom-1970"],
      },
      {
        id: "compaction",
        title: "Activity-aware compaction",
        status: "planned",
        problem: "Compaction causes latency spikes (the compaction wall).",
        research: "SILK (Balmau et al. 2019) — the closest prior work; Dostoevsky (Dayan and Idreos 2018).",
        approach: "Throttle compaction by MPSC queue depth: work harder in quiet periods, back off in bursts.",
        implementation: "Not built.",
        difference: "Must be explained against SILK, which already schedules compaction around load.",
        verification: "Planned: WAL latency and matching p99 with compaction on/off and throttled/unthrottled.",
        limitations: "—",
        papers: ["silk-2019"],
      },
      {
        id: "replay",
        title: "Deterministic replay and crash recovery",
        status: "planned",
        problem: "After a crash, memory and storage disagree.",
        research: "Schneider (1990): same inputs in the same order give the same state.",
        approach: "Snapshot plus replay of the logged, sequence-numbered inputs; compare state hashes.",
        implementation: "Not built. The single matching thread makes the design possible; orders carry a seq field (equal to the order id today) but nothing is logged.",
        difference: "—",
        verification: "Planned: crash-and-replay test comparing a hash of the book before and after.",
        limitations: "—",
        papers: ["schneider-1990-state-machine"],
      },
    ],
  },
  {
    id: "performance",
    letter: "D",
    title: "Performance engineering",
    items: [
      {
        id: "tail",
        title: "Tail-latency measurement",
        status: "partial",
        problem: "Averages hide the slow orders that matter.",
        research: "Dean and Barroso (2013).",
        approach: "Record a latency histogram on the matching thread and report percentiles.",
        implementation: "18 power-of-two buckets of submit-to-matched time; p50 and p99 reported as bucket upper bounds; shown in the Latency Histogram panel.",
        difference: "—",
        verification: "No unit test for the percentile function yet.",
        limitations: "Upper bounds only; the top bucket is open-ended (≥ 65 ms shows as 131 ms); no p99.9/p99.99; load is rate-limited, so this is monitoring, not a benchmark.",
        papers: ["dean-barroso-2013-tail-at-scale"],
        files: ["matching-engine/src/telemetry_main.cpp"],
      },
      {
        id: "contention",
        title: "Contention measurement and reduction",
        status: "planned",
        problem: "Without CAS-retry counts we cannot see contention, let alone reduce it.",
        research: "Herlihy and Shavit; Michael and Scott.",
        approach: "Count CAS failures per producer; then try padding and batching.",
        implementation: "Not built: CAS retries are not instrumented.",
        difference: "—",
        verification: "Planned.",
        limitations: "—",
      },
      {
        id: "affinity",
        title: "Core affinity and isolation",
        status: "planned",
        problem: "Scheduler migrations and preemption add jitter.",
        research: "IX and Arrakis (OSDI 2014); Dean and Barroso.",
        approach: "Pin the matching thread to an isolated core; keep I/O and compaction elsewhere.",
        implementation: "Not built: no thread affinity calls in the code.",
        difference: "—",
        verification: "Planned: pinned vs unpinned p99.",
        limitations: "Linux-specific.",
      },
      {
        id: "advanced",
        title: "io_uring, XDP and SIMD",
        status: "planned",
        problem: "Page-cache copies, kernel network overhead, slow batch analytics.",
        research: "Axboe (2019) io_uring; Høiland-Jørgensen et al. (2018) XDP; Zhou and Ross (2002); Polychroniou et al. (2015).",
        approach: "Advanced, last in the plan. SIMD only for analytics batches, not the branchy matching loop.",
        implementation: "Not built. Orders arrive through a local pipe, not a network, so XDP does not apply yet.",
        difference: "—",
        verification: "Planned.",
        limitations: "—",
      },
    ],
  },
  {
    id: "ux",
    letter: "E",
    title: "Behaviour-aware trading UX",
    items: [
      {
        id: "windows",
        title: "Daily versus longer-term evaluation windows",
        status: "partial",
        problem: "Frequent evaluation makes losses salient (myopic loss aversion).",
        research: "Benartzi and Thaler (1995); Thaler et al. (1997).",
        approach: "Let users switch from daily noise to long-term views.",
        implementation: "Journey shows a stock over 1D, 5D, 1M, 6M, 1Y and MAX; MAX adds calendar-year returns and how long each big fall took to recover.",
        difference: "Applied to a single stock's history, not to the user's own portfolio P&L.",
        verification: "Analytics covered by hand-calculated tests; no user study.",
        limitations: "The toggle on the user's own P&L needs the paper-trading ledger.",
        papers: ["benartzi-thaler-1995-myopic-loss-aversion"],
        files: ["frontend/src/Journey.tsx", "market-data/journey.py"],
      },
      {
        id: "scaling",
        title: "Risk-aware chart scaling",
        status: "partial",
        problem: "Chart scale changes how risky an asset feels.",
        research: "Kaufmann, Weber and Haisley (2013).",
        approach: "Choose the scale on purpose and label it.",
        implementation: "Linear / Log switch on the Journey chart; MAX opens on a log scale; price labels on the axis.",
        difference: "The research document's volatility-based axis is not built; log scale is a simpler, standard choice.",
        verification: "No user study.",
        limitations: "Log scales are unfamiliar to some readers.",
        papers: ["kaufmann-2013-graphical-displays"],
        files: ["frontend/src/Journey.tsx"],
      },
      {
        id: "scenario",
        title: "Scenario visualizer before order confirmation",
        status: "planned",
        problem: "Overconfidence and poor understanding of risk at the moment of decision.",
        research: "Kaufmann et al. (2013); Barber and Odean (2000).",
        approach: "Show a distribution of historical outcomes for a similar trade before the user confirms.",
        implementation: "Not built. The order ticket has no risk context.",
        difference: "—",
        verification: "Planned (optional UX study).",
        limitations: "The engine instrument is synthetic, so history would come from the market-data service.",
      },
      {
        id: "dual-framing",
        title: "Return-versus-drawdown framing",
        status: "partial",
        problem: "Showing only gains or only losses pushes people to greed or fear.",
        research: "Kahneman and Tversky (1979).",
        approach: "Show return potential next to the maximum historical fall.",
        implementation: "Journey tiles show the biggest fall beside the biggest rise; MAX shows total return and CAGR beside the five biggest falls.",
        difference: "Not on the order page and no benchmark comparison yet, as the research document proposes.",
        verification: "No user study.",
        limitations: "—",
        files: ["frontend/src/Journey.tsx"],
      },
    ],
  },
];

// ---- 06 Capabilities -------------------------------------------------------------------------------------

export type Capability = { title: string; text: string; why: string; status: Status };

export const CAPABILITIES: Capability[] = [
  { title: "Run the engine", text: "Start, pause, stop and reset the real C++ engine from the header, at 1x, 10x or 100x order rate.", why: "Lets you watch matching under different loads.", status: "implemented" },
  { title: "Place an order", text: "The order ticket sends a BUY or SELL with quantity and limit price to the engine.", why: "Shows price-time priority with an order you control.", status: "implemented" },
  { title: "Inspect the book and trades", text: "Live bid/ask depth, a trade tape and producer activity.", why: "See exactly how orders rest and match.", status: "implemented" },
  { title: "Operational telemetry", text: "Orders per second, queue depth, CPU, memory and a latency histogram with p50/p99.", why: "Makes the concurrency visible.", status: "implemented" },
  { title: "Simulation fallback", text: "Without the bridge, engine panels show clearly labelled sample data and reconnect automatically.", why: "The dashboard never pretends sample data is live.", status: "implemented" },
  { title: "Market data", text: "Search the S&P 500 and view real intraday prices as line or candlestick charts.", why: "Real market context next to the synthetic engine.", status: "implemented" },
  { title: "Journey", text: "How a stock moved over 1D to MAX: rule-based story, biggest falls and rises, volume spikes, VWAP, and for MAX the since-listing view.", why: "Puts risk and return side by side over different horizons.", status: "implemented" },
  { title: "Research documentation", text: "This page, paper pages with code references, and an integrated paper exportable as PDF.", why: "Every design choice is traceable to a source and to code.", status: "implemented" },
  { title: "Risk-aware presentation", text: "Log/linear scaling and long evaluation windows on market history.", why: "Reduces the distortions described in section 02.", status: "partial" },
  { title: "Complete trade tape at high speed", text: "The tape shows at most 15 trades per 250 ms, so at 100x some trades are not displayed (they still happen in the engine).", why: "Any P&L feature will need every fill.", status: "partial" },
  { title: "Positions and profit/loss", text: "Bought, sold, average price, realized/unrealized P&L. Shown as empty \"NEEDS LEDGER\" fields today.", why: "Needs a paper-trading ledger fed by every fill.", status: "planned" },
  { title: "Cancel, modify and market orders", text: "Only limit orders exist today.", why: "Needed for realistic order flow.", status: "planned" },
  { title: "Several instruments", text: "Today every order goes into one book for one synthetic instrument.", why: "symbol_id is carried but ignored.", status: "planned" },
  { title: "Durable trade history", text: "Trades are lost when the engine stops.", why: "Needs the WAL and storage engine.", status: "planned" },
];

// ---- 07 Evaluation -----------------------------------------------------------------------------------------

export type Experiment = {
  id: string;
  title: string;
  hypothesis: string;
  baseline: string;
  variable: string;
  metric: string;
  procedure: string;
  interpretation: string;
  status: "not-measured" | "blocked" | "optional";
  needs: string;
};

export const EXPERIMENTS: Experiment[] = [
  {
    id: "throughput",
    title: "Queue throughput: lock-free vs mutex",
    hypothesis: "With several producers, the lock-free MPSC queue sustains more orders per second than a mutex-protected queue.",
    baseline: "A std::mutex + std::queue, and Michael and Scott's own two-lock queue.",
    variable: "Queue implementation; number of producer threads (1, 2, 4, 8).",
    metric: "Orders per second (median of repeated runs), CAS retries per order.",
    procedure: "Closed-loop producers enqueue a fixed number of orders; one consumer drains; same machine, same build flags, several repetitions.",
    interpretation: "A gap that grows with producer count supports the design; no gap means the queue is not the bottleneck.",
    status: "not-measured",
    needs: "benchmarks/lockfree_vs_mutex_bench.cpp exists but is empty; CAS counters are not instrumented.",
  },
  {
    id: "latency",
    title: "Order-to-match latency percentiles",
    hypothesis: "The lock-free path has a lower and tighter P99 / P99.99 than the mutex baseline.",
    baseline: "Same engine with the mutex queue.",
    variable: "Queue implementation; offered load.",
    metric: "P50, P99, P99.99 of submit-to-matched time.",
    procedure: "Open-loop load generator at fixed rates; record every sample in a fine-grained histogram.",
    interpretation: "Compare tails, not averages; report the machine and load used.",
    status: "not-measured",
    needs: "Today's histogram has power-of-two buckets and the telemetry engine is rate-limited (40 orders/s × speed), so it is monitoring, not a benchmark. Needs an HDR-style histogram and an unthrottled load generator.",
  },
  {
    id: "burst",
    title: "Burst load",
    hypothesis: "Queue depth recovers quickly after a burst and P99 stays bounded.",
    baseline: "Steady load at the same average rate.",
    variable: "Burst size and duration.",
    metric: "Peak queue depth, time to drain, P99 during and after the burst.",
    procedure: "Inject bursts from all producers; sample queue depth and latency every few milliseconds.",
    interpretation: "Shows whether an unbounded queue hides overload (memory growth) instead of handling it.",
    status: "not-measured",
    needs: "A burst mode in the load generator.",
  },
  {
    id: "pinning",
    title: "Pinned vs unpinned matching thread",
    hypothesis: "Pinning the matcher to an isolated core lowers P99.",
    baseline: "Unpinned matcher.",
    variable: "Core affinity on/off.",
    metric: "P99 and P99.99 latency.",
    procedure: "Same load, with and without affinity, on an otherwise idle machine.",
    interpretation: "Quantifies scheduler jitter on this machine.",
    status: "blocked",
    needs: "Core affinity is not implemented.",
  },
  {
    id: "compaction",
    title: "WAL latency with compaction on and off",
    hypothesis: "Activity-aware throttling removes the latency spikes compaction causes.",
    baseline: "Compaction off; default (unthrottled) compaction.",
    variable: "Compaction policy.",
    metric: "WAL write latency percentiles; matching P99 during compaction.",
    procedure: "Sustained write load long enough to trigger several compactions.",
    interpretation: "Must be compared against SILK's results and approach.",
    status: "blocked",
    needs: "The WAL and storage engine do not exist yet.",
  },
  {
    id: "replay",
    title: "Crash and replay correctness",
    hypothesis: "Replaying the log after a crash rebuilds exactly the pre-crash book.",
    baseline: "State hash of the book just before the crash.",
    variable: "Crash point (random).",
    metric: "Hash equality of book and trade log; recovery time.",
    procedure: "Kill the engine at random points many times; recover; compare hashes.",
    interpretation: "Any mismatch is a correctness bug, not a performance issue.",
    status: "blocked",
    needs: "Needs the WAL, snapshots and replay.",
  },
  {
    id: "ux",
    title: "Behaviour-aware UI study (optional)",
    hypothesis: "Long evaluation windows and dual framing reduce panic exits without lowering understanding.",
    baseline: "A plain daily view without these features.",
    variable: "UI variant.",
    metric: "Panic exits, self-reported confidence, recall of risk.",
    procedure: "Small within-subject study on simulated price paths.",
    interpretation: "Small samples only indicate direction; no general claims.",
    status: "optional",
    needs: "Ethics and consent for a user study; the ledger for P&L variants.",
  },
];

/** Results table, ready for real numbers. A null value renders as "Not yet measured". */
export type ResultRow = { metric: string; baseline: number | null; tickforge: number | null; unit: string; experiment: string };

export const RESULTS: ResultRow[] = [
  { metric: "Throughput, 4 producers", baseline: null, tickforge: null, unit: "orders/s", experiment: "throughput" },
  { metric: "Throughput, 8 producers", baseline: null, tickforge: null, unit: "orders/s", experiment: "throughput" },
  { metric: "P50 order-to-match latency", baseline: null, tickforge: null, unit: "µs", experiment: "latency" },
  { metric: "P99 order-to-match latency", baseline: null, tickforge: null, unit: "µs", experiment: "latency" },
  { metric: "P99.99 order-to-match latency", baseline: null, tickforge: null, unit: "µs", experiment: "latency" },
  { metric: "Peak queue depth during burst", baseline: null, tickforge: null, unit: "orders", experiment: "burst" },
];

/** Correctness evidence that does exist (not performance). Re-run on Linux, 16 Oct 2026. */
export const EVIDENCE: { title: string; result: string; how: string }[] = [
  { title: "Queue stress test", result: "PASS · 1,600,000 / 1,600,000 messages", how: "8 producers × 200,000, one consumer: nothing lost, nothing duplicated, per-producer order kept." },
  { title: "ThreadSanitizer", result: "PASS · no reports (800,000 messages)", how: "Same stress test built with -fsanitize=thread." },
  { title: "AddressSanitizer", result: "PASS · no reports (800,000 messages)", how: "Same stress test built with -fsanitize=address: no use-after-free in reclamation." },
  { title: "Market-data analytics", result: "34 tests · 27 re-run and passing", how: "Hand-calculated expected values for the Journey and MAX analytics; deliberately broken versions of the code are caught. The 7 API tests need FastAPI and were not re-run in this sandbox." },
];

// ---- 09 Limitations and future work --------------------------------------------------------------------

export const LIMITATIONS = [
  "No performance result has been measured against a baseline yet.",
  "No persistence: trades are lost when the engine stops.",
  "One synthetic instrument; symbol_id is ignored; prices are doubles, not integer ticks.",
  "Limit orders only: no market orders, cancels or modifications.",
  "Latency percentiles are power-of-two bucket bounds; no p99.9 / p99.99.",
  "The trade tape can skip trades at high speed (15 per 250 ms).",
  "The engine has only been built and tested on Linux.",
  "The research pages are drafts until a teammate who has read each paper signs them off.",
  "Long-run stock histories use today's S&P 500, so they carry survivorship bias.",
];

export type RoadmapItem = { title: string; stage: "next" | "planned" | "later"; problem: string; why: string; needs: string; done: string };

export const ROADMAP: RoadmapItem[] = [
  { title: "Benchmark harness", stage: "next", problem: "No measured evidence for any performance claim.", why: "Every other optimisation needs a baseline to be judged against.", needs: "Fill benchmarks/lockfree_vs_mutex_bench.cpp; CAS counters; a fine-grained histogram.", done: "Throughput and P50/P99/P99.99 for lock-free vs mutex, with machine details, in section 07." },
  { title: "Order-book tests and integer ticks", stage: "next", problem: "Matching is untested and doubles can split equal prices.", why: "Correctness first; dense arrays need ticks anyway.", needs: "Unit tests with hand-worked orders; tick-size conversion.", done: "Tests for partial fills, time priority and trade price pass." },
  { title: "WAL and deterministic replay", stage: "planned", problem: "Trades are lost on a crash.", why: "Recovery is half of the problem statement.", needs: "Sequence numbers recorded per input; a log format; snapshots.", done: "Random-crash test: replayed book hash equals pre-crash hash every time." },
  { title: "LSM storage with Bloom filters", stage: "planned", problem: "No durable, queryable trade history.", why: "Storage is the backbone of the target architecture.", needs: "The WAL; MemTable with atomic swap; SSTable format.", done: "Writes and time-range reads work; lookup latency and false-positive rate measured." },
  { title: "Activity-aware compaction", stage: "planned", problem: "Compaction spikes would hurt matching latency.", why: "The main research-flavoured idea; must be compared with SILK.", needs: "The LSM store; queue-depth signal.", done: "Matching P99 during compaction, throttled vs unthrottled." },
  { title: "Object pools and cache-line padding", stage: "planned", problem: "Heap allocation and false sharing on the hot path.", why: "Cheap to try once the benchmark exists.", needs: "The benchmark harness.", done: "Latency distribution with and without each change." },
  { title: "Dense-array order book", stage: "planned", problem: "Pointer chasing in std::map/std::deque.", why: "Directly on the matching path.", needs: "Integer ticks; book tests.", done: "Matching throughput and cache misses vs the map book." },
  { title: "Core pinning", stage: "planned", problem: "Scheduler jitter.", why: "Simple to add, easy to measure.", needs: "The benchmark harness; Linux.", done: "Pinned vs unpinned P99." },
  { title: "Paper-trading ledger, P&L windows and scenario visualizer", stage: "planned", problem: "Behavioural features stop at market history.", why: "Completes the behaviour-aware UX in the research document.", needs: "Order acks and every fill as events (no sampling); positions in the bridge.", done: "Ledger tests; optional small user study." },
  { title: "io_uring, XDP/AF_XDP, SIMD analytics", stage: "later", problem: "Kernel and I/O overhead; slow batch analytics.", why: "Advanced; only worth it after the basics are measured.", needs: "Storage engine (io_uring); a network ingress (XDP); analytics batches (SIMD).", done: "Each measured against the path it replaces." },
];

// ---- 10 References --------------------------------------------------------------------------------------

/** Works cited in the research document that have no paper page yet. Written as in the document; not yet checked. */
export const PDF_REFERENCES: { kind: "paper" | "spec" | "book" | "doc"; text: string; url?: string }[] = [
  { kind: "spec", text: "FIX Trading Community. Simple Binary Encoding (SBE) specification.", url: "https://github.com/FIXTradingCommunity/fix-simple-binary-encoding" },
  { kind: "paper", text: "Luo, C. and Carey, M. J. (2020). LSM-based storage techniques: a survey. The VLDB Journal. arXiv:1812.07527." },
  { kind: "paper", text: "Dayan, N. and Idreos, S. (2018). Dostoevsky: better space-time trade-offs for LSM-tree based key-value stores via adaptive removal of superfluous merging. SIGMOD." },
  { kind: "paper", text: "Dayan, N., Athanassoulis, M. and Idreos, S. (2017). Monkey: optimal navigable key-value store. SIGMOD." },
  { kind: "paper", text: "Pugh, W. (1990). Skip lists: a probabilistic alternative to balanced trees. Communications of the ACM 33(6); and Concurrent maintenance of skip lists (technical report)." },
  { kind: "doc", text: "Fraser, K. (2004). Practical lock-freedom. PhD thesis, University of Cambridge." },
  { kind: "book", text: "Herlihy, M. and Shavit, N. The Art of Multiprocessor Programming." },
  { kind: "paper", text: "Chilimbi, T. M., Davidson, B. and Larus, J. R. (1999). Cache-conscious structure definition. PLDI." },
  { kind: "paper", text: "Budish, E., Cramton, P. and Shim, J. (2015). The high-frequency trading arms race. Quarterly Journal of Economics." },
  { kind: "paper", text: "Ongaro, D. and Ousterhout, J. (2014). In search of an understandable consensus algorithm (Raft). USENIX ATC." },
  { kind: "paper", text: "Høiland-Jørgensen, T. et al. (2018). The eXpress Data Path: fast programmable packet processing in the operating system kernel. CoNEXT.", url: "https://dl.acm.org/doi/10.1145/3281411.3281443" },
  { kind: "doc", text: "Axboe, J. (2019). Efficient IO with io_uring.", url: "https://kernel.dk/io_uring.pdf" },
  { kind: "paper", text: "Thaler, R. H., Tversky, A., Kahneman, D. and Schwartz, A. (1997). The effect of myopia and loss aversion on risk taking: an experimental test. Quarterly Journal of Economics 112(2)." },
  { kind: "paper", text: "Kahneman, D. and Tversky, A. (1979). Prospect theory: an analysis of decision under risk. Econometrica 47(2)." },
  { kind: "paper", text: "De Bondt, W. F. M. and Thaler, R. (1985). Does the stock market overreact? Journal of Finance 40(3)." },
  { kind: "paper", text: "Barber, B. M. and Odean, T. (2000). Trading is hazardous to your wealth. Journal of Finance 55(2)." },
  { kind: "paper", text: "Bolosky, W. J. and Scott, M. L. (1993). False sharing and its effect on shared memory performance. USENIX SEDMS." },
  { kind: "paper", text: "Torrellas, J., Lam, M. S. and Hennessy, J. L. (1994). False sharing and spatial locality in multiprocessor caches. IEEE Transactions on Computers 43(6)." },
  { kind: "doc", text: "Drepper, U. (2007). What every programmer should know about memory." },
  { kind: "paper", text: "Belay, A. et al. (2014). IX: a protected dataplane operating system for high throughput and low latency. OSDI." },
  { kind: "paper", text: "Peter, S. et al. (2014). Arrakis: the operating system is the control plane. OSDI." },
  { kind: "paper", text: "Bonwick, J. (1994). The slab allocator: an object-caching kernel memory allocator. USENIX Summer." },
  { kind: "paper", text: "Berger, E. D. et al. (2000). Hoard: a scalable memory allocator for multithreaded applications. ASPLOS." },
  { kind: "paper", text: "Wilson, P. R. et al. (1995). Dynamic storage allocation: a survey and critical review. IWMM." },
  { kind: "paper", text: "Zhou, J. and Ross, K. A. (2002). Implementing database operations using SIMD instructions. SIGMOD." },
  { kind: "paper", text: "Polychroniou, O., Raghavan, A. and Ross, K. A. (2015). Rethinking SIMD vectorization for in-memory databases. SIGMOD." },
];

export const ACKNOWLEDGMENTS = [
  "The original TickForge repository (SHAURYASAXENA2024/TickForge), which this fork builds on, and the whole team.",
  "The team's research document, “TickForge: Problem Statement, Differentiators and Research Foundation”, which this page follows.",
  "Price data from Yahoo Finance through the open-source yfinance library.",
  "The authors of the papers above. Their results are theirs; nothing here implies they reviewed or endorse TickForge.",
];
