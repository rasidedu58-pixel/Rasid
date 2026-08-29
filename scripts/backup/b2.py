#!/usr/bin/env python3
"""Backblaze B2 (S3-compatible) client for the Rasid Production backup system.

This is the SINGLE transport for every B2 operation the backup system needs —
put / head / list / delete / get — so upload, retention and the weekly restore
verification can never diverge on endpoint, region, signing or checksum
behaviour.

Why boto3 instead of the AWS CLI
--------------------------------
AWS CLI v2 (>= 2.23) enables request integrity checksums by default and, for
PutObject, sends the body using `Content-Encoding: aws-chunked` with a checksum
trailer (STREAMING-...-TRAILER). Backblaze B2 counts the decoded body against
the framed Content-Length and rejects it with:

    IncompleteBody: The request body was too small

The `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` env var does NOT reliably
stop the CLI from using the chunked/trailer encoding, so `aws s3 cp` AND
`aws s3api put-object --body` both fail against B2. Instead we use boto3
configured explicitly for B2 and upload the object as an in-memory *bytes*
body, which botocore sends as a single plain PutObject with a correct
Content-Length and a full-payload SigV4 signature — no aws-chunked, no trailer,
no multipart. That is the transport B2 accepts.

Security: credentials come ONLY from the environment (B2_KEY_ID /
B2_APPLICATION_KEY) and are never printed. Only object keys and byte sizes are
logged.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

# Belt-and-suspenders: force the pre-2.23 checksum behaviour even for older
# botocore that ignores the Config kwargs below. Must precede the boto3 import.
os.environ.setdefault("AWS_REQUEST_CHECKSUM_CALCULATION", "when_required")
os.environ.setdefault("AWS_RESPONSE_CHECKSUM_VALIDATION", "when_required")

import boto3  # noqa: E402
from botocore.config import Config  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402


def _endpoint() -> str:
    ep = os.environ["B2_ENDPOINT"].strip()
    if not re.match(r"^https?://", ep):
        ep = "https://" + ep
    return ep.rstrip("/")


def _region(ep: str) -> str:
    # https://s3.eu-central-003.backblazeb2.com -> eu-central-003
    host = re.sub(r"^https?://", "", ep)
    host = re.sub(r"^s3\.", "", host)
    host = re.sub(r"\.backblazeb2\.com/?$", "", host)
    return host


def _bucket(explicit: str | None) -> str:
    b = explicit or os.environ.get("B2_BUCKET_NAME")
    if not b:
        _die("B2 bucket not provided (set B2_BUCKET_NAME or pass --bucket)")
    return b


def _client():
    ep = _endpoint()
    region = _region(ep)
    for var in ("B2_KEY_ID", "B2_APPLICATION_KEY"):
        if not os.environ.get(var):
            _die(f"required environment variable is not set: {var}")
    common = dict(
        signature_version="s3v4",
        s3={"addressing_style": "path", "payload_signing_enabled": True},
        retries={"max_attempts": 5, "mode": "standard"},
    )
    # botocore >= 1.36 accepts these; older versions rely on the env vars above.
    try:
        cfg = Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            **common,
        )
    except TypeError:
        cfg = Config(**common)
    return boto3.client(
        "s3",
        endpoint_url=ep,
        region_name=region,
        aws_access_key_id=os.environ["B2_KEY_ID"],
        aws_secret_access_key=os.environ["B2_APPLICATION_KEY"],
        config=cfg,
    )


def _log(msg: str) -> None:
    print(f"[b2] {msg}")


def _die(msg: str, code: int = 1) -> None:
    print(f"::error::[b2] {msg}", file=sys.stderr)
    sys.exit(code)


def cmd_put(a) -> int:
    """Single-request PutObject from a local file, then verify exact size."""
    if not os.path.isfile(a.file):
        _die(f"file not found: {a.file}", 2)
    with open(a.file, "rb") as fh:
        data = fh.read()
    size = len(data)
    if size == 0:
        _die(f"refusing to upload empty file: {a.file}", 2)
    c = _client()
    bucket = _bucket(a.bucket)
    # In-memory bytes body => plain PutObject, correct Content-Length, no chunk.
    c.put_object(Bucket=bucket, Key=a.key, Body=data, ContentLength=size)
    # Immediate server-side confirmation of exact byte size.
    try:
        head = c.head_object(Bucket=bucket, Key=a.key)
    except ClientError as e:
        _die(f"put verify failed — head_object missing for {a.key}: "
             f"{e.response.get('Error', {}).get('Code', '?')}", 3)
    remote = int(head["ContentLength"])
    _log(f"put key={a.key} local={size} remote={remote}")
    if remote != size:
        _die(f"size mismatch key={a.key} local={size} remote={remote}", 3)
    return 0


def cmd_head(a) -> int:
    """Print the exact ContentLength of one object; non-zero exit if missing."""
    c = _client()
    try:
        head = c.head_object(Bucket=_bucket(a.bucket), Key=a.key)
    except ClientError:
        _die(f"object not found: {a.key}", 4)
    print(int(head["ContentLength"]))
    return 0


def cmd_list(a) -> int:
    """Emit TSV: <key>\\t<lastmodified_epoch>\\t<size> for every object."""
    c = _client()
    bucket = _bucket(a.bucket)
    paginator = c.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=a.prefix):
        for o in page.get("Contents", []) or []:
            epoch = int(o["LastModified"].timestamp())
            print(f"{o['Key']}\t{epoch}\t{o['Size']}")
    return 0


def cmd_delete(a) -> int:
    c = _client()
    c.delete_object(Bucket=_bucket(a.bucket), Key=a.key)
    _log(f"deleted key={a.key}")
    return 0


def cmd_get(a) -> int:
    """Single-request GetObject to a local file (no managed multipart)."""
    c = _client()
    try:
        r = c.get_object(Bucket=_bucket(a.bucket), Key=a.key)
    except ClientError:
        _die(f"object not found: {a.key}", 4)
    body = r["Body"].read()
    with open(a.file, "wb") as fh:
        fh.write(body)
    _log(f"get key={a.key} bytes={len(body)}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Rasid Backblaze B2 client")
    p.add_argument("--bucket", default=None, help="defaults to $B2_BUCKET_NAME")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("put"); sp.add_argument("--key", required=True); sp.add_argument("--file", required=True); sp.set_defaults(fn=cmd_put)
    sp = sub.add_parser("head"); sp.add_argument("--key", required=True); sp.set_defaults(fn=cmd_head)
    sp = sub.add_parser("list"); sp.add_argument("--prefix", default=""); sp.set_defaults(fn=cmd_list)
    sp = sub.add_parser("delete"); sp.add_argument("--key", required=True); sp.set_defaults(fn=cmd_delete)
    sp = sub.add_parser("get"); sp.add_argument("--key", required=True); sp.add_argument("--file", required=True); sp.set_defaults(fn=cmd_get)

    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
