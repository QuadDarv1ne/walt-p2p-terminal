#!/usr/bin/env python3
"""
Mock Walt P2P API для E2E-тестов терминала.
Имитирует https://p2p.walt.io/p2p/integration-api/v1/item/online
и отдаёт CORS-заголовки, чтобы браузер обращался к нему как к CORS-прокси.

Запуск: python3 scripts/mock_walt_api.py [порт]
Ключи: test123 (успех), badkey (401).
"""
import json
import random
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
VALID_KEYS = {"test123", "key2"}

PAYMENTS = ["СБП", "Т-Банк", "Сбербанк", "ВТБ", "Наличные", "QIWI"]
NICK = "MockTrader"


def gen_ads(crypto: str, fiat: str, side: str, page: int, page_size: int):
    rng = random.Random(f"{crypto}/{fiat}/{side}/{page}")
    base = 90.0 if fiat == "RUB" else 1.0
    n_total = 57
    start = (page - 1) * page_size
    items = []
    for i in range(start, min(start + page_size, n_total)):
        r = rng.random()
        if side == "SELL":
            price = base * (1 + 0.01 + r * 0.04)  # мейкер продаёт: 91.0–94.6
        else:
            price = base * (1 - 0.01 - r * 0.04)  # мейкер покупает: 85.6–89.1
        min_amount = rng.choice([500, 1000, 5000, 10000])
        max_amount = min_amount * rng.choice([5, 10, 50, 200])
        items.append(
            {
                "id": f"{side}-{i}",
                "nickname": f"{NICK}-{side.lower()}-{i}",
                "price": round(price, 2),
                "minAmount": min_amount,
                "maxAmount": max_amount,
                "executeRate": round(80 + r * 19, 1),
                "payments": rng.sample(PAYMENTS, k=rng.randint(1, 3)),
                "merchantLevel": rng.choice(["Новичок", "Бронза", "Серебро", "Золото"]),
                "isOnline": rng.random() > 0.2,
            }
        )
    return items


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, accept")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _respond(self, code: int, obj) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            body = {}
        qs = parse_qs(parsed.query)
        # в режиме прокси адрес API приходит в query (?url=...) — тело всё равно JSON
        key = self.headers.get("X-API-Key", "")
        if key not in VALID_KEYS:
            self._respond(401, {"message": "Invalid API key"})
            return
        page = int(body.get("page") or 1)
        page_size = int(body.get("pageSize") or 50)
        data = gen_ads(
            str(body.get("cryptoCurrency", "USDT")),
            str(body.get("fiatCurrency", "RUB")),
            str(body.get("side", "SELL")),
            page,
            page_size,
        )
        self._respond(200, {"data": data})

    do_GET = do_POST

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"mock walt api: http://127.0.0.1:{PORT} (ключи: test123, badkey)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
