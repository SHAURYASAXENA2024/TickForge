# Where every panel gets its data

Ports: engine 9100, exchange-api 8001, market-data 8000, web 8443. "Static" means a file shipped with the
page: it is labelled as such where it appears and nothing in it pretends to be live.

## Dashboard (one page, five sections)

| Section / panel | Shows | Source | Endpoint |
|---|---|---|---|
| Header: link light | engine and API reachability | exchange-api telemetry socket | `ws /ws/telemetry` |
| Simulation controls | Start, Pause, Stop, Reset, speed | commands to exchange-api, state echoed back | `ws /ws/telemetry` (`start`, `pause`, `stop`, `reset`, `speed`) |
| Engine: metric strip | orders/s, trades/s, latency, queue depth, CPU, memory, threads | engine `stats` command, relayed | `ws /ws/telemetry` |
| Engine: order book | bids, asks, spread, last | engine book snapshot | `ws /ws/orderbook?symbol=` (REST `GET /orderbook`) |
| Engine: order book "Reference" | reference price and its label | market-data (Yahoo) through exchange-api | `GET /reference` |
| Engine: order ticket | places a Kapinza order | engine, via exchange-api | `POST /orders` |
| Engine: My orders | Kapinza's orders, status, filled quantity, fills with counterparty | Rust trade database | `GET /orders?trader_id=25`, `GET /traders/25/fills`, `PATCH /orders/{id}`, `DELETE /orders/{id}` |
| Engine: order path | producers, queue, matcher, trades, saved trades | engine stats and exchange-api health | `ws /ws/telemetry`, `GET /health` |
| Engine: latency histogram | matching latency buckets | engine stats | `ws /ws/telemetry` |
| Engine: crash recovery | WAL size, frames, last sequence, state hash, CRC errors, restarts; the crash demo and its before and after table | engine `wal_status` command and the supervisor file `.run/data/supervisor.json`, through exchange-api | `GET /recovery/status`, `POST /recovery/crash-demo` (needs `TICKFORGE_DEMO=1`, localhost only) |
| Market: price chart | price history of the chosen stock | market-data (Yahoo, cached 30 s) | `GET /api/stocks/{symbol}?range=&interval=` |
| Market: stock list | the 504 S&P 500 listings and sectors | static file `frontend/src/features/market/sp500.ts` | none |
| Journey: chart, story, tiles | bars, swings, volume, since-listing block | market-data (Yahoo) | `GET /api/stocks/{symbol}/journey?range=` |
| Journey: trading activity | bought, sold, position, FIFO P&L, win rate | fills in the Rust database, last price from the engine | `GET /traders/{id}/activity?symbol=` |
| Exchange: symbol controls | running, paused or stopped per symbol | exchange-api state | `GET /symbols`, `POST /symbols/{symbol}/control` |
| Exchange: virtual traders | cash, reserved, value, P&L, fills, state | engine accounts plus exchange-api | `ws /ws/traders`, `POST /traders/{id}/control` |
| Exchange: trades | newest trades with buyer and seller names | engine trade stream, saved in the database | `ws /ws/trades`, `GET /trades/history` |
| Status: running now | service reachability, saved trades | exchange-api | `GET /health`, `ws /ws/traders` |

## Other pages

| Page | Source |
|---|---|
| How'z that! (overview, capabilities, roadmap, evaluation) | static text in `frontend/src/features/howzthat/content`, written to match the code and checked by hand against it |
| Research papers | static text and references in `frontend/src/features/research` |

## Not wired to a live source on purpose

- Stop orders held in exchange-api (`/stops`) have no ticket control yet; they are API only.
- Benchmark figures in the docs come from `./build.sh bench` runs, not from the running stack.
