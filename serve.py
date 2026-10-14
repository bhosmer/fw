#!/usr/bin/env python3
"""Serve this directory for development: python3 serve.py [port]

Like `python3 -m http.server`, but tells the browser never to cache, so a
reload always runs the code that is on disk.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
print(f'http://localhost:{port}')
ThreadingHTTPServer(('localhost', port), NoCache).serve_forever()
