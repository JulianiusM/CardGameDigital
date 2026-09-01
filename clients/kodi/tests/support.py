from __future__ import annotations

import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import parse_qs


CLIENT_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_ROOT = CLIENT_ROOT / "resources"
if str(RESOURCES_ROOT) not in sys.path:
    sys.path.insert(0, str(RESOURCES_ROOT))


class JsonServer:
    def __init__(self, responder: Callable[[str, str, Any, dict[str, str]], tuple[int, Any, dict[str, str]]]):
        self.responder = responder
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                self._respond()

            def do_POST(self) -> None:  # noqa: N802
                self._respond()

            def do_PUT(self) -> None:  # noqa: N802
                self._respond()

            def _respond(self) -> None:
                length = int(self.headers.get("content-length", "0"))
                raw = self.rfile.read(length) if length else b""
                content_type = self.headers.get("content-type", "")
                if raw and content_type.startswith("application/x-www-form-urlencoded"):
                    body = {
                        key: values[-1]
                        for key, values in parse_qs(raw.decode("ascii"), keep_blank_values=True).items()
                    }
                else:
                    body = json.loads(raw.decode("utf-8")) if raw else None
                status, value, headers = outer.responder(
                    self.command,
                    self.path,
                    body,
                    {key.casefold(): current for key, current in self.headers.items()},
                )
                encoded = value if isinstance(value, bytes) else json.dumps(value).encode("utf-8")
                self.send_response(status)
                response_type = headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", response_type)
                self.send_header("Content-Length", str(len(encoded)))
                for key, current in headers.items():
                    if key.casefold() == "content-type":
                        continue
                    self.send_header(key, current)
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, _format: str, *args: object) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self) -> "JsonServer":
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def private_resolver(_host: str, port: int, **_kwargs: Any) -> list[tuple]:
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.20", port))]


def public_resolver(_host: str, port: int, **_kwargs: Any) -> list[tuple]:
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.8", port))]
