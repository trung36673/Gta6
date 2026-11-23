#!/usr/bin/env python3
"""Serve Lucia: Night City on the local network for mobile testing."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import socket
import os

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()

host, port = "0.0.0.0", 8000
print("LUCIA: NIGHT CITY server is running")
print(f"On this device: http://127.0.0.1:{port}")
print(f"On your phone (same Wi-Fi): http://{local_ip()}:{port}")
print("Press Ctrl+C to stop")
ThreadingHTTPServer((host, port), SimpleHTTPRequestHandler).serve_forever()
