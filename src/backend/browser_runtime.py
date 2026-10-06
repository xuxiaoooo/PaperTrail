"""Reuse nearby reads, then release each account's browser after a short idle period."""
import atexit
import json
from pathlib import Path
import queue
from platform_runtime import process_options
import subprocess
import threading

_workers = {}
_lock = threading.Lock()


class ReaderWorker:
    def __init__(self, node, reader, idle_seconds=30):
        self.node, self.reader = node, str(reader)
        self.process = None
        self.owner = None
        self.output = None
        self.lock = threading.Lock()
        self.idle_seconds = idle_seconds
        self.idle_timer = None

    def cancel_idle(self):
        if self.idle_timer:
            self.idle_timer.cancel()
            self.idle_timer = None

    def release_when_idle(self):
        def release():
            with self.lock:
                if self.idle_timer is timer:
                    self.close()
        timer = threading.Timer(self.idle_seconds, release)
        timer.daemon = True
        self.idle_timer = timer
        timer.start()

    def read(self, payload, timeout):
        with self.lock:
            self.cancel_idle()
            owner = (payload['login_url'], payload['username'])
            changed = self.owner is not None and self.owner != owner
            if changed or self.process and self.process.poll() is not None:
                self.close()
            if not self.process:
                self.process = subprocess.Popen([self.node, self.reader], stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8', **process_options())
                self.output = queue.Queue()
                stream, output = self.process.stdout, self.output
                def drain():
                    try:
                        for line in stream:
                            output.put(line)
                    except (OSError, ValueError):
                        pass
                    finally:
                        output.put(None)
                threading.Thread(target=drain, daemon=True).start()
            self.owner = owner
            request = dict(payload, keep_browser=True, reset_session=changed)
            self.process.stdin.write(json.dumps(request) + '\n')
            self.process.stdin.flush()
            try:
                line = self.output.get(timeout=timeout)
            except queue.Empty:
                self.close()
                raise subprocess.TimeoutExpired([self.node,self.reader], timeout) from None
            if not line:
                self.close()
                raise RuntimeError('浏览器读取未完成，请重试')
            self.release_when_idle()
            return subprocess.CompletedProcess([self.node,self.reader], 0, stdout=line, stderr='')

    def close(self):
        self.cancel_idle()
        if self.process:
            if not self.process.stdin.closed:
                self.process.stdin.close()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.process.stdout.close()
        self.process = None


def read_with_browser(node, reader, payload, timeout):
    key = payload['profile_dir']
    with _lock:
        worker = _workers.setdefault(key, ReaderWorker(node, reader))
    return worker.read(payload, timeout)


def close_profile(profile_dir):
    with _lock:
        worker = _workers.pop(str(profile_dir), None)
    if worker:
        with worker.lock:
            worker.close()


def close_browsers():
    workers = list(_workers.values())
    for worker in workers:
        if worker.process and not worker.process.stdin.closed:
            try:
                worker.process.stdin.close()
            except OSError:
                pass
    for worker in workers:
        with worker.lock:
            worker.close()


atexit.register(close_browsers)
