import os
from pathlib import Path, PurePosixPath


SERVICE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVICE_ROOT.parent
DATA_ROOT = Path(os.environ.get("DATA_DIR", str(WORKSPACE_ROOT / "data"))).resolve()
SETS_MANIFEST_PATH = DATA_ROOT / "sets.json"
PORT = int(os.environ.get("PORT", "8004"))
TILE_SIZE = 256
RGB_ELEVATION_FORMULA = "elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)"
CONTAINER_DATA_ROOT = PurePosixPath("/app/data")


def resolve_runtime_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.exists():
        return candidate.resolve()

    normalized = raw_path.replace("\\", "/")
    if normalized.startswith(f"{CONTAINER_DATA_ROOT.as_posix()}/"):
        relative = PurePosixPath(normalized).relative_to(CONTAINER_DATA_ROOT)
        fallback = (DATA_ROOT / Path(*relative.parts)).resolve()
        if fallback.exists():
            return fallback

    if normalized.startswith("/"):
        trimmed = normalized.removeprefix("/")
        fallback = (DATA_ROOT / Path(trimmed)).resolve()
        if str(fallback).startswith(str(DATA_ROOT)) and fallback.exists():
            return fallback

    fallback = (DATA_ROOT / raw_path).resolve()
    if str(fallback).startswith(str(DATA_ROOT)) and fallback.exists():
        return fallback

    return candidate.resolve()

