#!/usr/bin/env python3
"""Crash check on the Release engine: send orders, kill -9, restart on the same WAL.

The state hash and the book must be identical before and after the crash.

    kill9_check.py <engine_server> <work dir> [engine flags...]

Prints both hashes and exits non-zero if they differ.
"""
import json
import os
import random
import shutil
import signal
import socket
import subprocess
import sys
import time

ORDERS = 20000


def start(exe, port, wal, flags, log):
    return subprocess.Popen([exe, "--port", str(port), "--wal", wal, *flags], stderr=log)


def connect(port):
    for _ in range(200):
        try:
            return socket.create_connection(("127.0.0.1", port))
        except OSError:
            time.sleep(0.05)
    raise SystemExit("server did not start")


class Client:
    def __init__(self, port):
        self.sock = connect(port)
        self.buf = b""

    def line(self):
        while b"\n" not in self.buf:
            data = self.sock.recv(65536)
            if not data:
                raise SystemExit("server closed the connection")
            self.buf += data
        line, self.buf = self.buf.split(b"\n", 1)
        return json.loads(line)

    def ask(self, message, reply_type):
        self.sock.sendall((json.dumps(message) + "\n").encode())
        while True:
            reply = self.line()
            if reply.get("type") == reply_type:
                return reply

    def snapshot(self):
        state = self.ask({"type": "command", "name": "state_hash"}, "state_hash")
        books = [self.ask({"type": "command", "name": "book", "symbol_id": s, "depth": 100}, "book")
                 for s in (1, 2, 3)]
        # Balances and locks of every account, not only the hash that covers them.
        accounts = self.ask({"type": "command", "name": "accounts"}, "accounts")
        return state, books, accounts


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    exe, work, flags = sys.argv[1], sys.argv[2], sys.argv[3:]
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    wal = os.path.join(work, "engine.wal")
    port = 21000 + os.getpid() % 20000
    rng = random.Random(42)
    amend_rng = random.Random(43)  # separate, so the order stream is the same as before amends existed

    with open(os.path.join(work, "engine.log"), "w") as log:
        server = start(exe, port, wal, flags, log)
        client = Client(port)
        accepted = []
        rejected = 0
        for ref in range(ORDERS):
            if accepted and rng.random() < 0.1:
                message = {"type": "cancel", "client_ref": ref, "order_id": rng.choice(accepted[-200:])}
            elif accepted and amend_rng.random() < 0.08:  # lower the quantity of a recent order
                message = {"type": "amend", "client_ref": ref, "order_id": amend_rng.choice(accepted[-200:]),
                           "qty": amend_rng.randint(1, 60)}
            else:
                message = {"type": "new_order", "client_ref": ref, "trader_id": rng.randint(0, 5),
                           "symbol_id": rng.randint(1, 3),
                           "side": rng.choice(["BUY", "SELL"]), "price": rng.randint(9900, 10100),
                           "qty": rng.randint(1, 100)}
            client.sock.sendall((json.dumps(message) + "\n").encode())
            while True:
                reply = client.line()
                if reply.get("client_ref") == ref and reply.get("type") in ("ack", "reject"):
                    break
            if reply["type"] == "ack" and message["type"] == "new_order":
                accepted.append(reply["order_id"])
            elif reply["type"] == "reject" and reply.get("reason", "").startswith("insufficient"):
                rejected += 1

        before = client.snapshot()
        server.send_signal(signal.SIGKILL)
        server.wait()

        server = start(exe, port, wal, flags, log)
        after = Client(port).snapshot()
        server.terminate()
        server.wait()

    print(f"flags:          {' '.join(flags) or '(defaults)'}")
    print(f"orders sent:    {ORDERS}, last_seq {before[0]['last_seq']}")
    print(f"before kill -9: {before[0]['hash']}")
    print(f"after restart:  {after[0]['hash']}")
    if before[2]["enabled"]:
        locked = sum(a["reserved_cash"] for a in before[2]["accounts"])
        shares = sum(sum(a["reserved_shares"].values()) for a in before[2]["accounts"])
        print(f"accounts:       {len(before[2]['accounts'])} traders, {locked} cents and {shares} shares locked, "
              f"{rejected} orders rejected for funds")
    if before != after:
        print("RESULT: MISMATCH")
        return 1
    print("RESULT: state hash, books, balances and locks identical")
    shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
