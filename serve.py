#!/usr/bin/env python3
"""Chạy game: python3 serve.py  → mở http://localhost:8080 (điện thoại cùng WiFi mở http://IP-máy:8080)."""
import http.server, socketserver, socket, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def log_message(self, *a): pass
def ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8', 80)); r = s.getsockname()[0]; s.close(); return r
    except Exception: return '127.0.0.1'
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('', PORT), H) as d:
    print(f'NEON CITY đang chạy:\n  Máy tính : http://localhost:{PORT}\n  Điện thoại (cùng WiFi): http://{ip()}:{PORT}\nCtrl+C để dừng.')
    try: d.serve_forever()
    except KeyboardInterrupt: pass
