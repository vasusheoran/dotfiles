"""List and search Claude Code sessions. Usage: sessions.py list | search <query> [--limit N] | peek <id>
list/search print a JSON array of {id, title, cwd, mtime(ms)}, newest first; search rows also carry
hits: up to 5 {role, ts, text, ranges} snippets. peek prints {first, last} messages. Stdlib only; needs rg for search."""
import json, os, re, subprocess, sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
PROJECTS = HOME / ".claude" / "projects"
CACHE = HOME / ".cache" / "herdr-session-search" / "index.json"
PEEK_CACHE = HOME / ".cache" / "herdr-session-search" / "peek.json"
LIMIT = 200
HITS = 5
SNIP = 240


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


def blocks(o):
    """(role, text) for each text-bearing part of a transcript record."""
    m = o.get("message")
    t = o.get("type")
    c = m.get("content") if isinstance(m, dict) else None
    if t not in ("user", "assistant"):
        return []
    if isinstance(c, str):
        return [(t, c)]
    out = []
    for b in c if isinstance(c, list) else []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text" and isinstance(b.get("text"), str):
            out.append((t, b["text"]))
        elif b.get("type") == "tool_result":
            r = b.get("content")
            if isinstance(r, list):
                r = "\n".join(x.get("text", "") for x in r if isinstance(x, dict) and x.get("type") == "text")
            if isinstance(r, str):
                out.append(("tool", r))
    return [(r, x) for r, x in out if x.strip()]


def snippet(text, start, end):
    """~SNIP chars around [start, end), cut at word boundaries (newlines kept). Returns (text, offset)."""
    pad = max(0, (SNIP - (end - start)) // 2)
    a, b = max(0, start - pad), min(len(text), end + pad)
    while 0 < a < start and not text[a - 1].isspace():
        a += 1
    while end < b < len(text) and not text[b].isspace():
        b -= 1
    return text[a:b].strip(), a + len(text[a:b]) - len(text[a:b].lstrip())


def make_hit(role, ts, text, pat):
    m = pat.search(text)
    if not m:
        return None
    s, off = snippet(text, m.start(), m.end())
    return {"role": role, "ts": ts, "text": s, "ranges": [[x.start(), x.end()] for x in pat.finditer(s)]}


def search(idx, q):
    """{path: [hits]} for sessions whose message text contains q (literal, case-insensitive)."""
    if not PROJECTS.is_dir():
        return {}
    pat = re.compile(re.escape(q), re.I)
    try:
        r = subprocess.run(["rg", "--json", "-F", "-i", "-m", "30", "--", q, str(PROJECTS)], capture_output=True, text=True, errors="replace", timeout=25)
    except subprocess.TimeoutExpired:
        return {}
    res = {}
    for line in r.stdout.splitlines():
        try:
            e = json.loads(line)
            if e["type"] != "match":
                continue
            p = e["data"]["path"]["text"]
            o = json.loads(e["data"]["lines"]["text"])
        except (ValueError, KeyError, TypeError):
            continue
        if p not in idx or not isinstance(o, dict) or len(res.get(p, [])) >= HITS:
            continue
        for role, text in blocks(o):
            h = make_hit(role, o.get("timestamp"), text, pat)
            if h and len(res.setdefault(p, [])) < HITS:
                res[p].append(h)
    return res


def peek(sid):
    files = [p for p in PROJECTS.glob(f"*/{sid}.jsonl")] if re.fullmatch(r"[\w.-]+", sid) and ".." not in sid else []
    if not files:
        return {"first": None, "last": None}
    f = max(files, key=lambda p: p.stat().st_mtime_ns)
    m = f.stat().st_mtime_ns // 1_000_000
    try:
        cache = json.loads(PEEK_CACHE.read_text())
    except (OSError, ValueError):
        cache = {}
    if cache.get(str(f), {}).get("mtime") == m:
        return cache[str(f)]["peek"]
    first = last = None
    with open(f, errors="replace") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if not isinstance(o, dict):
                continue
            for role, text in blocks(o):
                h = {"role": role, "ts": o.get("timestamp"), "text": snippet(text, 0, 0)[0], "ranges": []}
                if role == "user" and first is None:
                    first = h
                elif role == "assistant":
                    last = h
    out = {"first": first, "last": last}
    cache[str(f)] = {"mtime": m, "peek": out}
    PEEK_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PEEK_CACHE.write_text(json.dumps(cache))
    return out


if __name__ == "__main__":
    a = sys.argv[1:]
    limit = int(a[a.index("--limit") + 1]) if "--limit" in a else LIMIT
    if a[:1] == ["peek"]:
        print(json.dumps(peek(a[1] if len(a) > 1 else "")))
        sys.exit()
    q = a[1] if a[:1] == ["search"] and len(a) > 1 and a[1] != "--limit" else ""
    idx = index()
    if q:
        found = search(idx, q)
        out = rows(idx, found)[:limit]
        for r in out:  # same id in two project dirs: merge their hits
            r["hits"] = [h for p, hs in found.items() if Path(p).stem == r["id"] for h in hs][:HITS]
        print(json.dumps(out))
    else:
        print(json.dumps(rows(idx, list(idx))[:limit]))
