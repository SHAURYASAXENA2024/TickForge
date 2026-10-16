# TickForge

TickForge is an integrated systems project combining a lock-free concurrent order matching engine with a custom-built database storage engine into a single, low-latency trading exchange. Multiple threads submit buy/sell orders concurrently through a lock-free multi-producer single-consumer queue built on atomic compare-and-swap operations, eliminating the blocking and unpredictable latency caused by traditional mutex-based synchronization. A single matching engine thread processes these orders against a live limit order book using price-time priority. Every executed trade is durably persisted through a write-ahead log into a storage engine built from scratch using an LSM-tree architecture — the same design underlying production systems like RocksDB and Cassandra — supporting background compaction, time-range indexing, Bloom filters, and event-driven triggers for real-time alerts.

The project's core contribution is guaranteeing end-to-end crash consistency: on failure and restart, the write-ahead log is replayed to restore both the complete trade history and the live order book state, ensuring the concurrent processing layer and the durable storage layer remain fully consistent even under failure. The system is benchmarked against a mutex-based queue and a B+tree storage baseline, measuring latency percentiles, throughput, and recovery correctness.

TickForge is grounded in established systems research — including lock-free concurrent queue design, LSM-tree storage architecture, and write-ahead logging for crash recovery — while remaining directly applicable to real-world low-latency financial infrastructure, demonstrating how operating systems and database management concepts function together as one coherent system rather than in isolation.

## Running the live demo

Three small processes (each in its own terminal):

```bash
# 1) C++ engine (long-running telemetry build)
cd matching-engine
cmake -S . -B build && cmake --build build -j
./build/queue_stress_test            # optional: sanity-check the lock-free queue

# 2) WebSocket bridge: spawns the engine and streams its JSON stats
cd telemetry-bridge
pip install -r requirements.txt
python bridge.py                     # ws://127.0.0.1:9001

# 3) Stock market-data API + frontend
cd market-data && pip install -r requirements.txt && uvicorn main:app --port 8000
cd frontend && npm install && npm run dev      # http://localhost:8443
```

### Journey view (stock timeline)

The **Journey** section shows how the selected S&P 500 stock moved (highs, lows, biggest fall and rise,
swings, volume spikes, VWAP) for 1D / 5D / 1M / 6M / 1Y. It is computed server-side from real Yahoo price
history by `market-data/journey.py`, served at `GET /api/stocks/{symbol}/journey?range=1d`, and every number
is covered by tests with hand-calculated expectations:

```bash
cd market-data && pip install -r requirements-dev.txt && python -m pytest -q
```

If you update `market-data/`, **restart `uvicorn`**, otherwise the old process does not have the new endpoint.
Buy/sell amounts and profit/loss are shown as empty "NEEDS LEDGER" attributes on purpose: Yahoo does not say
who bought or sold, so they will be filled from the paper-trading ledger once the engine records fills.

The frontend works without the bridge too: it falls back to a clearly-labelled
simulation mode and reconnects automatically when the bridge appears.

Status: lock-free queue, price-time order book, live telemetry, latency histogram
and the dashboard are implemented. WAL, LSM-tree storage, crash recovery and the
benchmarks described above are **planned** and not yet in the repository.
