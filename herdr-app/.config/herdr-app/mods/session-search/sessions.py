"""List and search Claude Code sessions. Usage: sessions.py list | search <query> [--limit N]
Prints a JSON array of {id, title, cwd, mtime(ms)}, newest first. Stdlib only; needs rg for search."""
import json, os, subprocess, sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
PROJECTS = HOME / ".claude" / "projects"
CACHE = HOME / ".cache" / "herdr-session-search" / "index.json"
LIMIT = 200


def first_text(content):
    if isinstance(content, list):
        content = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    return " ".join(content.split())[:80] if isinstance(content, str) else ""


def parse(path):
    ai = other = first = cwd = None
    with open(path, errors="replace") as f:
        for line in f:
            if not (first is None and '"user"' in line or cwd is None and '"cwd"' in line or "title" in line or "summary" in line):
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if not isinstance(o, dict):
                continue
            cwd = cwd or o.get("cwd")
            t = o.get("type")
            if t == "ai-title":
                ai = o.get("aiTitle") or ai
            elif t == "custom-title":
                other = o.get("customTitle") or other
            elif t == "summary":
                other = o.get("summary") or other
            elif t == "user" and first is None:
                first = first_text((o.get("message") or {}).get("content")) or None
    return {"title": ai or other or first or "(untitled)", "cwd": cwd or ""}


def index():
    try:
        cache = json.loads(CACHE.read_text())
    except (OSError, ValueError):
        cache = {}
    out = {}
    for p in PROJECTS.glob("*/*.jsonl"):
        try:
            m = p.stat().st_mtime_ns // 1_000_000
        except OSError:
            continue
        hit = cache.get(str(p))
        if not hit or hit["mtime"] != m:
            try:
                hit = {"mtime": m, **parse(p)}
            except OSError:
                continue
        out[str(p)] = hit
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(out))
    return out


def rows(idx, paths):
    seen, res = set(), []
    for p in paths:
        i = Path(p).stem
        if p in idx and i not in seen:
            seen.add(i)
            res.append({"id": i, **idx[p]})
    return sorted(res, key=lambda r: -r["mtime"])


def search(idx, q):
    if not PROJECTS.is_dir():
        return []
    r = subprocess.run(["rg", "-l", "-F", "-i", "--", q, str(PROJECTS)], capture_output=True, text=True)
    return [p for p in r.stdout.splitlines() if p in idx]


if __name__ == "__main__":
    a = sys.argv[1:]
    limit = int(a[a.index("--limit") + 1]) if "--limit" in a else LIMIT
    q = a[1] if a[:1] == ["search"] and len(a) > 1 and a[1] != "--limit" else ""
    idx = index()
    print(json.dumps(rows(idx, search(idx, q) if q else list(idx))[:limit]))
