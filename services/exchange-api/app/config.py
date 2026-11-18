"""Settings, read once from environment variables (see docs/CONTRACTS.md section 5)."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    engine_host: str = "127.0.0.1"
    engine_port: int = 9100
    data_dir: str = ".run/data"
    memory_db: bool = False  # tests only: keep trades in memory instead of tickforge_db

    # Reference prices (see app/reference.py). Live reads from market-data are off unless asked
    # for, so a test never touches the network.
    reference_live: bool = False
    market_data_url: str = "http://127.0.0.1:8000"
    reference_snapshot: str | None = None  # tests: a snapshot file to use instead of the saved ones
    reference_refresh_seconds: float = 45.0  # how often live prices are read again (30 to 60)
    reference_clear_pct: int = 5  # a new reference clears resting orders this far (percent) from it

    # Knobs for tests; not read from the environment.
    traders_start_running: bool = True
    orders_per_second: float = 4.0  # virtual-trader order rate at speed 1
    tick_seconds: float = 1.0  # how often books, traders and telemetry are pushed
    reconnect_seconds: float = 1.0

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            engine_host=env.get("TICKFORGE_ENGINE_HOST", "127.0.0.1"),
            engine_port=int(env.get("TICKFORGE_ENGINE_PORT", "9100")),
            data_dir=env.get("TICKFORGE_DATA_DIR", ".run/data"),
            memory_db=env.get("TICKFORGE_MEMORY_DB", "") == "1",
            reference_live=env.get("TICKFORGE_REFERENCE", "live") != "snapshot",
            market_data_url=env.get("TICKFORGE_MARKET_DATA_URL", "http://127.0.0.1:8000"),
        )
