// wal_replay test: replaying a COPY of a WAL to its newest sequence gives the same state hash as the
// live exchange; replaying to an earlier sequence gives the hash of the exchange stopped there;
// and the original file is not changed.
#include "map_book.hpp"
#include "replay.hpp"
#include "test_util.hpp"

#include <cstdio>
#include <fstream>
#include <iterator>
#include <random>
#include <sstream>
#include <string>
#include <unistd.h>

static std::string run(const std::string &cmd) {
  std::string out;
  FILE *p = popen(cmd.c_str(), "r");
  char buf[4096];
  while (p && std::fgets(buf, sizeof buf, p)) out += buf;
  if (p) pclose(p);
  return out;
}
static std::string slurp(const std::string &p) {
  std::ifstream f(p, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(f), {});
}
static std::string hash_of(Exchange<MapBook> &ex) {
  char b[17];
  std::snprintf(b, sizeof b, "%016llx", static_cast<unsigned long long>(ex.state_hash()));
  return b;
}
static void make(Exchange<MapBook> &ex) {
  ex.set_self_trade_prevention(true);
  ex.enable_accounts(100'000'000, 500, 10);
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  const std::string tool = "\"" + std::string(argv[1]) + "\"";
  const std::string wal = "/tmp/tf_replay_test_" + std::to_string(getpid()) + ".wal";
  const std::string copy = wal + ".copy";
  std::remove(wal.c_str());
  WalRecovery none = wal_recover(wal, [](const WalRecord &) {});
  (void)none;
  WalWriter w(wal);
  Exchange<MapBook> live;
  make(live);
  std::mt19937 rng(7);
  std::vector<Trade> ignored;
  const int N = 300;
  std::string hash_at_150;
  for (int i = 1; i <= N; i++) {
    WalRecord r;
    r.type = WalRecord::NewOrder;
    r.seq = i;
    r.ts_ms = 1700000000000ULL + i;
    r.order_id = i;
    r.symbol_id = 1 + rng() % 3;
    r.side = rng() % 2;
    r.price = 18950 + rng() % 100;
    r.qty = 1 + rng() % 50;
    r.trader = 1 + rng() % 24;
    w.append(r);
    ignored.clear();
    apply_record(live, r, ignored);
    if (i == 150) hash_at_150 = hash_of(live);
  }
  const std::string before = slurp(wal);
  { std::ofstream(copy, std::ios::binary) << before; }

  std::string latest = run(tool + " " + copy);
  CHECK(latest.find("\"state_hash\":\"" + hash_of(live) + "\"") != std::string::npos);
  CHECK(latest.find("\"last_seq\":" + std::to_string(N)) != std::string::npos);
  CHECK(latest.find("\"trades\":" + std::to_string(live.trades_total()) + ",") != std::string::npos);

  std::string mid = run(tool + " " + copy + " --seq 150");
  CHECK(mid.find("\"state_hash\":\"" + hash_at_150 + "\"") != std::string::npos);
  CHECK(mid.find("\"last_seq\":150") != std::string::npos);
  CHECK(mid.find("\"newest_seq_in_file\":300") != std::string::npos);

  CHECK(slurp(wal) == before);  // the original was never opened by the tool
  CHECK(run(tool + " /tmp/tf_no_such_file.wal 2>/dev/null").empty());
  CHECK(access("/tmp/tf_no_such_file.wal", F_OK) != 0);  // and it did not create it
  std::remove(wal.c_str());
  std::remove(copy.c_str());
  return finish("wal_replay_test");
}
