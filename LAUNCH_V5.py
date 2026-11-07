"""One-click local launcher. Uses the unchanged V4 HTTP handler and Python model."""
import threading
import webbrowser
from http.server import ThreadingHTTPServer
from app import Handler


def main():
    httpd = ThreadingHTTPServer(('127.0.0.1', 8000), Handler)
    url = 'http://127.0.0.1:8000'
    print('\nRIS / STAR-RIS V5 — Clean Video')
    print('Web UI: ' + url)
    print('Press Ctrl+C to stop the local server.\n')
    threading.Timer(0.9, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopping...')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
