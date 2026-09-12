const BASE = "https://api-demo.bybit.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function serverTime() {
  const r = await fetch(`${BASE}/v5/market/time`, { cache: "no-store" });
  const d = await r.json();
  if (d.retCode !== 0) throw new Error("BYBIT_TIME_FAILED");
  return Number(d.time);
}

async function privateGet(path, params, key, secret) {
  const recv = "10000";
  const ts = await serverTime();
  const query = new URLSearchParams(params).toString();
  const sign = await hmac(secret, `${ts}${key}${recv}${query}`);
  const r = await fetch(`${BASE}${path}?${query}`, {
    cache: "no-store",
    headers: {
      "X-BAPI-API-KEY": key,
      "X-BAPI-TIMESTAMP": String(ts),
      "X-BAPI-SIGN": sign,
      "X-BAPI-RECV-WINDOW": recv,
      "X-BAPI-SIGN-TYPE": "2",
    },
  });
  return r.json();
}

async function privatePost(path, body, key, secret) {
  const recv = "10000";
  const ts = await serverTime();
  const text = JSON.stringify(body);
  const sign = await hmac(secret, `${ts}${key}${recv}${text}`);
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "X-BAPI-API-KEY": key,
      "X-BAPI-TIMESTAMP": String(ts),
      "X-BAPI-SIGN": sign,
      "X-BAPI-RECV-WINDOW": recv,
      "X-BAPI-SIGN-TYPE": "2",
    },
    body: text,
  });
  return r.json();
}

async function handle(req) {
  if ((process.env.BYBIT_DEMO || "").toLowerCase() !== "true") {
    return json({ ok: false, error: "DEMO_GUARD_BLOCKED" }, 403);
  }

  try {
    const isPost = req.method === "POST";
    const body = isPost ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const action = String(body.action || url.searchParams.get("action") || "health");

    if (action === "health") {
      return json({
        ok: true,
        mode: "DEMO",
        base_url: BASE,
        demo_guard: true,
        server_time: await serverTime(),
      });
    }

    const key = process.env.BYBIT_API_KEY || "";
    const secret = process.env.BYBIT_API_SECRET || "";
    if (!key || !secret) return json({ ok: false, error: "BYBIT_SECRETS_MISSING" }, 500);

    if (action === "balance") {
      return json({
        mode: "DEMO",
        ...(await privateGet("/v5/account/wallet-balance", { accountType: "UNIFIED" }, key, secret)),
      });
    }

    if (action === "ticker") {
      const category = String(body.category || url.searchParams.get("category") || "spot");
      const symbol = String(body.symbol || url.searchParams.get("symbol") || "BTCUSDT").toUpperCase();
      const r = await fetch(
        `${BASE}/v5/market/tickers?category=${encodeURIComponent(category)}&symbol=${encodeURIComponent(symbol)}`,
        { cache: "no-store" }
      );
      return json({ mode: "DEMO", ...(await r.json()) });
    }

    if (action === "create_demo_order") {
      const category = String(body.category || "spot");
      const symbol = String(body.symbol || "BTCUSDT").toUpperCase();
      const side = String(body.side || "Buy");
      const orderType = String(body.orderType || "Market");
      const qty = String(body.qty || "");
      if (!qty || !/^(Buy|Sell)$/.test(side)) return json({ ok: false, error: "INVALID_ORDER" }, 400);
      const p = { category, symbol, side, orderType, qty };
      if (body.price != null) p.price = String(body.price);
      if (body.timeInForce != null) p.timeInForce = String(body.timeInForce);
      return json({ mode: "DEMO", ...(await privatePost("/v5/order/create", p, key, secret)) });
    }

    if (action === "order_status") {
      const category = String(body.category || "spot");
      const p = { category };
      if (body.orderId) p.orderId = String(body.orderId);
      else if (body.orderLinkId) p.orderLinkId = String(body.orderLinkId);
      else return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 400);
      return json({ mode: "DEMO", ...(await privateGet("/v5/order/realtime", p, key, secret)) });
    }

    if (action === "cancel_demo_order") {
      const p = {
        category: String(body.category || "spot"),
        symbol: String(body.symbol || "BTCUSDT").toUpperCase(),
      };
      if (body.orderId) p.orderId = String(body.orderId);
      else if (body.orderLinkId) p.orderLinkId = String(body.orderLinkId);
      else return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 400);
      return json({ mode: "DEMO", ...(await privatePost("/v5/order/cancel", p, key, secret)) });
    }

    return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "INTERNAL_ERROR" }, 500);
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
