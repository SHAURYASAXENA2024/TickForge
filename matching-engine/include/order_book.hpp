#pragma once
#include "order.hpp"
#include <deque>
#include <functional>
#include <map>
#include <vector>

class OrderBook {
private:
  std::map<double, std::deque<Order>, std::greater<double>> buy_levels_;
  std::map<double, std::deque<Order>> sell_levels_;

  void insert_resting(const Order &order);

public:
  std::vector<Trade> match(Order incoming, uint64_t &trade_counter);
};
