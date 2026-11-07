"""Run: python app.py. Local-only server, no cloud service or JS build required."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import json

from model import Config, simulate

STATIC = Path(__file__).resolve().parent / 'static'


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/simulate':
            self.send_error(404)
            return

        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size < 10000:
                raise ValueError('Dữ liệu đầu vào quá lớn hoặc rỗng.')

            data = json.loads(self.rfile.read(size))
            result = simulate(Config.parse(data))
            self.respond(200, result)

        except (ValueError, TypeError) as exc:
            self.respond(400, {'error': str(exc)})

    def respond(self, status, data):
        payload = json.dumps(
            data,
            ensure_ascii=False,
            allow_nan=False,
        ).encode('utf-8')

        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()

    print(f'RIS / STAR-RIS Lab: http://127.0.0.1:{args.port}', flush=True)
    print('Press Ctrl+C to stop.', flush=True)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
