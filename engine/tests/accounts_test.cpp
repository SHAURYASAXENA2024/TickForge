// Cash and share reservations: lock, release, rejection, price improvement, exact replay.
#include "exchange.hpp"
#include "map_book.hpp"
#include "replay.hpp"
#include "test_util.hpp"

#include <random>

static const int64_t CASH = 1'000'000; // $10,000.00 per trader in these tests
static const int64_t SHARES = 500;

using Ex = Exchange<MapBook>;

static void init(Ex &ex) { ex.enable_accounts(CASH, SHARES, 3); }

static Order order(uint64_t id, uint32_t trader, Side side, int64_t price, uint32_t qty, uint32_t symbol = 1) {
  Order o;
  o.order_id = o.seq = id;
  o.symbol_id = symbol;
  o.trader = trader;
  o.side = side;
  o.price = price;
  o.qty = qty;
  return o;
}

// The state of one trader, read back through for_each.
struct View {
  int64_t cash = -1, reserved_cash = 0, shares = 0, reserved_shares = 0;
};
static View view(Ex &ex, uint32_t trader, uint32_t symbol = 1) {
  View v;
  ex.accounts()->for_each([&](uint32_t t, Account &a) {
    if (t != trader) return;
    v.cash = a.cash;
    v.reserved_cash = a.reserved_cash;
    v.shares = a.shares[symbol];
    v.reserved_shares = a.reserved_shares[symbol];
  });
  return v;
}

static void test_reserve_and_cancel() {
  Ex ex;
  init(ex);
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 50), t); // locks 50 * $100.00
  View v = view(ex, 1);
  CHECK(v.cash == CASH && v.reserved_cash == 500'000);
  ex.new_order(order(2, 2, Side::Sell, 11000, 80), t); // locks 80 shares
  v = view(ex, 2);
  CHECK(v.shares == SHARES && v.reserved_shares == 80 && v.cash == CASH);

  CHECK(ex.cancel(3, 1));
  CHECK(view(ex, 1).reserved_cash == 0 && view(ex, 1).cash == CASH);
  CHECK(ex.cancel(4, 2));
  CHECK(view(ex, 2).reserved_shares == 0);
  CHECK(!ex.cancel(5, 1)); // already gone: nothing is released twice
  CHECK(view(ex, 1).reserved_cash == 0);
}

static void test_fill_and_price_improvement() {
  Ex ex;
  init(ex);
  std::vector<Trade> t;
  ex.new_order(order(1, 2, Side::Sell, 9000, 100), t); // resting ask at $90.00, locks 100 shares
  t.clear();
  ex.new_order(order(2, 1, Side::Buy, 10000, 100), t); // buyer limit $100.00, trade prints at $90.00
  CHECK(t.size() == 1 && t[0].price == 9000 && t[0].buyer == 1 && t[0].seller == 2);
  View b = view(ex, 1), s = view(ex, 2);
  CHECK(b.cash == CASH - 900'000);      // paid $90.00 a share, not $100.00
  CHECK(b.reserved_cash == 0);          // the whole lock, including the $10.00 improvement, is back
  CHECK(b.shares == SHARES + 100);
  CHECK(s.cash == CASH + 900'000 && s.shares == SHARES - 100 && s.reserved_shares == 0);
}

static void test_partial_fill_releases_only_the_filled_part() {
  Ex ex;
  init(ex);
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 100), t); // resting bid, locks $10,000.00 of $10,000.00
  CHECK(view(ex, 1).reserved_cash == 1'000'000);
  t.clear();
  ex.new_order(order(2, 2, Side::Sell, 9500, 30), t);  // sells 30 into it, at the resting price
  CHECK(t.size() == 1 && t[0].price == 10000 && t[0].qty == 30);
  View b = view(ex, 1);
  CHECK(b.cash == CASH - 300'000 && b.reserved_cash == 700'000 && b.shares == SHARES + 30);
  // the 70 that are still resting stay locked, and a cancel releases exactly those
  CHECK(ex.cancel(3, 1));
  b = view(ex, 1);
  CHECK(b.reserved_cash == 0 && b.cash == CASH - 300'000);
  // the seller sold 30 of 30 and has nothing locked
  CHECK(view(ex, 2).reserved_shares == 0 && view(ex, 2).cash == CASH + 300'000);
}

static void test_incoming_partial_fill_with_improvement_then_rest() {
  Ex ex;
  init(ex);
  std::vector<Trade> t;
  ex.new_order(order(1, 2, Side::Sell, 9000, 40), t);
  t.clear();
  ex.new_order(order(2, 1, Side::Buy, 10000, 100), t); // 40 fill at $90.00, 60 rest at $100.00
  View b = view(ex, 1);
  CHECK(b.cash == CASH - 360'000);
  CHECK(b.reserved_cash == 60 * 10000);  // only the unfilled 60 are still locked, at the limit
  CHECK(b.shares == SHARES + 40);
  CHECK(ex.cancel(3, 2));
  CHECK(view(ex, 1).reserved_cash == 0);
}

static void test_rejection_and_double_spend() {
  Ex ex;
  init(ex);
  Accounts &a = *ex.accounts();
  // $10,000.00 buys 100 shares at $100.00, not one share more
  CHECK(a.hold(1, Side::Buy, 1, 10000, 100) == nullptr);
  const char *why = a.hold(1, Side::Buy, 1, 10000, 1);
  CHECK(why && std::string(why) == "insufficient_cash"); // the first order is promised, not yet locked
  // no short selling: only 500 shares exist, 500 can be sold, 501 cannot
  CHECK(a.hold(2, Side::Sell, 1, 5000, 500) == nullptr);
  why = a.hold(2, Side::Sell, 1, 5000, 1);
  CHECK(why && std::string(why) == "insufficient_shares");
  why = a.hold(3, Side::Sell, 1, 5000, 501);
  CHECK(why && std::string(why) == "insufficient_shares");
  // a symbol the trader never had (symbol 7 is outside the 3 seeded ones)
  why = a.hold(3, Side::Sell, 7, 5000, 1);
  CHECK(why && std::string(why) == "insufficient_shares");
  // the promise turns into a lock when the matcher gets the order
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Buy, 10000, 100), t, /*held=*/true);
  CHECK(view(ex, 1).reserved_cash == 1'000'000);
  why = a.hold(1, Side::Buy, 1, 10000, 1);
  CHECK(why && std::string(why) == "insufficient_cash"); // locked now, still not available
  CHECK(ex.cancel(2, 1));
  CHECK(a.hold(1, Side::Buy, 1, 10000, 100) == nullptr); // available again after the cancel
}

static void test_self_trade_skip_keeps_both_accounts_right() {
  Ex ex;
  init(ex);
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Sell, 10000, 10), t);
  ex.new_order(order(2, 2, Side::Sell, 10000, 10), t);
  t.clear();
  ex.new_order(order(3, 1, Side::Buy, 10000, 10), t);
  CHECK(t.size() == 1 && t[0].seller == 2);
  CHECK(view(ex, 1).shares == SHARES + 10 && view(ex, 1).reserved_shares == 10); // own ask still locked
  CHECK(view(ex, 2).shares == SHARES - 10 && view(ex, 2).reserved_shares == 0);
}

static void test_reset() {
  Ex ex;
  init(ex);
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Sell, 10000, 10), t);
  ex.new_order(order(2, 2, Side::Buy, 10000, 4), t);
  ex.new_order(order(3, 3, Side::Buy, 9000, 5), t);
  ex.reset_accounts(4, 1, 2); // traders 1 and 2 only
  CHECK(view(ex, 1).cash == CASH && view(ex, 1).shares == SHARES && view(ex, 1).reserved_shares == 0);
  CHECK(view(ex, 2).cash == CASH && view(ex, 2).shares == SHARES);
  CHECK(view(ex, 3).reserved_cash == 5 * 9000); // trader 3 untouched
  MapBook::Levels bids, asks;
  ex.book(1)->levels(Side::Buy, 10, bids);
  ex.book(1)->levels(Side::Sell, 10, asks);
  CHECK(asks.empty() && bids.size() == 1 && bids[0].first == 9000); // their orders are gone
}

// Random orders and cancels, then the same inputs through the WAL encoding and back: the same
// balances, locks and state hash. Also: cash and shares are conserved, nothing goes negative.
static void test_replay_is_exact() {
  std::mt19937 rng(7);
  Ex live;
  init(live);
  std::vector<WalRecord> log;
  std::vector<Trade> trades;
  std::vector<uint64_t> ids;
  uint64_t seq = 0;
  for (int i = 0; i < 6000; i++) {
    Accounts &a = *live.accounts();
    WalRecord r;
    r.seq = ++seq;
    r.ts_ms = 1000 + seq;
    if (!ids.empty() && rng() % 5 == 0) {
      r.type = WalRecord::Cancel;
      r.order_id = ids[rng() % ids.size()];
      log.push_back(r);
      live.cancel(r.seq, r.order_id);
      continue;
    }
    r.type = WalRecord::NewOrder;
    r.order_id = r.seq;
    r.symbol_id = 1 + rng() % 3;
    r.side = rng() % 2;
    r.price = 9900 + rng() % 200;
    r.qty = 1 + rng() % 120;
    r.trader = 1 + rng() % 6;
    const char *why = a.hold(r.trader, r.side ? Side::Sell : Side::Buy, r.symbol_id, r.price, r.qty);
    if (why) { // rejected orders are not logged, and take no sequence number
      seq--;
      continue;
    }
    log.push_back(r);
    ids.push_back(r.order_id);
    trades.clear();
    live.new_order(to_order(r), trades, true);
  }
  // exercise a reset in the middle of the log too
  WalRecord reset;
  reset.type = WalRecord::Reset;
  reset.seq = ++seq;
  reset.ts_ms = 99999;
  reset.order_id = 2;
  reset.qty = 3;
  log.push_back(reset);
  live.reset_accounts(reset.seq, 2, 3);

  Ex replayed;
  init(replayed);
  for (const WalRecord &r : log) {
    std::string frame = wal_encode_frame(r); // through the real encoding, like a recovery
    WalRecord back;
    size_t len = 0;
    CHECK(wal_decode_frame(frame.data(), frame.size(), back, len) == WalFrame::Ok);
    std::vector<Trade> ignored;
    apply_record(replayed, back, ignored);
  }
  CHECK(live.state_hash() == replayed.state_hash());
  CHECK(live.trades_total() > 100);
  for (uint32_t t = 1; t <= 6; t++) {
    View a = view(live, t), b = view(replayed, t);
    CHECK(a.cash == b.cash && a.reserved_cash == b.reserved_cash);
    CHECK(a.shares == b.shares && a.reserved_shares == b.reserved_shares);
  }

  // Conservation (traders 2 and 3 were reset, so look at what the others gained): every
  // trader's locks never exceed what they hold, and no cash or share count is negative.
  for (uint32_t t = 1; t <= 6; t++) {
    live.accounts()->for_each([&](uint32_t id, Account &acc) {
      if (id != t) return;
      CHECK(acc.cash >= 0 && acc.reserved_cash >= 0 && acc.reserved_cash <= acc.cash);
      for (size_t s = 1; s <= 3; s++)
        CHECK(acc.shares[s] >= 0 && acc.reserved_shares[s] >= 0 && acc.reserved_shares[s] <= acc.shares[s]);
    });
  }
}

static void test_conservation_without_resets() {
  std::mt19937 rng(11);
  Ex ex;
  init(ex);
  std::vector<Trade> trades;
  uint64_t seq = 0;
  for (int i = 0; i < 4000; i++) {
    Order o = order(++seq, 1 + rng() % 5, rng() % 2 ? Side::Sell : Side::Buy, 9900 + rng() % 200, 1 + rng() % 80,
                    1 + rng() % 3);
    if (ex.accounts()->hold(o.trader, o.side, o.symbol_id, o.price, o.qty)) {
      seq--;
      continue;
    }
    trades.clear();
    ex.new_order(o, trades, true);
  }
  int64_t cash = 0;
  int64_t shares[4] = {0, 0, 0, 0};
  for (uint32_t t = 1; t <= 5; t++) {
    ex.accounts()->for_each([&](uint32_t id, Account &a) {
      if (id != t) return;
      cash += a.cash;
      for (int s = 1; s <= 3; s++) shares[s] += a.shares[s];
    });
  }
  CHECK(cash == 5 * CASH);
  for (int s = 1; s <= 3; s++) CHECK(shares[s] == 5 * SHARES);
  CHECK(ex.trades_total() > 50);
}

static void test_off_by_default() {
  Exchange<MapBook> ex; // no accounts: owned orders trade exactly as before
  std::vector<Trade> t;
  ex.new_order(order(1, 1, Side::Sell, 10000, 5), t);
  ex.new_order(order(2, 2, Side::Buy, 10000, 5), t);
  CHECK(t.size() == 1 && ex.accounts() == nullptr);
}

int main() {
  test_reserve_and_cancel();
  test_fill_and_price_improvement();
  test_partial_fill_releases_only_the_filled_part();
  test_incoming_partial_fill_with_improvement_then_rest();
  test_rejection_and_double_spend();
  test_self_trade_skip_keeps_both_accounts_right();
  test_reset();
  test_replay_is_exact();
  test_conservation_without_resets();
  test_off_by_default();
  return finish("accounts_test");
}
