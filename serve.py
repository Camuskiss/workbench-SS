#!/usr/bin/env python3
"""本地开发服务器：静态文件 + 简单代理（绕 CORS）
用法：python3 serve.py [port]，默认 8099
"""
import http.server, socketserver, urllib.parse, urllib.request, sys, os, gzip, io

PORT = int(sys.argv[1]) if len(sys.argv)>1 else 8099
ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/proxy':
            qs = urllib.parse.parse_qs(parsed.query)
            target = qs.get('url', [''])[0]
            if not target:
                self.send_response(400); self.end_headers(); self.wfile.write(b'no url'); return
            try:
                req = urllib.request.Request(target, headers={
                    'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                    'Accept-Encoding':'gzip, deflate'
                })
                with urllib.request.urlopen(req, timeout=15) as r:
                    data = r.read()
                    ct = r.headers.get('Content-Type','application/rss+xml')
                    # 解压 gzip（zaobao 等源返回 gzip）
                    enc = r.headers.get('Content-Encoding','')
                    if 'gzip' in enc:
                        data = gzip.decompress(data)
                    elif data[:2] == b'\x1f\x8b':
                        data = gzip.decompress(data)
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.send_header('Access-Control-Allow-Origin','*')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type','text/plain')
                self.send_header('Access-Control-Allow-Origin','*')
                self.end_headers()
                self.wfile.write(f'proxy error: {e}'.encode())
            return
        return super().do_GET()

print(f'Serving {ROOT} at http://127.0.0.1:{PORT}  (with /proxy?url=...)')
class _Server(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
with _Server(('0.0.0.0',PORT), Handler) as httpd:
    httpd.serve_forever()