# Contracts

Everything the parts of TickForge must agree on. If code and this file disagree, fix one of them in the same commit.

```
Browser :8443 ─┬─ exchange-api :8001 ── TCP 127.0.0.1:9100 (JSON lines) ── engine
               │        └── tickforge_db (Rust, imported by Python)
               └─ market-data :8000 ── Yahoo (cached)
```

## 1. Units

| Thing | Type | Notes |
|---|---|---|
| price | integer **cents** (`int64`) | `18950` = $189.50. Never a float anywhere. The UI formats dollars. |
| quantity | integer shares (`uint32`) | |
| time | integer **milliseconds** since Unix epoch | WAL, trades, database |
| side | string `"BUY"` or `"SELL"` | |
| symbol | engine: integer `symbol_id`; API and database: ticker string | `services/exchange-api/app/symbols.py` maps one to the other |

## 2. Engine TCP protocol

Server: `engine_server --port 9100 --wal <file>` listens on `127.0.0.1`. Each message is one JSON object on one line, ending in `\n`. Limit orders only (a "market" order is a limit order at the edge of the price band).

### In (client to engine)

```json
{"type":"new_order","client_ref":17,"symbol_id":3,"side":"BUY","price":18950,"qty":100,"trader_id":25}
{"type":"cancel","client_ref":18,"order_id":4021}
{"type":"amend","client_ref":21,"order_id":4021,"qty":40}
{"type":"command","name":"book","symbol_id":3,"depth":10}
{"type":"command","name":"stats"}
{"type":"command","name":"state_hash"}
{"type":"command","name":"accounts"}
{"type":"command","name":"reference"}
{"type":"set_reference","client_ref":20,"symbol_id":1,"price":35220,"clear_pct":5}
{"type":"reset_accounts","client_ref":19,"from":1,"to":24}
```

`amend` lowers the remaining quantity of a resting order to `qty` and keeps its place in the queue (time priority); the lock of what was taken off is released. `qty` must be above 0, at most the max order size and below the current remaining quantity, else `reject` with `bad_request`; an order that is not resting gives `unknown_order`. A new price or a bigger quantity is a cancel plus a new order, done by the client.

`trader_id` is optional (default 0 = no owner). It is the owner of the order: it is written to the WAL with the order, it comes back as `buyer_id` / `seller_id` on every trade, and the engine never matches an order against a resting order of the same owner (see Rules). `client_ref` is any integer the client chooses. The engine echoes it in the `ack` or `reject` so the client can match replies to requests.

### Out (engine to client)

| Message | Sent to | When |
|---|---|---|
| `ack` | the sender | the input was accepted **and is already in the WAL** |
| `reject` | the sender | the input failed validation or a risk check (not logged) |
| `trade` | every client | an order matched |
| `book` | the sender | reply to `command book` |
| `stats` | the sender | reply to `command stats` |
| `state_hash` | the sender | reply to `command state_hash` |

```json
{"type":"ack","client_ref":17,"order_id":4021,"seq":4021}
{"type":"reject","client_ref":17,"reason":"max_qty"}
{"type":"trade","trade_id":903,"seq":4022,"symbol_id":3,"price":18950,"qty":60,
 "buy_order_id":4021,"sell_order_id":3990,"taker_side":"BUY","ts_ms":1767225600123,
 "buyer_id":25,"seller_id":7}
{"type":"book","symbol_id":3,"bids":[[18950,40],[18940,500]],"asks":[[18960,70]]}
{"type":"state_hash","hash":"9f3a1c0b5d2e7a44","last_seq":4022}
```

- `reason` is one of: `insufficient_cash`, `insufficient_shares` (only with `--accounts`, see below), `bad_request`, `unknown_symbol`, `max_qty`, `price_band`, `unknown_order`, `read_only` (an order or cancel sent to a follower), `follower_ahead`, `diverged` (see Replication).
- `book` levels are `[price_cents, total_qty]`, best price first, aggregated per price.
- `order_id` of a new order equals the `seq` it was given. `trade_id` is a counter that starts at 1.
- A `cancel` that succeeds returns `ack` with the same `order_id`; the order is gone from the book.

### `stats` fields

```json
{"type":"stats","uptime_s":12.5,"submitted":4100,"processed":4100,"queue_depth":0,
 "orders_per_sec":812.0,"trades_total":903,"trades_per_sec":140.0,
 "avg_latency_us":9.2,"p50_latency_us":7.0,"p99_latency_us":41.0,
 "lat_hist":[0,12,340,...],"producers":[2100,2000],"threads":4,
 "cpu_pct":8.1,"rss_mb":14.2,"last_seq":4022,"state_hash":"9f3a1c0b5d2e7a44"}
```

- Latency is measured from "producer pushes onto the queue" to "matcher finished the order" (WAL write is not included; it happens before the push).
- `lat_hist` is 16 buckets by powers of two in microseconds (`<1, <2, <4, ... >=16384`).
- `producers` has one counter per connection (producer thread) seen so far.

### Risk checks (defaults, set by flags)

- `--max-qty 10000`: reject larger orders.
- `--band-pct 20`: once a symbol has traded, reject prices more than 20% away from the last trade price. Before the first trade there is no band.

### Reference prices

`set_reference` gives a symbol a reference price in cents. It is logged (WAL type 5, same layout as a new order: `symbol_id`, `price`, and `qty` = `clear_pct`) and acked with `order_id` 0.

- The 20% price band is measured from the reference price when the symbol has one, otherwise from the last trade as before.
- Resting orders whose price is more than `clear_pct` percent away from the new reference are cancelled in the same step (0 clears nothing; reservations of those orders are released). Replay does the same, so the book after a restart is the book before the crash.
- `command reference` replies `{"type":"reference","prices":{"1":35220,...}}`.
- Reference prices are part of `state_hash` only for symbols that have one, so an engine that never gets one hashes as before.
- exchange-api sends them (see `docs/DECISIONS.md`, P3). `GET /reference` on exchange-api returns `{prices, source, as_of, updated_ms, live, seeded}` where `source` is `yahoo`, `mixed`, `snapshot` or `sample`.

### Accounts and reservations

Off unless the server is started with `--accounts` (`./build.sh` starts the stack that way). Then every `trader_id` above 0 has an account that begins with `--start-cash` cents (default 100000000, $1,000,000.00) and `--start-shares` shares (default 500) of each symbol id 1 to `--start-symbols` (default 10). Orders with `trader_id` 0 have no account and are never checked.

- An accepted **buy** locks `qty x limit price` in cash. An accepted **sell** locks `qty` shares. There is no short selling.
- A fill moves cash at the **trade price** and releases the lock of the filled part at the **limit price**, so a buyer who traded at a better price than their limit gets the difference back (price improvement). A cancel releases the lock of what is left.
- An order the trader cannot afford is refused with `insufficient_cash` or `insufficient_shares` **before it is logged**, so it takes no sequence number. The check counts what is locked and also what was promised to orders that are logged but not yet matched, so two orders that are each affordable alone cannot both be accepted.
- Fills never reduce what a trader can spend (a buyer's improvement is returned, a seller only converts shares into cash), so replaying the log in order can never find a shortfall that the live run did not.
- `command accounts` replies with `{"type":"accounts","enabled":true,"accounts":[{"trader_id":3,"cash":..., "reserved_cash":..., "shares":{"1":500},"reserved_shares":{"1":120}}]}`, symbol ids as keys, only symbols with something in them.
- `reset_accounts` (`from`, `to`, default all) cancels the open orders of those traders and puts them back to the starting balances. It is logged (WAL type 4: `u8 type, u64 seq, u64 ts_ms, u64 order_id (= from), u32 to`) and acked with `order_id` 0. It is a `bad_request` when accounts are off.
- With accounts on, `state_hash` also covers every account (trader, cash, locked cash, then symbol, shares, locked shares for each symbol with something in it), so a recovery that gets one balance or lock wrong shows as a different hash. Without accounts the hash is exactly as before. Recovery must be started with the same flags and start values as the run that wrote the log.

### Self-trade prevention

- On by default (see Rules). `--no-stp`: orders of the same trader may match each other.

### Thread placement

- `--no-pin` (default): leave placement to the scheduler.
- `--pin`: the matching thread runs on one core and every other thread is kept off it. The core is the last one this process may use (`taskset` and cgroup limits are respected). Its SMT sibling is kept free too, when at least 4 CPUs are available. With fewer than 2 CPUs, or on an OS other than Linux, the server runs unpinned.
- `--pin-core N`: pin, and choose the matcher's core. A core this process may not use is a startup error (exit code 2).

### Queue

- `--queue lockfree` (default): the linked-list queue.
- `--queue elastic`: a preallocated ring, with a heap list for what does not fit. `--ring-size N` (default 65536) is rounded up to a power of two. FIFO order and the state hash are the same as with the default. `stats` then also has `ring_capacity` and `ring_overflowed` (items that have ever taken the slow path).

### WAL writes

- `--wal-io write` (default): one `write()` per frame.
- `--wal-io uring`: one io_uring write per frame, waited for before the ack. Same file, same guarantee. If this kernel or sandbox cannot create a ring, the server stops at startup with exit code 2 instead of using something else.

### Replication

Off by default. A leader started with `--replicate` serves its WAL; a server started with `--follow HOST:PORT` keeps a copy. A server cannot do both.

```json
{"type":"replicate","client_ref":0,"after_seq":4021,"after_crc":2882303761}
{"type":"replicate_ok","last_seq":4100}
```

- The follower sends `replicate` with the seq of its last frame and that frame's `crc` field (`0` and `0` when empty).
- The leader answers `replicate_ok`. After that line the connection carries raw WAL frames (section 3) and no more JSON, new frames as they are written.
- `follower_ahead` (the follower has frames the leader does not) and `diverged` (the frame at `after_seq` has another CRC) are refusals retrying cannot fix: the follower exits with code 3. So does a leader without `--replicate`, which answers `bad_request` as it would to any unknown message.
- The follower appends each frame to its own WAL, then queues it for the same matching code. Its WAL is byte-identical to the leader's up to its last frame, and it has the same state hash at the same `last_seq`.
- Asynchronous: the leader acks without waiting for any follower, so acknowledged orders can be missing from a follower if the leader's disk is lost. It ships only whole frames from its file.
- A follower rejects `new_order` and `cancel` with `read_only` and answers `book`, `stats` and `state_hash`. If the connection drops it retries every 100 ms and continues from its own WAL.
- There is no automatic failover. To promote a follower, restart it on the same WAL without `--follow`.
- With either flag, `stats` also has `role` (`leader` or `follower`), and `replicas` on a leader, `leader_connected` and `damaged_frames` on a follower.
- If a leader and a follower share a machine and both should be pinned, give each its own `--pin-core`. With plain `--pin` they would both choose the same core.

### Rules

- Price-time priority. A trade prints at the **resting** order's price. Partial fills leave the remainder resting.
- Self-trade prevention (on by default, `--no-stp` turns it off): an order with a `trader_id` is never matched against a resting order with the same `trader_id`. Those resting orders are skipped, and the next order in price-time order is used. If nothing else crosses, the remainder rests, so a trader's own bid can sit above their own ask. Orders with `trader_id` 0 are never affected. Recovery uses the same setting as the live run, so start the engine with the same flag when replaying a log.
- One matching thread owns all books. Connection threads only parse, validate, write the WAL and push to the queue.
- Order of events: validate, assign `seq`, append to WAL, `ack`, push to queue, match, broadcast `trade`.

## 3. WAL file layout

One file, little-endian.

```
file   = header, frame*
header = "TFWAL001"                      8 bytes
frame  = len:u32  crc:u32  payload[len]
```

`crc` is CRC-32 (IEEE, polynomial 0xEDB88320, as in zlib) of `payload`.

| Payload | Layout |
|---|---|
| new order (`type=1`) | `u8 type, u64 seq, u64 ts_ms, u64 order_id, u32 symbol_id, u8 side (0=BUY,1=SELL), i64 price_cents, u32 qty` |
| new order with an owner (`type=3`) | the `type=1` layout, then `u32 trader_id` at the end |
| reference price (`type=5`) | same as a new order (`type=1`): `symbol_id`, `price` (cents), `qty` = clear percent; side is 0 |
| reset accounts (`type=4`) | `u8 type, u64 seq, u64 ts_ms, u64 first trader id, u32 last trader id` |
| amend (`type=6`) | `u8 type, u64 seq, u64 ts_ms, u64 order_id, u32 new remaining qty` |
| cancel (`type=2`) | `u8 type, u64 seq, u64 ts_ms, u64 order_id` |

An order without an owner is still written as `type=1`, byte for byte as before, so older logs and logs of ownerless orders are unchanged and still replay.

Recovery on start:

1. Read frames from the start. Stop at the first frame that is cut short or has a wrong CRC.
2. Truncate the file to the end of the last good frame (this drops a half-written last record).
3. Replay the good frames through the same matching code. Trades produced during replay are **not** re-sent to clients.
4. Continue numbering from `last_seq + 1`.

`state_hash()` is FNV-1a 64 over: `last_seq`, next trade id, then for each symbol in ascending id, each side in priority order, each resting order in FIFO order: `order_id, price, remaining_qty`. Printed as 16 lowercase hex digits. The same input sequence must always give the same hash.

## 4. Database (Python API)

Rust crate `tickforge_db` in `storage/`, built into the repo `.venv` with `maturin develop --release`.

```python
from tickforge_db import TickForgeDB

db = TickForgeDB("/path/to/dir")          # creates or reopens the directory
db.insert_trade(trade_id=903, symbol="AAPL", price_cents=18950, quantity=60,
                buy_order_id=4021, sell_order_id=3990,
                buyer_id=7, seller_id=12, timestamp_ms=1767225600123,
                buyer_name="", seller_name="")                         # -> None, names optional
db.get_trade(903)                         # -> dict or None
db.range(start_ms, end_ms, symbol=None)   # -> list[dict], start inclusive, end exclusive,
                                          #    sorted by (timestamp_ms, trade_id)
db.trades_by_trader(trader_id, limit=200) # -> list[dict], newest first, buyer or seller
db.count()                                # -> int, distinct trade_ids

# orders table (file orders.log in the database directory; the last row for an order id wins)
db.upsert_order(order_id, trader_id, trader_name, side, symbol, quantity, price_cents,
                status, filled, created_ms, updated_ms, reason="")      # side BUY|SELL
db.get_order(order_id)                    # -> dict or None
db.list_orders(trader_id=None, limit=100) # -> list[dict], newest first
db.order_count()                          # -> int
db.flush()                                # memtable -> new SSTable
db.compact()                              # merge SSTables (size-tiered); returns number merged
```

A returned trade dict has exactly these keys: `trade_id, symbol, price_cents, quantity, buy_order_id, sell_order_id, buyer_id, seller_id, timestamp_ms, buyer_name, seller_name`. The two names are stored on the fill (at most 64 bytes each) in an optional section after the symbol, flagged by the top bit of the symbol length, so records and SSTables written without names are unchanged.

An order dict has `order_id, trader_id, trader_name, side, symbol, quantity, price_cents, status, filled, created_ms, updated_ms, reason`. `status` is `open`, `partially_filled`, `filled`, `cancelled` or `rejected`. A rejected order never got an engine id, so exchange-api stores it under an id from the range starting at 2^62 and puts the engine's reason in `reason`. The orders log is a CRC-protected append-only file that is rewritten (to `.tmp`, then renamed) when it holds four times more frames than live orders.

Rules:

- When `insert_trade` returns, the trade survives a process crash (the database has its own small log that is replayed on open).
- Inserting an existing `trade_id` replaces it (so the API can safely re-send after a restart).
- `buyer_id` / `seller_id` are the virtual trader ids, 0 if unknown.
- Errors raise `OSError`; bad arguments raise `ValueError`.
- SSTable: sorted by `(timestamp_ms, trade_id)`, sparse index every 64 entries, Bloom filter on `trade_id`, CRC-32 footer. Files in the directory are named `sst-<n>.tfs`.

`TICKFORGE_DB_IO=uring` makes flush and compaction write through io_uring (O_DIRECT where the file system allows it). Files are byte-identical to the default `standard`, so a database can be reopened with either setting. Opening raises `OSError` if io_uring is not available and `ValueError` for any other value. The database's own log always uses `write()`.

For tests only: `TICKFORGE_MEMORY_DB=1` makes the Python side use an in-memory stand-in with the same methods. Without it, a failed import of `tickforge_db` is a startup error.

## 5. exchange-api (port 8001)

Settings come from environment variables: `TICKFORGE_ENGINE_HOST` (127.0.0.1), `TICKFORGE_ENGINE_PORT` (9100), `TICKFORGE_DATA_DIR` (`.run/data`), `TICKFORGE_MEMORY_DB`.

REST (JSON, prices in cents):

| Route | Purpose |
|---|---|
| `GET /health` | `{"status":"ok","engine":"connected"\|"disconnected","trades":N}` |
| `POST /orders` | body `{trader_id, symbol, side, price, qty}` → `{order_id}` after the engine ack; 409 if rejected, with `reason`. `trader_id` is 1 to 24 (virtual traders), 25 or 0 (Kapinza, the order ticket's account) |
| `DELETE /orders/{order_id}` | cancel |
| `PATCH /orders/{order_id}` | body `{price?, qty?}` (`qty` = new remaining quantity). Same price and lower quantity: engine amend, keeps priority (`keeps_priority: true`). Otherwise cancel plus a new order with a new id (`kind: "replaced"`). 409 with `reason` (`not_open`, `nothing_to_change`, `price_band`, `insufficient_cash`, `insufficient_shares`, or the engine's) changes nothing |
| `POST /traders/{id}/control`, `POST /symbols/{symbol}/control` | body `{action: "pause"\|"resume"\|"stop"}` for one virtual trader (1 to 24) or one symbol; stop also cancels resting orders; a paused symbol refuses new orders with `symbol paused` |
| `POST /stops`, `GET /stops`, `DELETE /stops/{id}` | stop and stop-limit orders `{trader_id, symbol, side, stop_price, limit_price?, qty}`, held in memory until a trade price reaches the stop |
| `GET /traders/{id}/activity?symbol=` | bought, sold, net position, average prices, FIFO realized and unrealized P&L, win rate, best and worst trade, computed from the fills |
| `GET /orderbook?symbol=AAPL` | `{symbol, bids:[[price,qty]], asks:[[price,qty]]}` |
| `GET /trades?limit=100` | newest first |
| `GET /trades/history?start_ms=&end_ms=&symbol=` | from `tickforge_db.range` |
| `GET /traders`, `GET /traders/{id}` | cash, `reserved_cash`, `available_cash` (cents), holdings, `reserved_shares`, realized P&L (cents), trade count. With the engine's accounts on, cash and shares are the engine's own numbers, read on every request. `/traders` has the 24 virtual traders under `traders` and Kapinza under `manual`; `/traders/25` is Kapinza |
| `GET /orders?trader_id=&limit=` | stored orders (status, filled quantity), newest first; `trader_id=0` means Kapinza |
| `GET /traders/{id}/fills?limit=` | that trader's fills from the database, newest first, each with `order_id` (their own order), `side` (their side), and `counterparty_id` / `counterparty_name` (who was on the other side) |
| `GET /symbols` | the symbol list with ids and control state |

A fill moves cash and shares between **the two traders who own the two orders**. The engine names both traders on every trade (`buyer_id`, `seller_id`), so this survives a restart of the API.

WebSockets: `/ws/trades`, `/ws/orderbook`, `/ws/traders` push the same JSON as the matching REST route whenever it changes.

### `/ws/telemetry`

Server to browser: two message types, exactly what `frontend/src/telemetry.ts` parses.

```json
{"type":"status","state":"running","error":""}
```
`state` is `closed` (engine not reachable), `running`, `paused` or `stopped`.

```json
{"type":"stats","uptime_s":12.5,"speed":1,"submitted":4100,"processed":4100,
 "queue_depth":0,"orders_per_sec":812.0,"trades_total":903,"trades_per_sec":140.0,
 "avg_latency_us":9.2,"p50_latency_us":7.0,"p99_latency_us":41.0,
 "cpu_pct":8.1,"rss_mb":14.2,"threads":4,"lat_hist":[...],"producers":[...],
 "book":{"bids":[[18950,40]],"asks":[[18960,70]]},
 "trades":[{"id":903,"price":18950,"qty":60,"buy":7,"sell":12}]}
```

All values come from the engine's `stats` reply, except `speed` (the API's trader-activity multiplier) and `trades` (new trades since the last message; `buy` / `sell` are trader ids). `price` values are cents; the UI formats dollars.

Browser to server:

```json
{"cmd":"start"}  {"cmd":"pause"}  {"cmd":"stop"}  {"cmd":"reset"}
{"cmd":"speed","value":10}
{"cmd":"order","side":"BUY","qty":100,"price":18950}
```

`start` / `pause` / `stop` control the virtual traders (the engine always runs). `reset` resets the virtual traders' cash and holdings; it does not touch the engine or stored trades. `speed` is 1, 10 or 100.

## 6. market-data (port 8000)

Routes `/api/stocks/{symbol}?range=&interval=` and `/api/stocks/{symbol}/journey?range=`. Journey ranges are `1d`, `1mo`, `6mo`, `1y` and `max` (weekly bars, monthly when the listing is over 25 years; the reply then has a `longTerm` block); `5d` is refused with 400. Yahoo responses are cached in memory with a timeout on every request. Tests mock the provider and never use the network.

## 7. Ports and paths

| What | Value |
|---|---|
| frontend | 8443 |
| exchange-api | 8001 |
| market-data | 8000 |
| engine | 9100 (localhost only) |
| logs / data | `.run/logs/`, `.run/data/` |
| frontend env | `VITE_EXCHANGE_API_URL=http://127.0.0.1:8001`, `VITE_STOCK_API_URL=http://127.0.0.1:8000`, `VITE_TELEMETRY_URL=ws://127.0.0.1:8001/ws/telemetry` |
