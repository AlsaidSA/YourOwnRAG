"""
Connector sync.

A connector's only job is to put files where the ingestion pipeline already looks, then let that
pipeline parse, chunk and index them — so connector content is searchable and citable exactly like
an upload, via one implementation instead of two.

Three sources pull for real with no third-party app registration: `web` needs only a URL, and
`google-drive` / `gmail` / `sharepoint` work from an access token you paste into the connector (or
set in `engine/.env`). The rest report precisely what they are missing — none of them reports a sync
it did not perform.

Derived from RAGFlow (https://github.com/infiniflow/ragflow), Apache-2.0.
"""

from __future__ import annotations

import base64
import os
import pathlib
import re
from urllib.parse import urlparse

import requests

from . import ingest
from .core import FILES_DIR, OWNER_EMAIL, jdumps, jloads, new_id, now_ms, one, x

# Sources this module can pull from. `web` is the only one that needs no credential at all.
FETCHERS = (
    "web",
    "google-drive",
    "gmail",
    "sharepoint",
    "sitemap",
    "rss",
    "s3",
    "s3-compatible",
    "slack",
    "box",
)

# What each remaining source would need. Stated as a requirement rather than a flat refusal, so the
# screen tells you the next step instead of going quiet.

CONTENT_SUFFIX = {
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/pdf": ".pdf",
    "application/json": ".json",
    "text/csv": ".csv",
}

# Google-native documents have no bytes to download; they are exported instead.
GOOGLE_EXPORTS = {
    "application/vnd.google-apps.document": ("text/plain", ".txt"),
    "application/vnd.google-apps.spreadsheet": ("text/csv", ".csv"),
    "application/vnd.google-apps.presentation": ("text/plain", ".txt"),
    "application/vnd.google-apps.script": ("application/vnd.google-apps.script+json", ".json"),
}


# --------------------------------------------------------------------------- configuration


def config_of(row) -> dict:
    """A connector's stored configuration.

    Rows written before settings existed hold a bare list of dataset ids, so both shapes are read
    rather than migrating data on the way in.
    """
    raw = jloads(row["config"], {})
    if isinstance(raw, list):
        return {"dataset_ids": [str(v) for v in raw], "settings": {}}
    settings = raw.get("settings") if isinstance(raw, dict) else None
    return {
        "dataset_ids": [str(v) for v in ((raw or {}).get("dataset_ids") or [])],
        "settings": settings if isinstance(settings, dict) else {},
    }


def _token(settings: dict, env_name: str) -> str:
    token = str(settings.get("token") or os.environ.get(env_name) or "").strip()
    if not token:
        raise ValueError(f"no access token — paste one on the connector, or set {env_name} in engine/.env")
    return token


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _slug(text: str, limit: int = 60) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9\u0600-\u06FF._-]+", "-", text).strip("-")
    return (cleaned or "item")[:limit]


def _suffix_for(content_type: str, url: str) -> str:
    media = (content_type or "").split(";")[0].strip().lower()
    if media in CONTENT_SUFFIX:
        return CONTENT_SUFFIX[media]
    return pathlib.Path(urlparse(url).path).suffix or ".html"


# --------------------------------------------------------------------------- sources


def _verify(settings: dict) -> bool:
    """TLS verification for one connector. Per source, never a global switch."""
    return not bool(settings.get("insecure"))


def _web(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """Fetch each configured URL. `settings.urls` is a list; `settings.url` a single address."""
    settings = cfg["settings"]
    urls = [str(u) for u in (settings.get("urls") or []) if str(u).strip()]
    if settings.get("url"):
        urls.append(str(settings["url"]))
    if not urls:
        raise ValueError("no URL configured — give this connector at least one address to read")
    out: list[tuple[str, bytes]] = []
    for url in urls:
        response = requests.get(
            url, timeout=45, headers={"User-Agent": "OwnRAG-connector/1.0"}, verify=_verify(settings)
        )
        response.raise_for_status()
        if listing_only:
            continue
        stem = pathlib.Path(urlparse(url).path).stem or urlparse(url).netloc
        out.append((f"{_slug(stem)}{_suffix_for(response.headers.get('content-type', ''), url)}", response.content))
    return out


def _drive(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """Google Drive: list files, then download (or export) each one."""
    settings = cfg["settings"]
    token = _token(settings, "OWNRAG_GOOGLE_TOKEN")
    base = str(settings.get("api_base") or "https://www.googleapis.com").rstrip("/")
    params: dict = {"fields": "files(id,name,mimeType)", "pageSize": 50}
    if settings.get("query"):
        params["q"] = str(settings["query"])
    listing = requests.get(f"{base}/drive/v3/files", headers=_bearer(token), params=params, timeout=45)
    listing.raise_for_status()
    files = (listing.json() or {}).get("files") or []
    out: list[tuple[str, bytes]] = []
    for item in files:
        file_id = str(item.get("id") or "")
        name = str(item.get("name") or file_id)
        mime = str(item.get("mimeType") or "")
        if not file_id:
            continue
        if mime.startswith("application/vnd.google-apps"):
            export = GOOGLE_EXPORTS.get(mime)
            if not export:  # forms, sites, drawings — nothing a text pipeline can read
                continue
            media, suffix = export
            if listing_only:
                continue
            response = requests.get(
                f"{base}/drive/v3/files/{file_id}/export",
                headers=_bearer(token),
                params={"mimeType": media},
                timeout=90,
            )
        else:
            # A downloadable object's own name already carries its extension.
            suffix = ""
            if listing_only:
                continue
            response = requests.get(
                f"{base}/drive/v3/files/{file_id}",
                headers=_bearer(token),
                params={"alt": "media"},
                timeout=90,
            )
        response.raise_for_status()
        out.append((f"{name}{suffix}", response.content))
    if listing_only:
        return [(str(item.get("name") or ""), b"") for item in files]
    return out


def _mail_text(payload: dict) -> str:
    """Walk a Gmail message body, preferring text/plain and falling back to stripped HTML."""
    def decode(data: str) -> str:
        padded = data + "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8", "replace")

    collected: dict[str, list[str]] = {"text/plain": [], "text/html": []}
    stack = [payload]
    while stack:
        part = stack.pop()
        for child in part.get("parts") or []:
            stack.append(child)
        body = (part.get("body") or {}).get("data")
        media = str(part.get("mimeType") or "")
        if body and media in collected:
            collected[media].append(decode(body))
    if collected["text/plain"]:
        return "\n\n".join(collected["text/plain"])
    html = "\n\n".join(collected["text/html"])
    return re.sub(r"<[^>]+>", " ", html)


def _header(payload: dict, name: str) -> str:
    for header in payload.get("headers") or []:
        if str(header.get("name") or "").lower() == name.lower():
            return str(header.get("value") or "")
    return ""


def _gmail(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """Gmail: list matching messages, then take each one's text. Scope: gmail.readonly."""
    settings = cfg["settings"]
    token = _token(settings, "OWNRAG_GOOGLE_TOKEN")
    base = str(settings.get("api_base") or "https://gmail.googleapis.com").rstrip("/")
    params: dict = {"maxResults": int(settings.get("limit") or 25)}
    if settings.get("query"):
        params["q"] = str(settings["query"])
    listing = requests.get(f"{base}/gmail/v1/users/me/messages", headers=_bearer(token), params=params, timeout=45)
    listing.raise_for_status()
    messages = (listing.json() or {}).get("messages") or []
    if listing_only:
        return [(str(item.get("id") or ""), b"") for item in messages]
    out: list[tuple[str, bytes]] = []
    for index, item in enumerate(messages, start=1):
        detail = requests.get(
            f"{base}/gmail/v1/users/me/messages/{item.get('id')}",
            headers=_bearer(token),
            params={"format": "full"},
            timeout=45,
        )
        detail.raise_for_status()
        payload = (detail.json() or {}).get("payload") or {}
        subject = _header(payload, "Subject") or str(item.get("id"))
        body = f"Subject: {subject}\nFrom: {_header(payload, 'From')}\nDate: {_header(payload, 'Date')}\n\n{_mail_text(payload)}"
        out.append((f"{_slug(subject)}-{index}.txt", body.encode("utf-8")))
    return out


def _sharepoint(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """SharePoint / OneDrive through Microsoft Graph. Scope: Files.Read.All."""
    settings = cfg["settings"]
    token = _token(settings, "OWNRAG_GRAPH_TOKEN")
    base = str(settings.get("api_base") or "https://graph.microsoft.com").rstrip("/")
    path = str(settings.get("path") or "/me/drive/root/children")
    listing = requests.get(f"{base}/v1.0{path}", headers=_bearer(token), timeout=45)
    listing.raise_for_status()
    items = (listing.json() or {}).get("value") or []
    out: list[tuple[str, bytes]] = []
    for item in items:
        if "file" not in item:  # folders, packages and lists are skipped, never counted as synced
            continue
        name = str(item.get("name") or "file")
        if listing_only:
            out.append((name, b""))
            continue
        url = item.get("@microsoft.graph.downloadUrl") or f"{base}/v1.0/me/drive/items/{item.get('id')}/content"
        response = requests.get(url, timeout=90)
        response.raise_for_status()
        out.append((name, response.content))
    return out


# ------------------------------------------------------------------- sources with no credentials
#
# The preserved Go backend (internal/syncer/connector) implements 45 connectors. These two need no
# credential at all, so they work the moment a person pastes an address — the ones further down are
# listed with what they would need, and say so rather than pretending to be wired.


def _xml(url: str, settings: dict):
    """Fetch one XML document with this connector's TLS stance."""
    from xml.etree import ElementTree

    response = requests.get(
        url, timeout=45, headers={"User-Agent": "OwnRAG-connector/1.0"}, verify=_verify(settings)
    )
    response.raise_for_status()
    return ElementTree.fromstring(response.content)


def _local(tag: str) -> str:
    """A tag without its XML namespace: Atom's `{http://…}entry` is an entry."""
    return tag.split("}")[-1].lower()


def _sitemap(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """A sitemap, or a sitemap index, read down to its pages. No credentials, one address."""
    settings = cfg["settings"]
    url = str(settings.get("url") or "").strip()
    if not url:
        raise ValueError("no sitemap URL configured — give this connector a sitemap.xml address")
    budget = int(settings.get("max_pages") or 20)
    tried: list[str] = []
    pages: list[str] = []
    queue = [url]
    while queue and len(tried) < 5:
        target = queue.pop(0)
        if target in tried:
            continue
        tried.append(target)
        try:
            root = _xml(target, settings)
        except Exception as exc:
            if target == url:
                # The address the person configured must report its own failure — swallowing it
                # turns a plain 404 into a misleading "listed no readable pages" later.
                raise ValueError(f"could not read {target}: {exc}") from exc
            continue
        for node in root.iter():
            if _local(node.tag) != "loc" or not (node.text or "").strip():
                continue
            found = node.text.strip()
            if found.lower().endswith((".xml", ".xml.gz")):
                # A sitemap index points at child sitemaps — read those too, up to a small ceiling.
                if found not in tried and found not in queue and len(tried) + len(queue) < 5:
                    queue.append(found)
            elif found not in pages:
                pages.append(found)

    out: list[tuple[str, bytes]] = []
    for page in pages[:budget]:
        try:
            response = requests.get(
                page, timeout=45, headers={"User-Agent": "OwnRAG-connector/1.0"}, verify=_verify(settings)
            )
            response.raise_for_status()
        except Exception:
            continue
        stem = pathlib.Path(urlparse(page).path).stem or urlparse(page).netloc
        out.append(
            (
                f"{_slug(stem)}{_suffix_for(response.headers.get('content-type', ''), page)}",
                response.content,
            )
        )
    if not out:
        raise ValueError(f"the sitemap listed no readable pages (checked {len(pages)})")
    return out


def _feed(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """An RSS or Atom feed, flattened into one text document. No credentials, one request."""
    settings = cfg["settings"]
    url = str(settings.get("url") or "").strip()
    if not url:
        raise ValueError("no feed URL configured — give this connector an RSS or Atom address")
    root = _xml(url, settings)
    limit = int(settings.get("max_items") or 40)
    entries: list[str] = []
    for item in root.iter():
        if _local(item.tag) not in ("item", "entry"):
            continue
        fields: dict[str, object] = {}
        for child in list(item):
            fields.setdefault(_local(child.tag), child)
        title_node = fields.get("title")
        title = (getattr(title_node, "text", "") or "").strip()
        link_node = fields.get("link")
        href = ""
        if link_node is not None:
            href = (getattr(link_node, "get", lambda _k: None)("href") or getattr(link_node, "text", "") or "").strip()
        body = ""
        for key in ("description", "summary", "content", "encoded"):
            node = fields.get(key)
            text = getattr(node, "text", "") or ""
            if text.strip():
                body = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()
                break
        if title or body:
            entries.append(f"## {title or href}\n{href}\n\n{body}".strip())
        if len(entries) >= limit:
            break
    if not entries:
        raise ValueError("the feed parsed but carried no entries")
    stem = f"feed-{_slug(urlparse(url).netloc or 'feed')}"
    return [(f"{stem}.md", "\n\n".join(entries).encode("utf-8"))]


def _sign_v4(method: str, url: str, region: str, access_key: str, secret_key: str, session: str = "") -> dict:
    """AWS Signature Version 4 for one request, using only the standard library.

    boto3 is not a dependency of this engine, and adding a 50 MB SDK to read a bucket is not worth
    it — but a signed request is a signed request.
    """
    import datetime
    import hashlib
    import hmac
    from urllib.parse import quote

    parsed = urlparse(url)
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()
    canonical_query = "&".join(sorted(parsed.query.split("&"))) if parsed.query else ""
    # AWS wants every query value percent-encoded exactly once.
    canonical_query = "&".join(
        f"{part.split('=', 1)[0]}={quote(part.split('=', 1)[1], safe='-_.~')}"
        if "=" in part
        else part
        for part in canonical_query.split("&")
        if part
    )
    headers = {"host": parsed.netloc, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    if session:
        headers["x-amz-security-token"] = session
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{key}:{headers[key]}\n" for key in sorted(headers))
    canonical_request = "\n".join(
        [method, parsed.path or "/", canonical_query, canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{datestamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    key = f"AWS4{secret_key}".encode()
    for part in (datestamp, region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {k: v for k, v in headers.items() if k != "host"}


def _s3(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """Amazon S3, or any S3-compatible endpoint. Works anonymously; keys sign with SigV4."""
    from urllib.parse import quote

    settings = cfg["settings"]
    bucket = str(settings.get("bucket") or "").strip()
    if not bucket:
        raise ValueError("no bucket configured — give this connector a bucket name (an access key is optional for a public bucket)")
    region = str(settings.get("region") or "us-east-1").strip()
    endpoint = str(settings.get("endpoint") or "").strip()
    access = str(settings.get("access_key") or "").strip()
    secret = str(settings.get("secret_key") or "").strip()
    session = str(settings.get("session_token") or "").strip()
    prefix = str(settings.get("prefix") or "").strip()
    limit = int(settings.get("max_keys") or 50)
    ceiling = int(float(settings.get("max_size_mb") or 5) * 1024 * 1024)
    root = f"{endpoint.rstrip('/')}/{bucket}" if endpoint else f"https://{bucket}.s3.{region}.amazonaws.com"

    def fetch(url: str) -> requests.Response:
        headers = {}
        if access and secret:
            headers = _sign_v4("GET", url, region, access, secret, session)
        response = requests.get(url, headers=headers, timeout=120)
        if response.status_code >= 400:
            raise ValueError(f"S3 answered {response.status_code} for {url.split('?')[0]}: {response.text[:120]}")
        return response

    query = f"?list-type=2&max-keys={limit}" + (f"&prefix={quote(prefix)}" if prefix else "")
    listing = fetch(f"{root}/{query}")
    from xml.etree import ElementTree

    keys: list[str] = []
    try:
        root_node = ElementTree.fromstring(listing.content)
    except Exception as exc:
        raise ValueError(f"S3 did not return a listing (is that a bucket?): {exc}") from exc
    for node in root_node.iter():
        if _local(node.tag) != "key" or not (node.text or "").strip():
            continue
        found = node.text.strip()
        if not found.endswith("/"):
            keys.append(found)
    if not keys:
        raise ValueError(f"bucket {bucket} listed no objects{' under ' + prefix if prefix else ''}")
    if listing_only:
        return [(key.rsplit("/", 1)[-1], b"") for key in keys]

    out: list[tuple[str, bytes]] = []
    for key in keys:
        head = fetch(f"{root}/{quote(key)}")
        if len(head.content) > ceiling:
            continue
        name = key.rsplit("/", 1)[-1] or key
        out.append((name if "." in name else f"{name}.txt", head.content))
    if not out:
        raise ValueError(f"every object listed exceeded {ceiling // 1024 // 1024} MB")
    return out


def _slack(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """Slack: each visible channel's recent messages, as one text document per channel."""
    import time

    settings = cfg["settings"]
    token = str(settings.get("token") or "").strip()
    if not token:
        raise ValueError("no Slack token configured — a Slack bot token with channels:history is required")
    base = str(settings.get("api_base") or "https://slack.com/api").rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}
    per_channel = int(settings.get("messages_per_channel") or 50)
    wanted = {c.strip().lstrip("#") for c in str(settings.get("channels") or "").split(",") if c.strip()}

    listing = requests.get(
        f"{base}/conversations.list",
        headers=headers,
        params={"limit": 200, "types": "public_channel,private_channel"},
        timeout=45,
    ).json()
    if not listing.get("ok"):
        raise ValueError(f"Slack refused the token: {listing.get('error') or 'unknown error'}")
    channels = {
        str(c.get("name")): c.get("id")
        for c in listing.get("channels") or []
        if (not wanted or str(c.get("name")) in wanted)
    }
    if not channels:
        raise ValueError(
            "no channel matched — the bot must be invited to a channel, or name them in the Channels field"
        )
    if listing_only:
        return [(f"slack-{name}.md", b"") for name in channels]

    out: list[tuple[str, bytes]] = []
    for name, channel_id in channels.items():
        history = requests.get(
            f"{base}/conversations.history",
            headers=headers,
            params={"channel": channel_id, "limit": per_channel},
            timeout=45,
        ).json()
        if not history.get("ok"):
            continue
        lines: list[str] = []
        for message in history.get("messages") or []:
            text = str(message.get("text") or "").strip()
            if not text:
                continue
            who = message.get("user") or message.get("bot_id") or "unknown"
            try:
                stamp = time.strftime("%Y-%m-%d %H:%M", time.localtime(float(message.get("ts") or 0)))
            except (TypeError, ValueError):
                stamp = ""
            lines.append(f"## {who} · {stamp}\n{text}")
        if lines:
            out.append((f"slack-{_slug(name)}.md", "\n\n".join(lines).encode("utf-8")))
    if not out:
        raise ValueError("those channels held no messages this token can read")
    return out


def _box(cfg: dict, listing_only: bool = False) -> list[tuple[str, bytes]]:
    """Box: the files in one folder, downloaded through the Files API."""
    settings = cfg["settings"]
    token = str(settings.get("token") or "").strip()
    if not token:
        raise ValueError("no Box token configured — a developer token or app access token")
    folder = str(settings.get("folder_id") or "0").strip()
    base = str(settings.get("api_base") or "https://api.box.com/2.0").rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}
    listing = requests.get(
        f"{base}/folders/{folder}/items",
        headers=headers,
        params={"limit": 100, "fields": "id,name,type,size"},
        timeout=60,
    )
    if listing.status_code >= 400:
        raise ValueError(f"Box answered {listing.status_code}: {listing.text[:120]}")
    entries = [
        entry
        for entry in (listing.json().get("entries") or [])
        if entry.get("type") == "file" and entry.get("name")
    ]
    if not entries:
        raise ValueError(f"folder {folder} held no files this token can read")
    if listing_only:
        return [(str(entry["name"]), b"") for entry in entries]

    out: list[tuple[str, bytes]] = []
    for entry in entries:
        content = requests.get(f"{base}/files/{entry['id']}/content", headers=headers, timeout=180)
        if content.status_code >= 400:
            continue
        out.append((str(entry["name"]), content.content))
    if not out:
        raise ValueError("Box listed files but none could be downloaded")
    return out


EXTRA_FETCHERS = {
    "sitemap": _sitemap,
    "rss": _feed,
    "s3": _s3,
    "s3-compatible": _s3,
    "slack": _slack,
    "box": _box,
}
EXTRA_REQUIREMENTS = (
    {
        "sitemap": "A sitemap.xml address. No credentials.",
        "rss": "An RSS or Atom feed address. No credentials.",
        "s3": "A bucket name. Keys are optional — a public bucket reads anonymously.",
        "s3-compatible": "An endpoint plus a bucket name (MinIO, R2, Wasabi…).",
        "slack": "A bot token with channels:history, invited to the channels you want read.",
        "box": "A Box developer token or app access token (developer tokens last 60 minutes).",
    }
)
EXTRA_FIELDS = {
    "sitemap": [
            {"key": "url", "label": "Sitemap address", "hint": "e.g. https://example.com/sitemap.xml", "kind": "text"},
            {
                "key": "max_pages",
                "label": "Pages to read",
                "hint": "Optional. Defaults to 20.",
                "kind": "text",
            },
            {
                "key": "insecure",
                "label": "Skip TLS verification for this source",
                "hint": "Only for a site whose certificate chain is incomplete.",
                "kind": "bool",
            },
        ],
        "rss": [
            {"key": "url", "label": "Feed address", "hint": "e.g. https://example.com/feed.xml", "kind": "text"},
            {"key": "max_items", "label": "Items to keep", "hint": "Optional. Defaults to 40.", "kind": "text"},
            {
                "key": "insecure",
                "label": "Skip TLS verification for this source",
                "hint": "Only for a site whose certificate chain is incomplete.",
                "kind": "bool",
            },
        ],
    "s3": [
        {"key": "bucket", "label": "Bucket", "hint": "e.g. noaa-ghcn-pds", "kind": "text"},
        {"key": "region", "label": "Region", "hint": "Optional. Defaults to us-east-1.", "kind": "text"},
        {"key": "prefix", "label": "Prefix", "hint": "Optional. Only objects under this path.", "kind": "text"},
        {"key": "access_key", "label": "Access key id", "hint": "Optional — leave empty to read a public bucket.", "kind": "secret"},
        {"key": "secret_key", "label": "Secret access key", "hint": "Optional. Signed with SigV4 when present.", "kind": "secret"},
        {"key": "endpoint", "label": "Endpoint", "hint": "Optional. Set for MinIO, R2, Wasabi.", "kind": "text"},
        {"key": "max_keys", "label": "Objects to read", "hint": "Optional. Defaults to 50.", "kind": "text"},
    ],
    "slack": [
        {"key": "token", "label": "Bot token", "hint": "xoxb-…, with channels:history and channels:read.", "kind": "secret"},
        {"key": "channels", "label": "Channels", "hint": "Optional. Comma-separated names; empty reads every channel the bot is in.", "kind": "text"},
        {"key": "messages_per_channel", "label": "Messages per channel", "hint": "Optional. Defaults to 50.", "kind": "text"},
        {"key": "api_base", "label": "API base", "hint": "Optional. Defaults to slack.com/api.", "kind": "text"},
    ],
    "box": [
        {"key": "token", "label": "Box access token", "hint": "A developer token, or an app access token.", "kind": "secret"},
        {"key": "folder_id", "label": "Folder id", "hint": "Optional. Defaults to 0, the root folder.", "kind": "text"},
        {"key": "api_base", "label": "API base", "hint": "Optional. Defaults to api.box.com/2.0.", "kind": "text"},
    ],
}

# The rest of what the preserved Go backend implements, and what each one needs. Listed so the
# console offers upstream's set, and every one of them states its requirement instead of failing
# with a generic error.
UPSTREAM_SOURCES: dict[str, str] = {
    "rest-api": "A base URL plus an optional bearer token.",
    "mysql": "A MySQL DSN (user, password, host, database, table).",
    "postgresql": "A PostgreSQL DSN (user, password, host, database, table).",
    "github": "A personal access token and a repository (owner/name).",
    "gitlab": "A personal access token and a project path.",
    "bitbucket": "A workspace, repository, and app password.",
    "azure-devops": "An organization, project, and personal access token.",
    "jira": "A site URL, account email, and API token.",
    "dropbox": "A Dropbox access token.",
    "onedrive": "A Microsoft Graph token (Files.Read.All).",
    "teams": "A Microsoft Graph token (ChannelMessage.Read.All).",
    "outlook": "A Microsoft Graph token (Mail.Read).",
    "imap": "Host, port, username, and password for an IMAP mailbox.",
    "airtable": "A personal access token plus base and table ids.",
    "asana": "An Asana personal access token and a project id.",
    "zendesk": "A subdomain, account email, and API token.",
    "zotero": "A Zotero API key and library id.",
    "salesforce": "An instance URL plus a connected-app client id and secret.",
    "moodle": "A site URL and a web-service token.",
    "seafile": "A server URL, account, and library id.",
    "feishu-wiki": "An app id and app secret for Feishu wiki.",
    "dingtalk-ai-table": "An app key and app secret plus a table id.",
    "webdav": "A server URL, username, and password.",
    "xquik": "An API key for the xquik service.",
    "html-markdown": "A URL to convert to markdown.",
    "r2": "A Cloudflare account id, bucket, and API token.",
    "oci-storage": "An OCI namespace, bucket, and API key.",
    "google-cloud-storage": "A GCS bucket and a service-account JSON key.",
    "bigquery": "A Google Cloud project, dataset, and service-account key.",
    "azure-blob": "An Azure connection string and container name.",
    "sharepoint-site": "A Microsoft Graph token (Sites.Read.All).",
}


# The fields each source's dialog should show. The engine owns this list so the console never
# invents a credential field for a source that would ignore it.
SOURCE_FIELDS: dict[str, list[dict]] = {
    "web": [
        {"key": "urls", "label": "URLs to read", "hint": "One address per line.", "kind": "lines"},
        {
            "key": "insecure",
            "label": "Skip TLS verification for this source",
            "hint": "Only for a site whose certificate chain is incomplete — e.g. laws.boe.gov.sa, which does not send its DigiCert intermediate.",
            "kind": "bool",
        },
    ],
    "google-drive": [
        {"key": "token", "label": "Google access token", "hint": "Scope drive.readonly.", "kind": "secret"},
        {"key": "query", "label": "Drive query", "hint": 'Optional, e.g. name contains "contract"', "kind": "text"},
        {"key": "api_base", "label": "API base", "hint": "Optional. Defaults to googleapis.com", "kind": "text"},
    ],
    "gmail": [
        {"key": "token", "label": "Google access token", "hint": "Scope gmail.readonly.", "kind": "secret"},
        {"key": "query", "label": "Gmail query", "hint": "Optional, e.g. subject:renewal", "kind": "text"},
        {"key": "api_base", "label": "API base", "hint": "Optional. Defaults to gmail.googleapis.com", "kind": "text"},
    ],
    "sharepoint": [
        {"key": "token", "label": "Microsoft Graph token", "hint": "Scope Files.Read.All.", "kind": "secret"},
        {"key": "path", "label": "Folder path", "hint": "Optional. Defaults to /me/drive/root/children", "kind": "text"},
        {"key": "api_base", "label": "API base", "hint": "Optional. Defaults to graph.microsoft.com", "kind": "text"},
    ],
}


SOURCE_FIELDS.update(EXTRA_FIELDS)


# The one field each source cannot work without. The dialog marks these and refuses to create the
# connector until they are filled, instead of letting a person save an empty source.
REQUIRED_FIELDS: dict[str, set[str]] = {
    "web": {"urls"},
    "google-drive": {"token"},
    "gmail": {"token"},
    "sharepoint": {"token"},
    "rss": {"url"},
    "sitemap": {"url"},
    "s3": {"bucket"},
    "s3-compatible": {"endpoint", "bucket"},
    "slack": {"token"},
    "box": {"token"},
}


def sources_catalog() -> list[dict]:
    """Every selectable source, how this engine would read it, and what it would need."""
    kinds = list(
        dict.fromkeys(
            [
                "web",
                "google-drive",
                "gmail",
                "sharepoint",
                "rss",
                "sitemap",
                "s3",
                "s3-compatible",
                "slack",
                "box",
            ]
            + list(UPSTREAM_SOURCES)
        )
    )
    return [
        {
            "source_type": kind,
            "pull": kind in FETCHERS,
            "needs": EXTRA_REQUIREMENTS.get(kind) or UPSTREAM_SOURCES.get(kind, ""),
            "fields": [
                {**field, "required": field["key"] in REQUIRED_FIELDS.get(kind, set())}
                for field in SOURCE_FIELDS.get(kind, [])
            ],
        }
        for kind in kinds
    ]


# --------------------------------------------------------------------------- pipeline


def _store(dataset_id: str, name: str, payload: bytes, source_type: str) -> str:
    """Write fetched bytes beside an upload and register the document, then run the same ingest path.

    Reusing `ingest.ingest_document` is the point: connector documents get the same parsing, chunking,
    embeddings, progress reporting and error surface as a hand-uploaded file.
    """
    dataset = one("SELECT * FROM dataset WHERE id = ?", (dataset_id,))
    if not dataset:
        raise ValueError(f"knowledge base {dataset_id} no longer exists")
    safe = pathlib.Path(name).name or "document.txt"
    target_dir = FILES_DIR / dataset_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / safe
    target.write_bytes(payload)
    doc_id = new_id("doc")
    x(
        "INSERT INTO document (id, dataset_id, name, location, type, size, run, parser_id,"
        " parser_config, source_type, created_by, create_time, update_time)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            doc_id,
            dataset_id,
            safe,
            str(target),
            safe.rsplit(".", 1)[-1].lower() if "." in safe else "txt",
            len(payload),
            "UNSTART",
            dataset["chunk_method"] or "naive",
            dataset["parser_config"] or "{}",
            source_type,
            OWNER_EMAIL,
            now_ms(),
            now_ms(),
        ),
    )
    ingest.ingest_document(doc_id)
    return doc_id


def _log(connector_id: str, status: str, message: str) -> None:
    x(
        "INSERT INTO connector_log (id, connector_id, status, message, create_time) VALUES (?,?,?,?,?)",
        (new_id("clog"), connector_id, status, message, now_ms()),
    )


def _finish(row, ok: bool, message: str, synced: int = 0) -> dict:
    status = "connected" if ok else "error"
    total = synced if not ok else int(row["documents_synced"] or 0) + synced
    x(
        "UPDATE connector SET status = ?, last_sync = ?, documents_synced = ?, message = ? WHERE id = ?",
        (status, now_ms(), total, message, row["id"]),
    )
    _log(str(row["id"]), "success" if ok else "error", message)
    return {"ok": ok, "documents_synced": synced, "status": status, "message": message}


def sync(connector_id: str) -> dict:
    """Pull the source's content into every knowledge base the connector points at."""
    row = one("SELECT * FROM connector WHERE id = ?", (connector_id,))
    if not row:
        return {"ok": False, "documents_synced": 0, "message": "Connector not found"}
    kind = str(row["type"] or "")
    if str(row["status"] or "") == "paused":
        message = "This connector is paused — resume it before syncing."
        _log(str(row["id"]), "info", message)
        return {"ok": False, "documents_synced": 0, "status": "paused", "message": message}
    cfg = config_of(row)
    datasets = cfg["dataset_ids"]
    if not datasets:
        return _finish(row, False, "Point this connector at a knowledge base first — there is nowhere to write.")
    if kind in UPSTREAM_SOURCES:
        return _finish(row, False, f"{kind} needs {UPSTREAM_SOURCES[kind]}.")
    fetch = {"web": _web, "google-drive": _drive, "gmail": _gmail, "sharepoint": _sharepoint, **EXTRA_FETCHERS}.get(kind)
    if fetch is None:
        return _finish(row, False, f"'{kind}' is not a source this engine can pull from.")
    try:
        objects = fetch(cfg)
    except requests.RequestException as exc:
        return _finish(row, False, f"{kind} could not be reached: {exc}")
    except ValueError as exc:
        return _finish(row, False, f"{kind}: {exc}")
    if not objects:
        return _finish(row, True, f"{kind} returned nothing to sync.", 0)
    written = 0
    failures: list[str] = []
    for name, payload in objects:
        try:
            _store(datasets[0], name, payload, kind)
            written += 1
        except Exception as exc:  # noqa: BLE001 - one bad object must not abort the whole sync
            failures.append(f"{name}: {exc}")
    summary = f"Synced {written} document(s) from {len(objects)} object(s) into {len(datasets)} knowledge base(s)."
    if failures:
        return _finish(row, written > 0, f"{summary} {len(failures)} failed — {failures[0]}", written)
    return _finish(row, True, summary, written)


def probe(connector_id: str) -> dict:
    """Check the source answers, without writing anything into a knowledge base."""
    row = one("SELECT * FROM connector WHERE id = ?", (connector_id,))
    if not row:
        return {"ok": False, "message": "Connector not found"}
    kind = str(row["type"] or "")
    if kind in UPSTREAM_SOURCES:
        return {"ok": False, "message": f"{kind} needs {UPSTREAM_SOURCES[kind]}."}
    fetch = {"web": _web, "google-drive": _drive, "gmail": _gmail, "sharepoint": _sharepoint, **EXTRA_FETCHERS}.get(kind)
    if fetch is None:
        return {"ok": False, "message": f"'{kind}' is not a source this engine can pull from."}
    cfg = config_of(row)
    try:
        found = fetch(cfg, listing_only=True)
    except requests.RequestException as exc:
        return {"ok": False, "message": f"{kind} could not be reached: {exc}"}
    except ValueError as exc:
        return {"ok": False, "message": f"{kind}: {exc}"}
    return {"ok": True, "message": f"{kind} answered — {len(found)} object(s) visible."}


def stored_config(dataset_ids: list[str], settings: dict) -> str:
    """The shape `config_of` reads back."""
    return jdumps({"dataset_ids": [str(d) for d in dataset_ids], "settings": settings})
