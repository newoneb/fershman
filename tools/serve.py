#!/usr/bin/env python3
"""Preview the site locally, including the rewrites in _redirects.

    python3 tools/serve.py          ->  http://localhost:8080
    python3 tools/serve.py 3000     ->  http://localhost:3000
"""
import http.server, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_rules():
    rules = []
    path = os.path.join(ROOT, "_redirects")
    if not os.path.exists(path):
        return rules
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            parts = line.split()
            if len(parts) < 2:
                continue
            src, dst = parts[0], parts[1]
            status = int(parts[2].rstrip("!")) if len(parts) > 2 else 301
            pattern = re.escape(src).replace(r"\*", "(?P<splat>.*)")
            pattern = re.sub(r":([A-Za-z_]+)", r"(?P<\1>[^/]+)", pattern)
            rules.append((re.compile("^" + pattern + "/?$"), dst, status))
    return rules


RULES = load_rules()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
        ".woff2": "font/woff2", ".svg": "image/svg+xml", ".pdf": "application/pdf",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _exists(self, url_path):
        fs = self.translate_path(url_path)
        if os.path.isdir(fs):
            return os.path.exists(os.path.join(fs, "index.html"))
        return os.path.isfile(fs)

    def _route(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        if self._exists(path):
            return None
        for rx, dst, status in RULES:
            m = rx.match(path)
            if not m:
                continue
            target = dst
            for k, v in m.groupdict().items():
                target = target.replace(":" + k, v or "")
            if status in (301, 302):
                self.send_response(status)
                self.send_header("Location", target + (("&" if "?" in target else "?") + parsed.query if parsed.query else ""))
                self.end_headers()
                return "done"
            self.path = target.split("?")[0] + ("?" + parsed.query if parsed.query else "")
            return None
        self.path = "/404.html"
        return 404

    def do_GET(self):
        r = self._route()
        if r == "done":
            return
        if r == 404:
            body = open(os.path.join(ROOT, "404.html"), "rb").read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(next((a for a in sys.argv[1:] if a.isdigit()), 8080))
    print(f"Serving {ROOT} at http://localhost:{port}  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
