import os
import re
from pathlib import Path, PurePosixPath


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _read_version() -> str:
    """Read the service version from pixi.toml (single source of truth)."""
    pixi_toml = SERVICE_ROOT / "pixi.toml"
    try:
        content = pixi_toml.read_text(encoding="utf-8")
        match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            return match.group(1)
    except OSError:
        pass
    return "0.0.0"


SERVICE_VERSION = _read_version()
WORKSPACE_ROOT = SERVICE_ROOT.parent
DATA_ROOT = Path(os.environ.get("DATA_DIR", str(WORKSPACE_ROOT / "data"))).resolve()
SETS_MANIFEST_PATH = DATA_ROOT / "sets.json"
PORT = int(os.environ.get("PORT", "8004"))
TILE_SIZE = 256
RGB_ELEVATION_FORMULA = "elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)"
CONTAINER_DATA_ROOT = PurePosixPath("/app/data")


def _is_within_data_root(candidate: Path) -> bool:
    try:
        candidate.relative_to(DATA_ROOT)
        return True
    except ValueError:
        return False


def resolve_runtime_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.exists():
        return candidate.resolve()

    normalized = raw_path.replace("\\", "/")
    if normalized.startswith(f"{CONTAINER_DATA_ROOT.as_posix()}/"):
        relative = PurePosixPath(normalized).relative_to(CONTAINER_DATA_ROOT)
        fallback = (DATA_ROOT / Path(*relative.parts)).resolve()
        if fallback.exists() and _is_within_data_root(fallback):
            return fallback

    if normalized.startswith("/"):
        trimmed = normalized.removeprefix("/")
        fallback = (DATA_ROOT / Path(trimmed)).resolve()
        if fallback.exists() and _is_within_data_root(fallback):
            return fallback

    fallback = (DATA_ROOT / raw_path).resolve()
    if fallback.exists() and _is_within_data_root(fallback):
        return fallback
    return candidate.resolve()

