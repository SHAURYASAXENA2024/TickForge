"""Replay the WAL up to a sequence number, on a COPY of the file, in a separate process.

The live WAL is only ever read (copied). The copy is replayed by the `wal_replay` tool, which uses the
engine's own replay code; the live engine is not asked anything.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile

from app.symbols import SYMBOL_IDS

TIMEOUT_SECONDS = 30


class ReplayUnavailable(Exception):
    pass


def wal_path(settings) -> str:
    return settings.wal_path or os.path.join(settings.data_dir, "engine.wal")


async def replay_at(settings, seq: int | None, symbol: str) -> dict:
    binary, wal = settings.replay_bin, wal_path(settings)
    if not binary or not os.path.exists(binary):
        raise ReplayUnavailable("the wal_replay tool is not built (run ./build.sh)")
    if not os.path.exists(wal):
        raise ReplayUnavailable("there is no WAL file yet")
    tmp = tempfile.mkdtemp(prefix="tf-replay-")
    try:
        copy = os.path.join(tmp, "copy.wal")
        await asyncio.get_running_loop().run_in_executor(None, shutil.copyfile, wal, copy)
        args = [binary, copy] + (["--seq", str(seq)] if seq is not None else [])
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ReplayUnavailable("the replay took too long")
        if proc.returncode != 0:
            raise ReplayUnavailable("the replay failed")
        data = json.loads(out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    book = data["books"].get(str(SYMBOL_IDS[symbol]), {"bids": [], "asks": []})
    return {"symbol": symbol, "requested_seq": data["requested_seq"], "seq": data["last_seq"],
            "newest_seq": data["newest_seq_in_file"], "trades": data["trades"], "state_hash": data["state_hash"],
            "bids": book["bids"], "asks": book["asks"], "source": "copy of the WAL"}
