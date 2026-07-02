#!/usr/bin/env python3
"""Deterministic state engine for the feedback sweep (ce-sweep).

This helper owns ALL reads and writes of the sweep state file. Peer agents
(source connectors, the analyzer, the orchestrator) never edit the file by
hand — they go through these subcommands so the schema contract, the id-keyed
merge, the single-writer lease, and the closed-item evidence rule are enforced
in exactly one place. See `references/state-schema.md` for the cross-agent
contract this script implements.

Design rules (mirrors the repo's repo-profile-cache helper):
  - Pure Python 3 stdlib. No third-party dependencies.
  - Every OPERATIONAL failure path prints a parseable STATUS WORD on line 1 and
    exits 0 — it never raises a traceback to the caller. Only genuine CLI
    misuse (bad/missing subcommand args) exits non-zero via argparse.
  - Writes are atomic: a temp file in the state dir + os.replace (atomic on
    POSIX), so a concurrent reader never sees a torn file.
  - The script never calls the wall clock for the values it stores EXCEPT the
    lease timestamp (staleness needs "now"). Tests pin it with --now / stamp
    values with --timestamp so behavior is reproducible.

STATUS WORDS (line 1 of stdout for every subcommand):
  OK               success (an optional JSON payload follows on line 2)
  NO-STATE         read: the state file does not exist yet
  CORRUPT          the state file exists but does not parse as our schema
  LOCKED           lease-acquire: a live lease is held by another writer
  STALE-RECLAIMED  lease-acquire: an expired lease was taken over (JSON payload)
  LEASE-LOST       a mutating call was made by a writer that does not own the
                   lease (or a release of another writer's lease); no write
  REFUSED          cursor-advance: unknown past-item, or non-monotonic cursor
  ERROR            an unexpected internal error (defensive; never a traceback)

The state file is genuine YAML restricted to a small, deliberate subset so a
hand-written stdlib serializer/parser round-trips it deterministically. See
`references/state-schema.md` (section "YAML subset") for the exact grammar:
non-empty dict values become block mappings (any depth); scalars are emitted as
JSON tokens (strings always double-quoted on one line); lists and empty dicts
are emitted as inline JSON flow on a single line — itself valid YAML.
"""
import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

SCHEMA_VERSION = 1

# Closed lifecycle enum (documented in the schema). Unknown statuses are
# preserved on write-back, never dropped — this list is for reference and for
# the evidence rule, not a whitelist that rejects values.
STATUSES = (
    "ingested", "ack_deferred", "acknowledged", "needs_download",
    "needs_analysis", "manual_stuck", "analyzed", "in_plan",
    "fix_pending", "closed", "source_gone",
)

# A `closed` item MUST carry all three evidence fields; `validate` downgrades
# any closed item missing any of them back to `fix_pending`.
EVIDENCE_FIELDS = ("fix_ref", "verified_merge_sha", "verified_at")

DEFAULT_TTL_MINUTES = 60


# --------------------------------------------------------------------------- #
# Minimal YAML subset: serializer + parser
# --------------------------------------------------------------------------- #
# Grammar (2-space indent, no tabs):
#   - Block mappings: `<key>: <value>` or `<key>:` (nested mapping follows).
#   - Keys: a bare token matching _SAFE_KEY, else a JSON double-quoted string.
#   - Scalars: null / true / false / integers / floats emitted bare; strings
#     always emitted as JSON double-quoted (single line, fully escaped).
#   - Nested containers (dict/list) that are NOT part of the known block
#     structure are emitted as inline JSON flow on one line — valid YAML.
# The emitter only produces block MAPPINGS (never block sequences); the parser
# tolerates arbitrary-depth block mappings plus scalar / inline-JSON values.

import re

_SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]*$")

# Preferred key orders for deterministic, human-legible output. Any keys not
# listed are appended in sorted order so unknown/preserved fields stay stable.
_DOC_ORDER = ("schema_version", "lease", "sources", "items", "last_run")
_LEASE_ORDER = ("writer", "timestamp", "ttl_minutes")
_ITEM_ORDER = (
    "source", "status", "sensitive", "title", "url", "body", "quote",
    "fix_ref", "verified_merge_sha", "verified_at",
)
_LAST_RUN_ORDER = ("timestamp", "outcome", "writer", "counts")


def _ordered_keys(d, preferred):
    seen = [k for k in preferred if k in d]
    rest = sorted(k for k in d if k not in preferred)
    return seen + rest


def _emit_key(key):
    key = str(key)
    if _SAFE_KEY.match(key):
        return key
    return json.dumps(key, ensure_ascii=False)


def _emit_scalar(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    # dict / list → inline JSON flow (valid YAML), sorted for determinism.
    return json.dumps(v, ensure_ascii=False, sort_keys=True)


def _emit_mapping(d, indent, preferred):
    """Emit a dict as block YAML. Only nests block-style for child dicts;
    lists and any other container leaf are emitted inline via _emit_scalar."""
    pad = "  " * indent
    lines = []
    for key in _ordered_keys(d, preferred):
        val = d[key]
        ks = _emit_key(key)
        if isinstance(val, dict) and val:
            lines.append(f"{pad}{ks}:")
            # Nested item/source/lease/last_run maps: no special preferred order
            # for arbitrary nested dicts; only the top structural maps below get
            # a preferred order (handled by their callers).
            child_pref = _child_preferred(indent, key)
            lines.extend(_emit_mapping(val, indent + 1, child_pref))
        else:
            lines.append(f"{pad}{ks}: {_emit_scalar(val)}")
    return lines


def _child_preferred(parent_indent, key):
    """Preferred child-key order for the known structural containers."""
    if parent_indent == 0:
        if key == "lease":
            return _LEASE_ORDER
        if key == "last_run":
            return _LAST_RUN_ORDER
        return ()  # sources / items: children are id-keyed, no field order
    # A source entry or item entry: apply the item field order (harmless for
    # source entries, which only carry `cursor`/`sensitive`).
    return _ITEM_ORDER


def emit_document(state):
    lines = _emit_mapping(state, 0, _DOC_ORDER)
    return "\n".join(lines) + "\n"


def _split_key(content):
    """Split a mapping line into (key, rest-after-colon). Raises ValueError on
    a line with no colon so a malformed file surfaces as CORRUPT."""
    if content.startswith('"'):
        key, end = json.JSONDecoder().raw_decode(content)
        rest = content[end:]
        if not rest.startswith(":"):
            raise ValueError("expected ':' after quoted key")
        return key, rest[1:]
    idx = content.find(":")
    if idx == -1:
        raise ValueError("expected ':' in mapping line")
    return content[:idx], content[idx + 1:]


_BLOCK = object()  # sentinel: value is a nested block, parse deeper lines


def _parse_value(rest):
    rest = rest.strip()
    if rest == "":
        return _BLOCK
    if rest == "null":
        return None
    if rest == "true":
        return True
    if rest == "false":
        return False
    first = rest[0]
    if first in '"{[':
        return json.loads(rest)  # JSON string, object, or array (flow style)
    if first == "-" or first.isdigit():
        try:
            if "." in rest or "e" in rest or "E" in rest:
                return float(rest)
            return int(rest)
        except ValueError:
            pass
    # Emitter never produces bare unquoted strings; a bare token here is a
    # hand-edit — keep it verbatim rather than failing.
    return rest


def _parse_mapping(rows, cursor, indent):
    result = {}
    while cursor["i"] < len(rows):
        cur_indent, content = rows[cursor["i"]]
        if cur_indent < indent:
            break
        if cur_indent > indent:
            # Orphan deeper line with no parent key; skip defensively.
            cursor["i"] += 1
            continue
        cursor["i"] += 1
        key, rest = _split_key(content)
        val = _parse_value(rest)
        if val is _BLOCK:
            if cursor["i"] < len(rows) and rows[cursor["i"]][0] > indent:
                val = _parse_mapping(rows, cursor, rows[cursor["i"]][0])
            else:
                val = {}
        result[key] = val
    return result


def parse_document(text):
    rows = []
    for raw in text.split("\n"):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        rows.append((indent, stripped))
    if not rows:
        return {}
    return _parse_mapping(rows, {"i": 0}, rows[0][0])


# --------------------------------------------------------------------------- #
# State load / save
# --------------------------------------------------------------------------- #

def load_state(path):
    """Return (status, data): ('absent', None), ('corrupt', None), or
    ('ok', dict). A file that parses but lacks schema_version is corrupt."""
    if not os.path.exists(path):
        return ("absent", None)
    try:
        with open(path) as f:
            text = f.read()
    except OSError:
        return ("corrupt", None)
    if not text.strip():
        return ("absent", None)
    try:
        data = parse_document(text)
    except Exception:
        return ("corrupt", None)
    if not isinstance(data, dict) or "schema_version" not in data:
        return ("corrupt", None)
    data.setdefault("sources", {})
    data.setdefault("items", {})
    return ("ok", data)


def new_state():
    return {"schema_version": SCHEMA_VERSION, "sources": {}, "items": {}}


def write_state(path, state):
    """Atomic write of the state file. Returns True on success."""
    state["schema_version"] = SCHEMA_VERSION
    text = emit_document(state)
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-sweep-", suffix=".yml")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return True


# --------------------------------------------------------------------------- #
# Output + time helpers
# --------------------------------------------------------------------------- #

def emit(status_word, payload=None):
    print(status_word)
    if payload is not None:
        print(json.dumps(payload))
    return 0


def resolve_now(args):
    """The 'current time' for lease staleness + lease re-stamping. Pinned by
    --now in tests; otherwise the real UTC clock."""
    now = getattr(args, "now", None)
    if now:
        return now
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s):
    if not isinstance(s, str) or not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def current_lease(state):
    """The active lease dict (with a non-empty writer), or None."""
    lease = state.get("lease")
    if isinstance(lease, dict) and lease.get("writer"):
        return lease
    return None


def lease_is_stale(lease, now_iso):
    """True only when we can PROVE the lease is older than its TTL. If either
    timestamp is unparseable we cannot prove staleness → treat as live (do not
    reclaim). Conservative: never stomp a lease we cannot show is expired."""
    ts = _parse_iso(lease.get("timestamp", ""))
    now = _parse_iso(now_iso)
    if ts is None or now is None:
        return False
    try:
        ttl = int(lease.get("ttl_minutes", DEFAULT_TTL_MINUTES))
    except (TypeError, ValueError):
        ttl = DEFAULT_TTL_MINUTES
    return (now - ts).total_seconds() > ttl * 60


def restamp_lease(state, writer, now_iso):
    """Refresh the owning writer's lease timestamp so a long sweep keeps it
    alive across many writes. Only called after ownership is confirmed."""
    lease = state.get("lease")
    if isinstance(lease, dict) and lease.get("writer") == writer:
        lease["timestamp"] = now_iso


def owns_lease(state, writer):
    lease = current_lease(state)
    return lease is not None and lease.get("writer") == writer


# --------------------------------------------------------------------------- #
# Subcommands
# --------------------------------------------------------------------------- #

def cmd_read(args):
    st, data = load_state(args.state)
    if st == "absent":
        return emit("NO-STATE")
    if st == "corrupt":
        return emit("CORRUPT")
    return emit("OK", data)


def cmd_validate(args):
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        return emit("OK", {"downgraded": []})
    downgraded = []
    for item_id, item in data.get("items", {}).items():
        if not isinstance(item, dict):
            continue
        if item.get("status") == "closed" and any(
            not item.get(f) for f in EVIDENCE_FIELDS
        ):
            item["status"] = "fix_pending"
            downgraded.append(item_id)
    if downgraded:
        write_state(args.state, data)
    return emit("OK", {"downgraded": sorted(downgraded)})


def cmd_upsert_item(args):
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        # No state means no lease to own → the caller is not the owner.
        return emit("LEASE-LOST")
    if not owns_lease(data, args.writer):
        return emit("LEASE-LOST")
    try:
        incoming = json.loads(args.json)
    except (ValueError, TypeError):
        return emit("ERROR")
    if not isinstance(incoming, dict):
        return emit("ERROR")

    items = data.setdefault("items", {})
    existing = items.get(args.id)
    merged = dict(existing) if isinstance(existing, dict) else {}
    # id-keyed merge: only the keys present in the incoming item are replaced;
    # unknown fields already on the item survive untouched.
    merged.update(incoming)
    merged["source"] = args.source

    source_entry = data.get("sources", {}).get(args.source, {})
    is_sensitive = (
        merged.get("sensitive") is True
        or (isinstance(source_entry, dict) and source_entry.get("sensitive") is True)
    )
    if is_sensitive:
        for f in ("body", "quote"):
            merged.pop(f, None)

    items[args.id] = merged
    restamp_lease(data, args.writer, resolve_now(args))
    write_state(args.state, data)
    return emit("OK")


def cmd_cursor_get(args):
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        return emit("OK", {"cursor": None})
    entry = data.get("sources", {}).get(args.source, {})
    cursor = entry.get("cursor") if isinstance(entry, dict) else None
    return emit("OK", {"cursor": cursor})


def cmd_cursor_advance(args):
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        return emit("LEASE-LOST")
    if not owns_lease(data, args.writer):
        return emit("LEASE-LOST")
    # The cursor may only advance past an item that actually exists in state,
    # so a resume never skips unrecorded items.
    if args.past_item not in data.get("items", {}):
        return emit("REFUSED")
    entry = data.setdefault("sources", {}).setdefault(args.source, {})
    current = entry.get("cursor")
    # Monotonic guard: string comparison. Cursors are chosen to sort in arrival
    # order (e.g. zero-padded Slack ts strings, ISO timestamps). A new cursor
    # sorting strictly before the current one is refused; equal is allowed
    # (idempotent re-advance).
    if current is not None and str(args.to) < str(current):
        return emit("REFUSED")
    entry["cursor"] = args.to
    restamp_lease(data, args.writer, resolve_now(args))
    write_state(args.state, data)
    return emit("OK")


def cmd_lease_acquire(args):
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        data = new_state()
    now = resolve_now(args)
    ttl = args.ttl_minutes if args.ttl_minutes is not None else DEFAULT_TTL_MINUTES
    lease = current_lease(data)
    if lease is None or lease.get("writer") == args.writer:
        # Free, or re-entrant acquire by the same writer: (re)stamp and take it.
        data["lease"] = {"writer": args.writer, "timestamp": now, "ttl_minutes": ttl}
        write_state(args.state, data)
        return emit("OK")
    if lease_is_stale(lease, now):
        prev = {
            "previous_writer": lease.get("writer"),
            "previous_timestamp": lease.get("timestamp"),
        }
        data["lease"] = {"writer": args.writer, "timestamp": now, "ttl_minutes": ttl}
        write_state(args.state, data)
        return emit("STALE-RECLAIMED", prev)
    return emit("LOCKED")


def cmd_lease_release(args):
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        return emit("OK")  # nothing to release
    lease = current_lease(data)
    if lease is None:
        return emit("OK")
    if lease.get("writer") != args.writer:
        return emit("LEASE-LOST")  # never release another writer's lease
    data.pop("lease", None)
    write_state(args.state, data)
    return emit("OK")


def cmd_run_record(args):
    # Intentionally lease-agnostic: an `aborted-locked` run could not acquire
    # the lease yet must still record its outcome. In local-commit mode there
    # is a single writer per checkout, so this bookkeeping write is safe.
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        data = new_state()
    try:
        counts = json.loads(args.counts)
    except (ValueError, TypeError):
        counts = {}
    data["last_run"] = {
        "timestamp": args.timestamp,
        "outcome": args.outcome,
        "writer": args.writer,
        "counts": counts,
    }
    write_state(args.state, data)
    return emit("OK")


def cmd_import_legacy(args):
    """Best-effort import of a Cora-style legacy state file. Liberal on input:
    map what matches the known shapes, skip what doesn't, never fail."""
    st, data = load_state(args.state)
    if st == "corrupt":
        return emit("CORRUPT")
    if st == "absent":
        data = new_state()

    legacy = _read_legacy(args.file)
    cursors_imported = 0
    items_imported = 0
    if isinstance(legacy, dict):
        cursors_imported = _import_channels(legacy, data)
        items_imported = _import_legacy_items(legacy, data)

    write_state(args.state, data)
    return emit("OK", {
        "cursors_imported": cursors_imported,
        "items_imported": items_imported,
    })


def _read_legacy(path):
    try:
        with open(path) as f:
            raw = f.read()
    except OSError:
        return None
    # Try JSON first (Cora persists JSON); fall back to our YAML subset.
    try:
        return json.loads(raw)
    except ValueError:
        pass
    try:
        return parse_document(raw)
    except Exception:
        return None


def _import_channels(legacy, data):
    channels = legacy.get("channels")
    if not isinstance(channels, dict):
        return 0
    sources = data.setdefault("sources", {})
    count = 0
    for chan_id, chan in channels.items():
        if not isinstance(chan, dict):
            continue
        cursor = chan.get("last_processed_ts") or chan.get("cursor")
        if cursor is None:
            continue
        entry = sources.setdefault(str(chan_id), {})
        entry["cursor"] = cursor
        count += 1
    return count


def _import_legacy_items(legacy, data):
    raw_items = legacy.get("items")
    items = data.setdefault("items", {})
    count = 0

    def add(item_id, fields):
        if not item_id:
            return 0
        merged = dict(items.get(str(item_id), {}))
        for k in ("status", "source", "channel", "title", "url"):
            if k in fields and fields[k] is not None:
                key = "source" if k == "channel" else k
                merged.setdefault(key, fields[k])
        items[str(item_id)] = merged
        return 1

    if isinstance(raw_items, dict):
        for item_id, fields in raw_items.items():
            if isinstance(fields, dict):
                count += add(item_id, fields)
    elif isinstance(raw_items, list):
        for entry in raw_items:
            if isinstance(entry, dict):
                count += add(entry.get("id"), entry)
    return count


# --------------------------------------------------------------------------- #
# CLI wiring
# --------------------------------------------------------------------------- #

def build_parser():
    p = argparse.ArgumentParser(description="ce-sweep deterministic state engine")
    sub = p.add_subparsers(dest="cmd", required=True)

    def with_state(sp):
        sp.add_argument("--state", required=True)
        return sp

    with_state(sub.add_parser("read"))
    with_state(sub.add_parser("validate"))

    up = with_state(sub.add_parser("upsert-item"))
    up.add_argument("--id", required=True)
    up.add_argument("--source", required=True)
    up.add_argument("--json", required=True)
    up.add_argument("--writer", required=True)
    up.add_argument("--now")

    cg = with_state(sub.add_parser("cursor-get"))
    cg.add_argument("--source", required=True)

    ca = with_state(sub.add_parser("cursor-advance"))
    ca.add_argument("--source", required=True)
    ca.add_argument("--to", required=True)
    ca.add_argument("--past-item", required=True)
    ca.add_argument("--writer", required=True)
    ca.add_argument("--now")

    la = with_state(sub.add_parser("lease-acquire"))
    la.add_argument("--writer", required=True)
    la.add_argument("--ttl-minutes", type=int, default=None)
    la.add_argument("--now")

    lr = with_state(sub.add_parser("lease-release"))
    lr.add_argument("--writer", required=True)

    rr = with_state(sub.add_parser("run-record"))
    rr.add_argument("--writer", required=True)
    rr.add_argument(
        "--outcome", required=True,
        choices=("completed", "aborted-locked", "partial", "failed"),
    )
    rr.add_argument("--counts", required=True)
    rr.add_argument("--timestamp", required=True)

    il = with_state(sub.add_parser("import-legacy"))
    il.add_argument("--file", required=True)

    return p


_HANDLERS = {
    "read": cmd_read,
    "validate": cmd_validate,
    "upsert-item": cmd_upsert_item,
    "cursor-get": cmd_cursor_get,
    "cursor-advance": cmd_cursor_advance,
    "lease-acquire": cmd_lease_acquire,
    "lease-release": cmd_lease_release,
    "run-record": cmd_run_record,
    "import-legacy": cmd_import_legacy,
}


def main(argv):
    args = build_parser().parse_args(argv[1:])
    handler = _HANDLERS[args.cmd]
    try:
        return handler(args)
    except Exception as exc:  # never leak a traceback to the caller
        sys.stderr.write(f"sweep-state: internal error: {exc}\n")
        return emit("ERROR")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
