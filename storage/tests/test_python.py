"""Smoke test for the Python module. Run against the maturin-built module:

    maturin develop --release
    python -m unittest storage/tests/test_python.py     (or: pytest storage/tests)
"""
import os
import subprocess
import sys
import tempfile
import unittest

from tickforge_db import TickForgeDB

KEYS = [
    "trade_id", "symbol", "price_cents", "quantity", "buy_order_id",
    "sell_order_id", "buyer_id", "seller_id", "timestamp_ms", "buyer_name", "seller_name",
]


def insert(db, trade_id, ts, symbol="AAPL", qty=60):
    db.insert_trade(
        trade_id=trade_id, symbol=symbol, price_cents=18950, quantity=qty,
        buy_order_id=4021, sell_order_id=3990, buyer_id=7, seller_id=12,
        timestamp_ms=ts,
    )


ORDER = dict(order_id=7, trader_id=25, trader_name="Kapinza", side="BUY", symbol="AAPL", quantity=100,
             price_cents=18950, status="open", filled=0, created_ms=1000, updated_ms=1000)


class OrdersAndNames(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_orders_survive_a_reopen_and_the_last_row_wins(self):
        db = TickForgeDB(self.tmp.name)
        db.upsert_order(**ORDER)
        db.upsert_order(**{**ORDER, "order_id": 8, "side": "SELL", "trader_id": 3, "trader_name": "Rahul Verma"})
        db.upsert_order(**{**ORDER, "status": "partially_filled", "filled": 40, "updated_ms": 2000})
        del db
        db = TickForgeDB(self.tmp.name)
        self.assertEqual(db.order_count(), 2)
        row = db.get_order(7)
        self.assertEqual((row["status"], row["filled"], row["trader_name"], row["side"]), ("partially_filled", 40, "Kapinza", "BUY"))
        self.assertEqual([o["order_id"] for o in db.list_orders()], [8, 7])
        self.assertEqual([o["order_id"] for o in db.list_orders(trader_id=25)], [7])
        self.assertIsNone(db.get_order(99))

    def test_bad_orders_are_refused(self):
        db = TickForgeDB(self.tmp.name)
        for bad in ({"status": "bogus"}, {"side": "HOLD"}, {"filled": 101}, {"order_id": 0}):
            with self.assertRaises(ValueError):
                db.upsert_order(**{**ORDER, **bad})

    def test_names_are_stored_on_the_fill_and_survive_a_reopen(self):
        db = TickForgeDB(self.tmp.name)
        db.insert_trade(trade_id=1, symbol="AAPL", price_cents=18950, quantity=10, buy_order_id=7,
                        sell_order_id=8, buyer_id=25, seller_id=3, timestamp_ms=5000,
                        buyer_name="Kapinza", seller_name="Rahul Verma")
        db.insert_trade(trade_id=2, symbol="AAPL", price_cents=18950, quantity=10, buy_order_id=9,
                        sell_order_id=10, buyer_id=4, seller_id=5, timestamp_ms=6000)
        db.flush()  # the names must also survive an SSTable
        db.insert_trade(trade_id=3, symbol="AAPL", price_cents=18960, quantity=5, buy_order_id=11,
                        sell_order_id=12, buyer_id=6, seller_id=25, timestamp_ms=7000,
                        buyer_name="Anil Kumar", seller_name="Kapinza")
        del db
        db = TickForgeDB(self.tmp.name)
        self.assertEqual(db.get_trade(1)["seller_name"], "Rahul Verma")
        self.assertEqual(db.get_trade(2)["buyer_name"], "")
        mine = db.trades_by_trader(25)
        self.assertEqual([t["trade_id"] for t in mine], [3, 1])
        self.assertEqual(mine[0]["buyer_name"], "Anil Kumar")
        self.assertEqual(len(db.trades_by_trader(25, limit=1)), 1)


class IoBackendSetting(unittest.TestCase):
    """TICKFORGE_DB_IO chooses how flush and compaction write their files."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(os.environ.pop, "TICKFORGE_DB_IO", None)

    def test_uring_gives_a_database_the_default_can_read(self):
        os.environ["TICKFORGE_DB_IO"] = "uring"
        try:
            db = TickForgeDB(self.tmp.name)
        except OSError as e:
            self.skipTest(f"no io_uring here: {e}")
        for i in range(1, 2001):
            insert(db, i, 1000 + i)
        db.flush()
        for i in range(2001, 4001):
            insert(db, i, 1000 + i)
        db.flush()
        self.assertGreaterEqual(db.compact(), 2)
        del db
        del os.environ["TICKFORGE_DB_IO"]
        db = TickForgeDB(self.tmp.name)
        self.assertEqual(db.count(), 4000)
        self.assertEqual(db.get_trade(3333)["trade_id"], 3333)

    def test_unknown_value_is_refused(self):
        os.environ["TICKFORGE_DB_IO"] = "nonsense"
        with self.assertRaises(ValueError):
            TickForgeDB(self.tmp.name)


class TickForgeDBSmokeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_insert_get_count(self):
        db = TickForgeDB(self.path)
        self.assertEqual(db.count(), 0)
        self.assertIsNone(db.get_trade(903))
        self.assertIsNone(db.insert_trade(
            trade_id=903, symbol="AAPL", price_cents=18950, quantity=60,
            buy_order_id=4021, sell_order_id=3990, buyer_id=7, seller_id=12,
            timestamp_ms=1767225600123))
        trade = db.get_trade(903)
        self.assertEqual(list(trade.keys()), KEYS)
        self.assertEqual(trade["price_cents"], 18950)
        self.assertEqual(trade["symbol"], "AAPL")
        self.assertEqual(trade["timestamp_ms"], 1767225600123)
        self.assertEqual(db.count(), 1)

    def test_same_id_replaces(self):
        db = TickForgeDB(self.path)
        insert(db, 1, 100, qty=10)
        insert(db, 1, 100, qty=20)
        self.assertEqual(db.count(), 1)
        self.assertEqual(db.get_trade(1)["quantity"], 20)

    def test_range_flush_compact(self):
        db = TickForgeDB(self.path)
        for i in range(1, 301):
            insert(db, i, 1000 + i // 2, symbol="MSFT" if i % 3 == 0 else "AAPL")
            if i % 100 == 0:
                db.flush()
        everything = db.range(0, 10**12)
        self.assertEqual(len(everything), 300)
        keys = [(t["timestamp_ms"], t["trade_id"]) for t in everything]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(db.range(0, 10**12, symbol="MSFT")), 100)
        self.assertEqual(len(db.range(1010, 1020)), 20)  # end is exclusive
        self.assertEqual(db.compact(), 3)
        self.assertEqual(db.range(0, 10**12), everything)
        self.assertEqual(db.count(), 300)
        self.assertEqual(db.compact(), 0)

    def test_bad_arguments_raise_value_error(self):
        db = TickForgeDB(self.path)
        with self.assertRaises(ValueError):
            insert(db, 1, 100, qty=0)
        with self.assertRaises(ValueError):
            insert(db, -1, 100)
        with self.assertRaises(ValueError):
            db.insert_trade(
                trade_id=1, symbol="", price_cents=100, quantity=1, buy_order_id=1,
                sell_order_id=2, buyer_id=0, seller_id=0, timestamp_ms=1)

    def test_bad_path_raises_os_error(self):
        blocker = os.path.join(self.tmp.name, "a_file")
        with open(blocker, "w") as f:
            f.write("x")
        with self.assertRaises(OSError):
            TickForgeDB(os.path.join(blocker, "db"))

    def test_trades_survive_a_killed_process(self):
        code = (
            "import os, sys\n"
            "from tickforge_db import TickForgeDB\n"
            "db = TickForgeDB(sys.argv[1])\n"
            "for i in range(1, 101):\n"
            "    db.insert_trade(trade_id=i, symbol='AAPL', price_cents=100, quantity=1,\n"
            "        buy_order_id=1, sell_order_id=2, buyer_id=0, seller_id=0, timestamp_ms=i)\n"
            "os._exit(9)\n"  # no flush, no cleanup: like a crash
        )
        proc = subprocess.run([sys.executable, "-c", code, self.path])
        self.assertEqual(proc.returncode, 9)
        db = TickForgeDB(self.path)
        self.assertEqual(db.count(), 100)
        self.assertEqual(db.get_trade(77)["timestamp_ms"], 77)


if __name__ == "__main__":
    unittest.main()
