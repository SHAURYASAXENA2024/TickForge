#pragma once
#include <array>
#include <atomic>
#include <cstddef>

template <typename T> class MPSCQueue {
private:
  struct Node {
    std::atomic<Node *> next;
    T data;
    Node() : next(nullptr) {}
  };

  static constexpr int MAX_THREADS = 64;
  static constexpr int RETIRE_CAPACITY = 1024;

  std::atomic<Node *> head_;
  std::atomic<Node *> tail_;

  std::array<std::atomic<Node *>, MAX_THREADS> hazard_;
  std::array<std::atomic<Node *>, RETIRE_CAPACITY> retired_;
  std::atomic<size_t> retired_count_;

  int thread_slot() {
    static std::atomic<int> counter{0};
    thread_local int slot = counter.fetch_add(1);
    return slot;
  }

  bool is_hazardous(Node *node) {
    for (int i = 0; i < MAX_THREADS; i++) {
      if (hazard_[i].load(std::memory_order_acquire) == node) {
        return true;
      }
    }
    return false;
  }

  void retire(Node *node) {
    size_t idx = retired_count_.fetch_add(1, std::memory_order_acq_rel);
    if (idx < RETIRE_CAPACITY) {
      retired_[idx].store(node, std::memory_order_release);
    } else {
      delete node;
    }
  }

  void try_reclaim() {
    size_t count = retired_count_.load(std::memory_order_acquire);
    size_t limit = count < RETIRE_CAPACITY ? count : RETIRE_CAPACITY;
    for (size_t i = 0; i < limit; i++) {
      Node *n = retired_[i].load(std::memory_order_acquire);
      if (n != nullptr && !is_hazardous(n)) {
        delete n;
        retired_[i].store(nullptr, std::memory_order_release);
      }
    }
  }

public:
  MPSCQueue() {
    Node *dummy = new Node();
    head_.store(dummy, std::memory_order_relaxed);
    tail_.store(dummy, std::memory_order_relaxed);
    retired_count_.store(0, std::memory_order_relaxed);
    for (int i = 0; i < MAX_THREADS; i++) {
      hazard_[i].store(nullptr, std::memory_order_relaxed);
    }
  }

  ~MPSCQueue() {
    Node *curr = head_.load(std::memory_order_relaxed);
    while (curr != nullptr) {
      Node *next = curr->next.load(std::memory_order_relaxed);
      delete curr;
      curr = next;
    }
  }

  void enqueue(const T &value) {
    Node *new_node = new Node();
    new_node->data = value;

    int slot = thread_slot();

    while (true) {
      Node *curr_tail = tail_.load(std::memory_order_acquire);
      hazard_[slot].store(curr_tail, std::memory_order_release);

      if (curr_tail != tail_.load(std::memory_order_acquire)) {
        continue;
      }

      Node *next = curr_tail->next.load(std::memory_order_acquire);

      if (curr_tail == tail_.load(std::memory_order_acquire)) {
        if (next == nullptr) {
          Node *expected = nullptr;
          if (curr_tail->next.compare_exchange_weak(
                  expected, new_node, std::memory_order_release,
                  std::memory_order_relaxed)) {
            tail_.compare_exchange_strong(curr_tail, new_node,
                                          std::memory_order_release,
                                          std::memory_order_relaxed);
            hazard_[slot].store(nullptr, std::memory_order_release);
            return;
          }
        } else {
          tail_.compare_exchange_weak(curr_tail, next,
                                      std::memory_order_release,
                                      std::memory_order_relaxed);
        }
      }
    }
  }

  bool dequeue(T &out) {
    Node *curr_head = head_.load(std::memory_order_acquire);
    Node *next = curr_head->next.load(std::memory_order_acquire);

    if (next == nullptr) {
      return false;
    }

    out = next->data;
    head_.store(next, std::memory_order_release);
    retire(curr_head);
    try_reclaim();
    return true;
  }
};
