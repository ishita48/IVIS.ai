from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).parent


@lru_cache(maxsize=16)
def load(name: str) -> str:
    return (_DIR / name).read_text()
