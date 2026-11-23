import pytest


@pytest.fixture(autouse=True)
def _snapshot_in_tmp(tmp_path, monkeypatch):
    """Keep the saved-snapshot file out of the source tree."""
    monkeypatch.setenv("TICKFORGE_DATA_DIR", str(tmp_path))
