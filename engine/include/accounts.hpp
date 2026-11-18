#pragma once
// Cash and share accounts with reservations (turned on with --accounts).
//
// Every trader with an id starts with the same cash and shares. An accepted buy locks
// quantity * limit price in cash; an accepted sell locks the shares (no short selling).
// A fill spends the cash at the trade price and gives back the difference to the limit
// (price improvement); a cancel gives back the lock of what is left.
//
// Two threads touch an Accounts object, so every method takes the mutex:
//   - a connection thread asks `hold()` before it logs an order: is there enough that is
//     neither locked nor already promised to an order that has not been matched yet?
//   - the matching thread applies the real changes in WAL order, so replaying the WAL
//     gives exactly the same balances and locks.
// "Promised" amounts (`pending`) are not part of the state and are not hashed.
#include "types.hpp"
#include <cstdint>
#include <map>
#include <mutex>
#include <vector>

struct Account {
  int64_t cash = 0; // cents, including the part that is locked
  int64_t reserved_cash = 0;
  std::vector<int64_t> shares;          // per symbol id, including the locked part
  std::vector<int64_t> reserved_shares; // per symbol id
};

class Accounts {
public:
  Accounts(int64_t start_cash, int64_t start_shares, uint32_t start_symbols)
      : start_cash_(start_cash), start_shares_(start_shares), start_symbols_(start_symbols) {}

  // ---- connection threads ----

  // Check that the order can be afforded and promise the amount until the matching
  // thread has locked it. Returns nullptr if it is fine, else the reject reason.
  const char *hold(uint32_t trader, Side side, uint32_t symbol, int64_t price, uint32_t qty) {
    std::lock_guard<std::mutex> g(mu_);
    Account &a = get(trader);
    Pending &p = pending_[trader];
    if (side == Side::Buy) {
      const int64_t need = price * static_cast<int64_t>(qty);
      if (a.cash - a.reserved_cash - p.cash < need) return "insufficient_cash";
      p.cash += need;
    } else {
      if (a.shares[symbol] - a.reserved_shares[symbol] - p.shares[symbol] < qty) return "insufficient_shares";
      p.shares[symbol] += qty;
    }
    return nullptr;
  }

  // ---- matching thread (and recovery) ----

  // Lock the funds of an accepted order. `held` is true if hold() promised them first.
  void reserve(const Order &o, bool held) {
    std::lock_guard<std::mutex> g(mu_);
    Account &a = get(o.trader);
    if (o.side == Side::Buy) {
      const int64_t need = o.price * static_cast<int64_t>(o.qty);
      a.reserved_cash += need;
      if (held) pending_[o.trader].cash -= need;
    } else {
      a.reserved_shares[o.symbol_id] += o.qty;
      if (held) pending_[o.trader].shares[o.symbol_id] -= o.qty;
    }
  }

  // One fill: the buyer pays `price` per share out of a lock made at `buy_limit`.
  void settle(const Trade &t, int64_t buy_limit) {
    std::lock_guard<std::mutex> g(mu_);
    const int64_t qty = t.qty;
    if (t.buyer) {
      Account &b = get(t.buyer);
      b.cash -= qty * t.price;
      b.reserved_cash -= qty * buy_limit;
      b.shares[t.symbol_id] += qty;
    }
    if (t.seller) {
      Account &s = get(t.seller);
      s.cash += qty * t.price;
      s.shares[t.symbol_id] -= qty;
      s.reserved_shares[t.symbol_id] -= qty;
    }
  }

  // Give back the lock of `remaining` shares of a resting order.
  void release(uint32_t trader, Side side, uint32_t symbol, int64_t price, uint32_t remaining) {
    std::lock_guard<std::mutex> g(mu_);
    Account &a = get(trader);
    if (side == Side::Buy) a.reserved_cash -= price * static_cast<int64_t>(remaining);
    else a.reserved_shares[symbol] -= remaining;
  }

  // Back to the starting cash and shares, nothing locked. The caller has cancelled the
  // trader's open orders first.
  void reset(uint32_t trader) {
    std::lock_guard<std::mutex> g(mu_);
    accounts_.erase(trader);
    get(trader);
  }

  // Everything that makes up the state, in a fixed order: (trader, cash, reserved cash,
  // then symbol, shares, locked shares for every symbol with anything in it).
  template <class F> void for_each(F f) {
    std::lock_guard<std::mutex> g(mu_);
    for (auto &entry : accounts_) f(entry.first, entry.second);
  }

  bool known(uint32_t trader) {
    std::lock_guard<std::mutex> g(mu_);
    return accounts_.count(trader) != 0;
  }

private:
  struct Pending {
    int64_t cash = 0;
    std::vector<int64_t> shares = std::vector<int64_t>(MAX_SYMBOL_ID + 1, 0);
  };

  Account &get(uint32_t trader) {
    auto it = accounts_.find(trader);
    if (it != accounts_.end()) return it->second;
    Account a;
    a.cash = start_cash_;
    a.shares.assign(MAX_SYMBOL_ID + 1, 0);
    a.reserved_shares.assign(MAX_SYMBOL_ID + 1, 0);
    for (uint32_t s = 1; s <= start_symbols_ && s <= MAX_SYMBOL_ID; s++) a.shares[s] = start_shares_;
    return accounts_.emplace(trader, std::move(a)).first->second;
  }

  int64_t start_cash_;
  int64_t start_shares_;
  uint32_t start_symbols_;
  std::mutex mu_;
  std::map<uint32_t, Account> accounts_; // ascending trader id, so the hash is stable
  std::map<uint32_t, Pending> pending_;
};
