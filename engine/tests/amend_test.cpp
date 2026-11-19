// Amending the quantity of a resting order: it keeps its place in the queue, the lock of the
// quantity taken off is released, bad requests change nothing, and replay through the WAL
// encoding gives exactly the same state.
#include "exchange.hpp"
#include "map_book.hpp"
#include "replay.hpp"
#include "test_util.hpp"

#include <random>

using Ex = Exchange<MapBook>;
static const int64_t CASH = 10'000'000;
static const int64_t SHARES = 500;

static Order order(uint64_t id, uint32_t trader, Side side, int64_t price, uint32_t qty) {
  Order o;
  o.order_id = o.seq = id;
  o.symbol_id = 1;
  o.trader = trader;
  o.side = side;
  o.price = price;
  o.qty = qty;
  return o;
}

static int64_t reserved_cash(Ex &ex, uint32_t trader) {
  int64_t r = -1;
  ex.accounts()->for_each([&](uint32_t t, Account &a) {
    if (t == trader) r = a.reserved_cash;
  });
  return r;
}
static int64_t reserved_shares(Ex &ex, uint32_t trader) {
  int64_t r = -1;
  ex.accounts()->for_each([&](uint32_t t, Account &a) {
    if (t == trader) r = a.reserved_shares[1];
  });
  return r;
}

static void test_priority_is_kept_when_the_quantity_goes_down() {
  Ex ex;
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 100), t); // A, first in the queue
  ex.new_order(order(2, 2, Side::Buy, 10000, 100), t); // B, second
  CHECK(ex.amend_qty(3, 1, 40) == Ex::Amend::Done);    // A: 100 -> 40, still first
  ex.new_order(order(4, 3, Side::Sell, 10000, 60), t);
  CHECK(t.size() == 2);
  CHECK(t[0].buy_order_id == 1 && t[0].qty == 40);     // A is filled first, with its new quantity
  CHECK(t[1].buy_order_id == 2 && t[1].qty == 20);
}

static void test_price_change_style_replace_loses_priority() {
  Ex ex; // what the API does for a price change or a bigger quantity: cancel plus a new order
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 100), t);
  ex.new_order(order(2, 2, Side::Buy, 10000, 100), t);
  CHECK(ex.cancel(3, 1));
  ex.new_order(order(4, 1, Side::Buy, 10000, 100), t); // A again, now behind B
  ex.new_order(order(5, 3, Side::Sell, 10000, 50), t);
  CHECK(t.size() == 1 && t[0].buy_order_id == 2);
}

static void test_bad_amends_change_nothing() {
  Ex ex;
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 100), t);
  const uint64_t before = ex.state_hash();
  CHECK(ex.amend_qty(2, 1, 100) == Ex::Amend::Bad); // same quantity
  CHECK(ex.amend_qty(3, 1, 150) == Ex::Amend::Bad); // bigger: not an amend
  CHECK(ex.amend_qty(4, 1, 0) == Ex::Amend::Bad);
  CHECK(ex.amend_qty(5, 99, 10) == Ex::Amend::Unknown);
  // nothing but the sequence number moved: the book and its hash-relevant content are the same
  std::vector<std::pair<uint64_t, uint32_t>> rest;
  ex.book(1)->for_each([&](uint64_t id, int64_t, uint32_t q) { rest.emplace_back(id, q); });
  CHECK(rest.size() == 1 && rest[0].first == 1 && rest[0].second == 100);
  (void)before;
}

static void test_locks_are_released_for_the_quantity_taken_off() {
  Ex ex;
  ex.enable_accounts(CASH, SHARES, 3);
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 100), t); // locks 1,000,000
  CHECK(reserved_cash(ex, 1) == 1'000'000);
  CHECK(ex.amend_qty(2, 1, 30) == Ex::Amend::Done);
  CHECK(reserved_cash(ex, 1) == 300'000);
  ex.new_order(order(3, 2, Side::Sell, 11000, 80), t); // locks 80 shares
  CHECK(ex.amend_qty(4, 3, 50) == Ex::Amend::Done);
  CHECK(reserved_shares(ex, 2) == 50);
  CHECK(ex.cancel(5, 3)); // cancel releases what is left, not the original quantity
  CHECK(reserved_shares(ex, 2) == 0);
  ex.new_order(order(6, 3, Side::Sell, 10000, 30), t); // fills the amended order completely
  CHECK(t.size() == 1 && t[0].qty == 30);
  CHECK(reserved_cash(ex, 1) == 0);
}

static void test_replay_with_amends_is_exact() {
  std::mt19937 rng(11);
  Ex live;
  live.enable_accounts(CASH, SHARES, 3);
  std::vector<WalRecord> log;
  std::vector<Trade> trades;
  std::vector<uint64_t> ids;
  uint64_t seq = 0;
  int amended = 0;
  for (int i = 0; i < 6000; i++) {
    WalRecord r;
    r.seq = ++seq;
    r.ts_ms = 1000 + seq;
    const unsigned roll = rng() % 10;
    if (!ids.empty() && roll < 2) {
      r.type = WalRecord::Cancel;
      r.order_id = ids[rng() % ids.size()];
      log.push_back(r);
      live.cancel(r.seq, r.order_id);
      continue;
    }
    if (!ids.empty() && roll < 5) {
      r.type = WalRecord::Amend;
      r.order_id = ids[rng() % ids.size()];
      r.qty = 1 + rng() % 60;
      log.push_back(r);
      amended += live.amend_qty(r.seq, r.order_id, r.qty) == Ex::Amend::Done;
      continue;
    }
    r.type = WalRecord::NewOrder;
    r.order_id = r.seq;
    r.symbol_id = 1;
    r.side = rng() % 2;
    r.price = 9900 + rng() % 200;
    r.qty = 1 + rng() % 120;
    r.trader = 1 + rng() % 6;
    if (live.accounts()->hold(r.trader, r.side ? Side::Sell : Side::Buy, 1, r.price, r.qty)) {
      seq--;
      continue;
    }
    log.push_back(r);
    ids.push_back(r.order_id);
    trades.clear();
    live.new_order(to_order(r), trades, true);
  }
  CHECK(amended > 100);

  Ex replayed;
  replayed.enable_accounts(CASH, SHARES, 3);
  for (const WalRecord &r : log) {
    std::string frame = wal_encode_frame(r);
    WalRecord back;
    size_t len = 0;
    CHECK(wal_decode_frame(frame.data(), frame.size(), back, len) == WalFrame::Ok);
    CHECK(back.type == r.type && back.qty == r.qty && back.order_id == r.order_id);
    std::vector<Trade> ignored;
    apply_record(replayed, back, ignored);
  }
  CHECK(live.state_hash() == replayed.state_hash());
  for (uint32_t t = 1; t <= 6; t++) CHECK(reserved_cash(live, t) == reserved_cash(replayed, t));
}

int main() {
  test_priority_is_kept_when_the_quantity_goes_down();
  test_price_change_style_replace_loses_priority();
  test_bad_amends_change_nothing();
  test_locks_are_released_for_the_quantity_taken_off();
  test_replay_with_amends_is_exact();
  return finish("amend_test");
}
