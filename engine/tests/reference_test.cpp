// Reference prices: the price band is measured from them, stale resting orders are cleared when
// a new one is set, and everything survives a kill -9 (the reference prices are in the WAL).
//
//   reference_test <path to engine_server>
#include "exchange.hpp"
#include "map_book.hpp"
#include "replay.hpp"
#include "test_client.hpp"

#include <csignal>
#include <cstdlib>
#include <string>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

// ---- the exchange itself --------------------------------------------------------------------

static Order make(uint64_t id, Side side, int64_t price, uint32_t qty, uint32_t symbol = 1) {
  Order o;
  o.order_id = o.seq = id;
  o.symbol_id = symbol;
  o.side = side;
  o.price = price;
  o.qty = qty;
  return o;
}

static void test_exchange() {
  Exchange<MapBook> ex;
  std::vector<Trade> t;
  CHECK(ex.reference(1) == 0);
  ex.new_order(make(1, Side::Buy, 18900, 10), t);  // old simulated levels around $189
  ex.new_order(make(2, Side::Sell, 19100, 10), t);
  ex.new_order(make(3, Side::Sell, 28000, 10), t); // a level near the new reference
  ex.new_order(make(4, Side::Buy, 18900, 10, 2), t); // another symbol, untouched
  const uint64_t before = ex.state_hash();

  ex.set_reference(5, 1, 27000, 5);                 // $270.00, clear anything 5 percent or more away
  CHECK(ex.reference(1) == 27000 && ex.reference(2) == 0);
  MapBook::Levels bids, asks;
  ex.book(1)->levels(Side::Buy, 10, bids);
  ex.book(1)->levels(Side::Sell, 10, asks);
  CHECK(bids.empty() && asks.size() == 1 && asks[0].first == 28000); // $280 is 3.7 percent away: kept
  bids.clear();
  ex.book(2)->levels(Side::Buy, 10, bids);
  CHECK(bids.size() == 1); // the other symbol keeps its order
  CHECK(ex.state_hash() != before);

  // clear_pct 0 only sets the price
  ex.new_order(make(6, Side::Sell, 30000, 5), t);
  ex.set_reference(7, 1, 27100, 0);
  asks.clear();
  ex.book(1)->levels(Side::Sell, 10, asks);
  CHECK(asks.size() == 2 && ex.reference(1) == 27100);

  // The same inputs through the WAL encoding give the same state.
  std::vector<WalRecord> log;
  auto add = [&](WalRecord::Type type, uint64_t seq, const Order *o, int64_t price, uint32_t sym, uint32_t pct) {
    WalRecord r;
    r.type = type;
    r.seq = seq;
    r.ts_ms = 1000 + seq;
    if (o) {
      r.order_id = o->order_id;
      r.symbol_id = o->symbol_id;
      r.side = static_cast<uint8_t>(o->side);
      r.price = o->price;
      r.qty = o->qty;
    } else {
      r.symbol_id = sym;
      r.price = price;
      r.qty = pct;
    }
    log.push_back(r);
  };
  Order o1 = make(1, Side::Buy, 18900, 10), o2 = make(2, Side::Sell, 19100, 10), o3 = make(3, Side::Sell, 28000, 10),
        o4 = make(4, Side::Buy, 18900, 10, 2), o6 = make(6, Side::Sell, 30000, 5);
  add(WalRecord::NewOrder, 1, &o1, 0, 0, 0);
  add(WalRecord::NewOrder, 2, &o2, 0, 0, 0);
  add(WalRecord::NewOrder, 3, &o3, 0, 0, 0);
  add(WalRecord::NewOrder, 4, &o4, 0, 0, 0);
  add(WalRecord::Reference, 5, nullptr, 27000, 1, 5);
  add(WalRecord::NewOrder, 6, &o6, 0, 0, 0);
  add(WalRecord::Reference, 7, nullptr, 27100, 1, 0);
  Exchange<MapBook> replayed;
  for (const WalRecord &r : log) {
    std::string frame = wal_encode_frame(r);
    WalRecord back;
    size_t len = 0;
    CHECK(wal_decode_frame(frame.data(), frame.size(), back, len) == WalFrame::Ok);
    CHECK(back.type == r.type && back.price == r.price && back.symbol_id == r.symbol_id);
    std::vector<Trade> ignored;
    apply_record(replayed, back, ignored);
  }
  CHECK(replayed.state_hash() == ex.state_hash());
  CHECK(replayed.reference(1) == 27100);

  // an exchange that never had a reference price hashes as it always did
  Exchange<MapBook> plain, plain2;
  plain.new_order(make(1, Side::Buy, 100, 1), t);
  plain2.new_order(make(1, Side::Buy, 100, 1), t);
  CHECK(plain.state_hash() == plain2.state_hash());
}

// ---- the server, over TCP -------------------------------------------------------------------

static pid_t start_server(const char *exe, int port, const std::string &wal) {
  pid_t pid = fork();
  if (pid == 0) {
    std::vector<std::string> args = {exe, "--port", std::to_string(port), "--wal", wal};
    std::vector<char *> argv;
    for (auto &a : args) argv.push_back(&a[0]);
    argv.push_back(nullptr);
    execv(exe, argv.data());
    _exit(127);
  }
  return pid;
}

static std::string set_ref(int ref, int symbol, int64_t price, int pct) {
  return "{\"type\":\"set_reference\",\"client_ref\":" + std::to_string(ref) + ",\"symbol_id\":" +
         std::to_string(symbol) + ",\"price\":" + std::to_string(price) + ",\"clear_pct\":" + std::to_string(pct) + "}";
}

static std::string book_of(Client &c, int symbol) {
  return c.ask("{\"type\":\"command\",\"name\":\"book\",\"symbol_id\":" + std::to_string(symbol) + ",\"depth\":20}", "book");
}

static void test_server(const char *exe) {
  char tmpl[] = "/tmp/tf_ref_XXXXXX";
  std::string dir = mkdtemp(tmpl);
  std::string wal = dir + "/engine.wal";
  int port = 20000 + (getpid() + 7) % 20000;

  pid_t server = start_server(exe, port, wal);
  Client a;
  CHECK(a.connect_to(port));
  // Old simulated levels around $189.
  CHECK(reason_of(a.request(order_json(1, 1, "BUY", 18900, 10), 1)) == "(ack)");
  CHECK(reason_of(a.request(order_json(2, 1, "SELL", 19100, 10), 2)) == "(ack)");

  // Seeding: sets the price, acks, and clears the old levels in the same step.
  JsonObject r = a.request(set_ref(3, 1, 27000, 5), 3);
  std::string type;
  CHECK(get_string(r, "type", type) && type == "ack");
  CHECK(book_of(a, 1).find("\"bids\":[],\"asks\":[]") != std::string::npos);
  std::string refs = a.ask("{\"type\":\"command\",\"name\":\"reference\"}", "reference");
  CHECK(refs.find("\"1\":27000") != std::string::npos);

  // Band check: 20 percent of $270.00 is $54.00, so $216.00 to $324.00.
  CHECK(reason_of(a.request(order_json(4, 1, "BUY", 32500, 1), 4)) == "price_band");
  CHECK(reason_of(a.request(order_json(5, 1, "BUY", 21500, 1), 5)) == "price_band");
  CHECK(reason_of(a.request(order_json(6, 1, "BUY", 21700, 1), 6)) == "(ack)");
  CHECK(reason_of(a.request(order_json(7, 1, "SELL", 32300, 1), 7)) == "(ack)");
  // Another symbol has no reference and no trade yet, so no band.
  CHECK(reason_of(a.request(order_json(8, 2, "BUY", 100, 1), 8)) == "(ack)");

  // Refresh: $275.00. The $217.00 bid is more than 5 percent away and goes; the $323.00 ask too.
  r = a.request(set_ref(9, 1, 27500, 5), 9);
  CHECK(get_string(r, "type", type) && type == "ack");
  CHECK(book_of(a, 1).find("\"bids\":[],\"asks\":[]") != std::string::npos);
  CHECK(reason_of(a.request(order_json(10, 1, "BUY", 26800, 3), 10)) == "(ack)"); // 2.5 percent away: kept later

  // Bad input.
  CHECK(reason_of(a.request(set_ref(11, 0, 27000, 5), 11)) == "unknown_symbol");
  CHECK(reason_of(a.request(set_ref(12, 1, 0, 5), 12)) == "bad_request");
  CHECK(reason_of(a.request(set_ref(13, 1, 27000, -1), 13)) == "bad_request");

  std::string h1 = a.ask("{\"type\":\"command\",\"name\":\"state_hash\"}", "state_hash");
  std::string book1 = book_of(a, 1);
  refs = a.ask("{\"type\":\"command\",\"name\":\"reference\"}", "reference");
  kill(server, SIGKILL);
  waitpid(server, nullptr, 0);
  ::close(a.fd);

  // After the crash the reference price is still there: the band, the hash and the book all agree.
  server = start_server(exe, port, wal);
  Client b;
  CHECK(b.connect_to(port));
  CHECK(b.ask("{\"type\":\"command\",\"name\":\"state_hash\"}", "state_hash") == h1);
  CHECK(book_of(b, 1) == book1);
  CHECK(b.ask("{\"type\":\"command\",\"name\":\"reference\"}", "reference") == refs);
  CHECK(refs.find("\"1\":27500") != std::string::npos);
  CHECK(reason_of(b.request(order_json(20, 1, "BUY", 33100, 1), 20)) == "price_band");

  kill(server, SIGTERM);
  waitpid(server, nullptr, 0);
  std::string cmd = "rm -rf " + dir;
  if (std::system(cmd.c_str()) != 0) std::fprintf(stderr, "could not remove %s\n", dir.c_str());
}

int main(int argc, char **argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: reference_test <engine_server>\n");
    return 2;
  }
  test_exchange();
  test_server(argv[1]);
  return finish("reference_test");
}
