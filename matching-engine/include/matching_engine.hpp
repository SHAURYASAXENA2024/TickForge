#pragma once
#include "lock_free_queue.hpp"
#include "order_book.hpp"
#include <atomic>
#include <functional>
#include <thread>
#include <vector>

class MatchingEngine {
private:
  MPSCQueue<Order> queue_;
  OrderBook book_;
  std::atomic<bool> running_;
  uint64_t trade_counter_;
  std::function<void(const Trade &)> on_trade_;

public:
  MatchingEngine() : running_(false), trade_counter_(0) {}

  void set_trade_callback(std::function<void(const Trade &)> cb) {
    on_trade_ = cb;
  }

  void submit(const Order &order) { queue_.enqueue(order); }

  void run() {
    running_.store(true, std::memory_order_release);
    while (running_.load(std::memory_order_acquire)) {
      Order order;
      if (queue_.dequeue(order)) {
        std::vector<Trade> trades = book_.match(order, trade_counter_);
        for (const auto &t : trades) {
          if (on_trade_) {
            on_trade_(t);
          }
        }
      } else {
        std::this_thread::yield();
      }
    }
  }

  void stop() { running_.store(false, std::memory_order_release); }
};
