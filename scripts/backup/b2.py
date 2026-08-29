#!/usr/bin/env python3
"""Backblaze B2 NATIVE-API client for the Rasid Production backup system.

Single transport for every B2 operation the system needs:
    put / head / list / get / delete   (+ selftest)

It uses the documented Backblaze **B2 Native API** over the Python standard
library (urllib) — deliberately NOT the S3-compatibility layer.

Why not the S3 path (boto3 / AWS CLI)
-------------------------------------
The AWS S3 SDKs added default data-integrity checksums:
  * AWS CLI v2 >= 2.23 and botocore >= 1.36 attach a CRC32 checksum to
    PutObject and send the body with `Content-Encoding: aws-chunked` and a
    trailing checksum (STREAMING-...-TRAILER).
  * Backblaze B2 does not accept that framing; it reads the object per the
    plain Content-Length and finds fewer object bytes than declared, returning
    `IncompleteBody: The request body was too small`.
  * The documented mitigation `request_checksum_calculation=when_required`
    (env var or Config) is NOT reliably honoured across SDK/CLI versions
    (e.g. s3transfer#327), and it failed for this project on real B2 with both
    `aws s3 cp` and `boto3.put_object(Body=bytes, ContentLength=...)`.

The B2 Native API upload is a single plain HTTPS POST of the raw bytes with an
`X-Bz-Content-Sha1` header that the server verifies. There is no chunked
transfer, no SDK checksum middleware, and Content-Length always equals the
object size. This is immune to the entire IncompleteBody failure class.

Security
--------
Credentials come only from env: B2_KEY_ID (applicationKeyId) and
B2_APPLICATION_KEY (applicationKey) — the SAME GitHub secrets used before.
They are never printed (only object keys and byte sizes are logged). The bucket
(B2_BUCKET_NAME) stays private; every call is scoped to that bucket and callers
scope keys to the `production/` prefix.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

# Overridable only for local mock-server transport tests; defaults to real B2.
AUTH_URL = os.environ.get(
    "B2_AUTH_URL_OVERRIDE",
    "https://api.backblazeb2.com/b2api/v3/b2_authorize_account",
)
USER_AGENT = "rasid-backup/1.0"
FIVE_GB = 5 * 1000 * 1000 * 1000


def _log(msg: str) -> None:
    print(f"[b2] {msg}")


def _die(msg: str, code: int = 1) -> None:
    print(f"::error::[b2] {msg}", file=sys.stderr)
    sys.exit(code)


def _env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        _die(f"required environment variable is not set: {name}")
    return v  # type: ignore[return-value]


def _http(method, url, headers=None, data=None, timeout=180):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", USER_AGENT)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _fail(status, raw, what) -> None:
    code, msg = "?", ""
    try:
        j = json.loads(raw)
        code = j.get("code", "?")
        msg = j.get("message", "")
    except Exception:
        msg = (raw or b"")[:200].decode("utf-8", "replace")
    # Never includes credentials; `what` is a plain endpoint name.
    _die(f"B2 API error {status} {code} on {what}: {msg}")


def _post_json(url, token, payload, timeout=180):
    body = json.dumps(payload).encode()
    status, raw = _http(
        "POST", url,
        {"Authorization": token, "Content-Type": "application/json"},
        body, timeout,
    )
    if status != 200:
        _fail(status, raw, url.rsplit("/", 1)[-1])
    return json.loads(raw)


class B2:
    """Authenticated Backblaze B2 native-API session."""

    def __init__(self):
        key_id = _env("B2_KEY_ID")
        app_key = _env("B2_APPLICATION_KEY")
        basic = base64.b64encode(f"{key_id}:{app_key}".encode()).decode()
        status, raw = _http("POST", AUTH_URL, {"Authorization": f"Basic {basic}"}, b"{}")
        if status != 200:
            _fail(status, raw, "b2_authorize_account")
        a = json.loads(raw)
        sapi = a["apiInfo"]["storageApi"]
        self.api_url = sapi["apiUrl"]
        self.download_url = sapi["downloadUrl"]
        self.account_id = a["accountId"]
        self.token = a["authorizationToken"]
        self.bucket_name = _env("B2_BUCKET_NAME")
        # An application key may already be restricted to a single bucket.
        self.bucket_id = sapi.get("bucketId") or self._resolve_bucket_id()

    def _resolve_bucket_id(self) -> str:
        j = _post_json(
            f"{self.api_url}/b2api/v3/b2_list_buckets", self.token,
            {"accountId": self.account_id, "bucketName": self.bucket_name},
        )
        for b in j.get("buckets", []):
            if b.get("bucketName") == self.bucket_name:
                return b["bucketId"]
        _die(f"bucket not found or not accessible: {self.bucket_name}")
        return ""  # unreachable

    # --- operations ---------------------------------------------------------

    def upload(self, key: str, path: str):
        with open(path, "rb") as f:
            data = f.read()
        size = len(data)
        if size == 0:
            _die(f"refusing to upload empty file: {path}")
        if size > FIVE_GB:
            _die("file exceeds the 5GB single-part limit (large-file upload not implemented)")
        sha1 = hashlib.sha1(data).hexdigest()
        last = None
        for attempt in range(1, 6):
            up = _post_json(
                f"{self.api_url}/b2api/v3/b2_get_upload_url", self.token,
                {"bucketId": self.bucket_id},
            )
            headers = {
                "Authorization": up["authorizationToken"],
                "X-Bz-File-Name": urllib.parse.quote(key, safe="/"),
                "Content-Type": "application/octet-stream",
                "X-Bz-Content-Sha1": sha1,
                "Content-Length": str(size),
            }
            # Plain single POST of the raw bytes — no chunked/aws-chunked framing.
            status, raw = _http("POST", up["uploadUrl"], headers, data)
            if status == 200:
                j = json.loads(raw)
                return int(j["contentLength"]), j.get("contentSha1"), j["fileId"]
            last = (status, raw)
            # Transient upload-url/node conditions: get a fresh upload url + retry.
            if status in (401, 408, 429, 500, 503) and attempt < 5:
                time.sleep(attempt)
                continue
            break
        _fail(last[0], last[1], "b2_upload_file")

    def head(self, key: str):
        """Return exact contentLength for an exact key, or None if absent."""
        j = _post_json(
            f"{self.api_url}/b2api/v3/b2_list_file_names", self.token,
            {"bucketId": self.bucket_id, "prefix": key,
             "startFileName": key, "maxFileCount": 1},
        )
        for f in j.get("files", []):
            if f.get("fileName") == key:
                return int(f["contentLength"])
        return None

    def list(self, prefix: str):
        start = None
        while True:
            payload = {"bucketId": self.bucket_id, "prefix": prefix, "maxFileCount": 10000}
            if start:
                payload["startFileName"] = start
            j = _post_json(f"{self.api_url}/b2api/v3/b2_list_file_names", self.token, payload)
            for f in j.get("files", []):
                yield f
            start = j.get("nextFileName")
            if not start:
                break

    def download(self, key: str, path: str) -> int:
        url = (f"{self.download_url}/file/"
               f"{urllib.parse.quote(self.bucket_name)}/"
               f"{urllib.parse.quote(key, safe='/')}")
        status, raw = _http("GET", url, {"Authorization": self.token})
        if status != 200:
            _fail(status, raw, "b2_download_file_by_name")
        with open(path, "wb") as f:
            f.write(raw)
        return len(raw)

    def _file_id(self, key: str):
        j = _post_json(
            f"{self.api_url}/b2api/v3/b2_list_file_names", self.token,
            {"bucketId": self.bucket_id, "prefix": key,
             "startFileName": key, "maxFileCount": 1},
        )
        for f in j.get("files", []):
            if f.get("fileName") == key:
                return f["fileId"]
        return None

    def delete(self, key: str, file_id: str | None = None) -> None:
        if not file_id:
            file_id = self._file_id(key)
            if not file_id:
                _die(f"cannot delete — file not found: {key}")
        _post_json(
            f"{self.api_url}/b2api/v3/b2_delete_file_version", self.token,
            {"fileName": key, "fileId": file_id},
        )


# --- subcommands -----------------------------------------------------------

def cmd_put(a) -> int:
    if not os.path.isfile(a.file):
        _die(f"file not found: {a.file}", 2)
    local = os.path.getsize(a.file)
    b = B2()
    uploaded, _sha1, _fid = b.upload(a.key, a.file)
    remote = b.head(a.key)
    _log(f"put key={a.key} local={local} uploaded={uploaded} remote={remote}")
    if remote is None:
        _die(f"put verify failed — object not found after upload: {a.key}", 3)
    if int(uploaded) != local or int(remote) != local:
        _die(f"size mismatch key={a.key} local={local} uploaded={uploaded} remote={remote}", 3)
    return 0


def cmd_head(a) -> int:
    n = B2().head(a.key)
    if n is None:
        _die(f"object not found: {a.key}", 4)
    print(int(n))
    return 0


def cmd_list(a) -> int:
    # TSV: <key>\t<upload_epoch_seconds>\t<size>\t<fileId>
    for f in B2().list(a.prefix):
        epoch = int(f["uploadTimestamp"]) // 1000
        print(f"{f['fileName']}\t{epoch}\t{f['contentLength']}\t{f['fileId']}")
    return 0


def cmd_get(a) -> int:
    n = B2().download(a.key, a.file)
    _log(f"get key={a.key} bytes={n}")
    return 0


def cmd_delete(a) -> int:
    B2().delete(a.key, getattr(a, "file_id", None))
    _log(f"deleted key={a.key}")
    return 0


def cmd_selftest(a) -> int:
    """Real B2 round-trip: upload -> head -> list -> download -> delete.

    Writes a tiny throwaway object under production/_selftest/, verifies it,
    then removes it. Touches no Production DB and no real backup objects.
    """
    b = B2()
    tag = os.environ.get("GITHUB_RUN_ID") or "local"
    key = f"production/_selftest/rasid-selftest-{tag}.bin"
    data = os.urandom(4096)
    fd, src = tempfile.mkstemp(prefix="b2selftest-")
    os.write(fd, data)
    os.close(fd)
    dst = src + ".dl"
    try:
        uploaded, _sha1, _fid = b.upload(key, src)
        if uploaded != len(data):
            _die(f"selftest upload size wrong: {uploaded} != {len(data)}")
        remote = b.head(key)
        if remote != len(data):
            _die(f"selftest head size mismatch: {remote} != {len(data)}")
        if not any(f.get("fileName") == key for f in b.list("production/_selftest/")):
            _die("selftest object missing from listing")
        b.download(key, dst)
        with open(dst, "rb") as f:
            got = f.read()
        if got != data:
            _die("selftest downloaded bytes differ from source")
        _log(f"selftest upload+head+list+download OK ({len(data)} bytes) key={key}")
    finally:
        try:
            b.delete(key)
        except SystemExit:
            pass
        except Exception:
            pass
        for p in (src, dst):
            try:
                os.remove(p)
            except OSError:
                pass
    if b.head(key) is not None:
        _die("selftest cleanup failed — object still present after delete")
    _log("selftest PASSED and cleaned up — real Backblaze B2 native transport confirmed")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Rasid Backblaze B2 native-API client")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("put"); sp.add_argument("--key", required=True); sp.add_argument("--file", required=True); sp.set_defaults(fn=cmd_put)
    sp = sub.add_parser("head"); sp.add_argument("--key", required=True); sp.set_defaults(fn=cmd_head)
    sp = sub.add_parser("list"); sp.add_argument("--prefix", default=""); sp.set_defaults(fn=cmd_list)
    sp = sub.add_parser("get"); sp.add_argument("--key", required=True); sp.add_argument("--file", required=True); sp.set_defaults(fn=cmd_get)
    sp = sub.add_parser("delete"); sp.add_argument("--key", required=True); sp.add_argument("--file-id", dest="file_id", default=None); sp.set_defaults(fn=cmd_delete)
    sp = sub.add_parser("selftest"); sp.set_defaults(fn=cmd_selftest)

    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
