#pragma once
// All order books plus the counters that make up the engine state.
// No threads and no I/O here: the matching thread and WAL recovery both feed
// it the same inputs in the same order, so they end in the same state.
#include "accounts.hpp"
#include "types.hpp"
#include <atomic>
#include <map>
#include <memory>
#include <unordered_map>
#include <utility>
#include <vector>

template <class Book> class Exchange {
public:
  Exchange() {
    for (auto &p : last_price_) p.store(0, std::memory_order_relaxed);
  }

  // Self-trade prevention (on by default): an order never matches a resting order of the
  // same trader. Orders without a trader (id 0) are not affected either way.
  void set_self_trade_prevention(bool on) { stp_ = on; }

  // Cash and share accounts with reservations (see accounts.hpp). Off unless this is called.
  // Orders without a trader (id 0) never touch an account.
  void enable_accounts(int64_t start_cash, int64_t start_shares, uint32_t start_symbols) {
    accts_ = std::make_unique<Accounts>(start_cash, start_shares, start_symbols);
  }
  Accounts *accounts() { return accts_.get(); }

  // Match a new order. Trades are appended to `trades`. `held` says that a connection thread
  // already promised the funds with Accounts::hold().
  void new_order(const Order &order, std::vector<Trade> &trades, bool held = false) {
    last_seq_ = order.seq;
    if (accts_ && order.trader) accts_->reserve(order, held);
    size_t before = trades.size();
    Order in = order;
    in.stp = stp_;
    books_[order.symbol_id].add(std::move(in), next_trade_id_, trades);
    if (trades.size() > before)
      last_price_[order.symbol_id].store(trades.back().price, std::memory_order_relaxed);
    if (accts_) settle(order, trades, before);
  }

  // Returns false if the order is not resting (never existed or already filled).
  bool cancel(uint64_t seq, uint64_t order_id) {
    last_seq_ = seq;
    bool found = false;
    for (auto &entry : books_)
      if (entry.second.cancel(order_id)) {
        found = true;
        break;
      }
    if (found && accts_) {
      auto it = open_.find(order_id);
      if (it != open_.end()) {
        const Open &o = it->second;
        accts_->release(o.trader, o.side, o.symbol, o.price, o.remaining);
        open_.erase(it);
      }
    }
    return found;
  }

  // Put the accounts of traders `from`..`to` back to their starting balances. Their open
  // orders are cancelled first. Without accounts it only moves the sequence number.
  void reset_accounts(uint64_t seq, uint32_t from, uint32_t to) {
    last_seq_ = seq;
    if (!accts_) return;
    std::vector<uint64_t> mine;
    for (auto &entry : open_)
      if (entry.second.trader >= from && entry.second.trader <= to) mine.push_back(entry.first);
    for (uint64_t id : mine)
      for (auto &entry : books_)
        if (entry.second.cancel(id)) break;
    for (uint64_t id : mine) open_.erase(id);
    std::vector<uint32_t> traders;
    accts_->for_each([&](uint32_t t, Account &) {
      if (t >= from && t <= to) traders.push_back(t);
    });
    for (uint32_t t : traders) accts_->reset(t);
  }

  const Book *book(uint32_t symbol_id) const {
    auto it = books_.find(symbol_id);
    return it == books_.end() ? nullptr : &it->second;
  }

  uint64_t last_seq() const { return last_seq_; }
  uint64_t trades_total() const { return next_trade_id_ - 1; }

  // Price of the last trade in a symbol, 0 if none. Safe to call from any thread.
  int64_t last_price(uint32_t symbol_id) const {
    return last_price_[symbol_id].load(std::memory_order_relaxed);
  }

  // FNV-1a 64 over last_seq, next trade id, then every resting order
  // (symbols ascending, bids then asks, FIFO within a price).
  uint64_t state_hash() const {
    uint64_t h = 0xcbf29ce484222325ULL;
    auto feed = [&h](uint64_t v) {
      for (int i = 0; i < 8; i++) {
        h ^= (v >> (8 * i)) & 0xff;
        h *= 0x100000001b3ULL;
      }
    };
    feed(last_seq_);
    feed(next_trade_id_);
    // (the accounts are fed after the books, below)
    for (const auto &entry : books_)
      entry.second.for_each([&](uint64_t id, int64_t price, uint32_t qty) {
        feed(id);
        feed(static_cast<uint64_t>(price));
        feed(qty);
      });
    if (accts_) // only with accounts, so the hash of an engine without them is unchanged
      accts_->for_each([&](uint32_t trader, Account &a) {
        feed(trader);
        feed(static_cast<uint64_t>(a.cash));
        feed(static_cast<uint64_t>(a.reserved_cash));
        for (size_t s = 0; s < a.shares.size(); s++) {
          if (a.shares[s] == 0 && a.reserved_shares[s] == 0) continue;
          feed(s);
          feed(static_cast<uint64_t>(a.shares[s]));
          feed(static_cast<uint64_t>(a.reserved_shares[s]));
        }
      });
    return h;
  }

private:
  // An owned order that is resting, kept only with accounts so a cancel knows what to release.
  struct Open {
    uint32_t trader;
    uint32_t symbol;
    Side side;
    int64_t price; // the limit
    uint32_t remaining;
  };

  // Apply the fills of one new order to the accounts and keep `open_` up to date.
  void settle(const Order &order, const std::vector<Trade> &trades, size_t first) {
    uint32_t left = order.qty;
    for (size_t i = first; i < trades.size(); i++) {
      const Trade &t = trades[i];
      const bool taker_buys = t.taker_side == Side::Buy;
      // A resting buyer's limit is the trade price; the incoming buyer's limit is its own price,
      // and the difference is the price improvement that is given back.
      accts_->settle(t, taker_buys ? order.price : t.price);
      auto it = open_.find(taker_buys ? t.sell_order_id : t.buy_order_id);
      if (it != open_.end()) {
        it->second.remaining -= t.qty;
        if (it->second.remaining == 0) open_.erase(it);
      }
      left -= t.qty;
    }
    if (order.trader && left > 0)
      open_[order.order_id] = Open{order.trader, order.symbol_id, order.side, order.price, left};
  }

  std::unique_ptr<Accounts> accts_;
  std::unordered_map<uint64_t, Open> open_;
  std::map<uint32_t, Book> books_; // ascending symbol id
  uint64_t last_seq_ = 0;
  uint64_t next_trade_id_ = 1;
  bool stp_ = true;
  std::atomic<int64_t> last_price_[MAX_SYMBOL_ID + 1];
};
