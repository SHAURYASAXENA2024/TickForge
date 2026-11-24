// wal_replay: read-only replay of a COPY of the WAL up to a sequence number.
//   wal_replay <wal-copy> [--seq N] [--top K]
// Prints one JSON line: the last sequence reached, trade count, state hash and the top K
// price levels of every book. It uses the engine's own replay code (replay.hpp) with the same
// settings as `engine_server --accounts`. Point it at a copy, never at the live WAL: a
// half-written last frame is cut off the file it is given.
#include "map_book.hpp"
#include "replay.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>

static void levels_json(const MapBook &b, Side side, size_t top, std::string &out) {
  MapBook::Levels lv;
  b.levels(side, top, lv);
  out += "[";
  for (size_t i = 0; i < lv.size(); i++) {
    if (i) out += ",";
    out += "[" + std::to_string(lv[i].first) + "," + std::to_string(lv[i].second) + "]";
  }
  out += "]";
}

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: wal_replay <wal-copy> [--seq N] [--top K]\n");
    return 2;
  }
  std::string path = argv[1];
  uint64_t limit = UINT64_MAX;
  size_t top = 5;
  for (int i = 2; i + 1 < argc; i += 2) {
    if (!std::strcmp(argv[i], "--seq")) limit = std::strtoull(argv[i + 1], nullptr, 10);
    else if (!std::strcmp(argv[i], "--top")) top = std::strtoull(argv[i + 1], nullptr, 10);
  }
  if (!std::filesystem::exists(path)) {  // wal_recover would create an empty file
    std::fprintf(stderr, "wal_replay: no such file\n");
    return 2;
  }
  Exchange<MapBook> ex;
  ex.set_self_trade_prevention(true);
  ex.enable_accounts(100'000'000, 500, 10);  // the engine_server defaults used by ./build.sh
  std::vector<Trade> ignored;
  uint64_t newest = 0;
  try {
    wal_recover(path, [&](const WalRecord &r) {
      newest = r.seq;
      if (r.seq > limit) return;
      ignored.clear();
      apply_record(ex, r, ignored);
    });
  } catch (const std::exception &e) {
    std::fprintf(stderr, "wal_replay: %s\n", e.what());
    return 1;
  }
  char hash[17];
  std::snprintf(hash, sizeof(hash), "%016llx", static_cast<unsigned long long>(ex.state_hash()));
  std::string out = "{\"requested_seq\":" + (limit == UINT64_MAX ? std::string("null") : std::to_string(limit)) +
                    ",\"last_seq\":" + std::to_string(ex.last_seq()) + ",\"newest_seq_in_file\":" + std::to_string(newest) +
                    ",\"trades\":" + std::to_string(ex.trades_total()) + ",\"state_hash\":\"" + hash + "\",\"books\":{";
  bool first = true;
  for (uint32_t s = 1; s <= 64; s++) {
    const MapBook *b = ex.book(s);
    if (!b) continue;
    out += std::string(first ? "" : ",") + "\"" + std::to_string(s) + "\":{\"bids\":";
    first = false;
    levels_json(*b, Side::Buy, top, out);
    out += ",\"asks\":";
    levels_json(*b, Side::Sell, top, out);
    out += "}";
  }
  out += "}}\n";
  std::fputs(out.c_str(), stdout);
  return 0;
}
