const BASE = "https://api-demo.bybit.com";
const RECV_WINDOW = "10000";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
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

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readJson(response, label) {
  const text = await response.text();

  if (!text) {
    throw new Error(`${label}_EMPTY_RESPONSE`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label}_INVALID_JSON:${text.slice(0, 200).replace(/\s+/g, " ")}`
    );
  }
}

async function publicGet(path, params = {}) {
  const query = new URLSearchParams(params).toString();

  const response = await fetch(
    `${BASE}${path}${query ? `?${query}` : ""}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    }
  );

  return readJson(response, "BYBIT_PUBLIC");
}

async function timestamp() {
  /*
   * Vercel server clocks are synchronized.
   * We deliberately avoid depending on /v5/market/time here because
   * that endpoint was the source of the previous parsing failure.
   */
  return Date.now();
}

async function privateGet(path, params, key, secret) {
  const ts = await timestamp();
  const query = new URLSearchParams(params).toString();

  const signature = await hmac(
    secret,
    `${ts}${key}${RECV_WINDOW}${query}`
  );

  const response = await fetch(
    `${BASE}${path}?${query}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "X-BAPI-API-KEY": key,
        "X-BAPI-TIMESTAMP": String(ts),
        "X-BAPI-SIGN": signature,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
        "X-BAPI-SIGN-TYPE": "2",
      },
    }
  );

  return readJson(response, "BYBIT_PRIVATE_GET");
}

async function privatePost(path, body, key, secret) {
  const ts = await timestamp();
  const text = JSON.stringify(body);

  const signature = await hmac(
    secret,
    `${ts}${key}${RECV_WINDOW}${text}`
  );

  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "X-BAPI-API-KEY": key,
      "X-BAPI-TIMESTAMP": String(ts),
      "X-BAPI-SIGN": signature,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN-TYPE": "2",
    },
    body: text,
  });

  return readJson(response, "BYBIT_PRIVATE_POST");
}

async function handle(req) {
  /*
   * HARD DEMO-ONLY GUARD
   */
  if ((process.env.BYBIT_DEMO || "").toLowerCase() !== "true") {
    return json(
      {
        ok: false,
        error: "DEMO_GUARD_BLOCKED",
      },
      403
    );
  }

  try {
    const isPost = req.method === "POST";

    const body = isPost
      ? await req.json().catch(() => ({}))
      : {};

    const url = new URL(req.url);

    const action = String(
      body.action ||
        url.searchParams.get("action") ||
        "health"
    );

    /*
     * HEALTH
     */
    if (action === "health") {
      return json({
        ok: true,
        mode: "DEMO",
        demo_guard: true,
        base_url: BASE,
        timestamp: Date.now(),
      });
    }

    const key = process.env.BYBIT_API_KEY || "";
    const secret = process.env.BYBIT_API_SECRET || "";

    if (!key || !secret) {
      return json(
        {
          ok: false,
          error: "BYBIT_SECRETS_MISSING",
        },
        500
      );
    }

    /*
     * BALANCE
     */
    if (action === "balance") {
      const result = await privateGet(
        "/v5/account/wallet-balance",
        {
          accountType: "UNIFIED",
        },
        key,
        secret
      );

      return json({
        mode: "DEMO",
        ...result,
      });
    }

    /*
     * TICKER
     */
    if (action === "ticker") {
      const category = String(
        body.category ||
          url.searchParams.get("category") ||
          "spot"
      );

      const symbol = String(
        body.symbol ||
          url.searchParams.get("symbol") ||
          "BTCUSDT"
      ).toUpperCase();

      const result = await publicGet(
        "/v5/market/tickers",
        {
          category,
          symbol,
        }
      );

      return json({
        mode: "DEMO",
        ...result,
      });
    }

    /*
     * INSTRUMENT INFO
     */
    if (action === "instrument") {
      const category = String(
        body.category || "spot"
      );

      const symbol = String(
        body.symbol || "BTCUSDT"
      ).toUpperCase();

      const result = await publicGet(
        "/v5/market/instruments-info",
        {
          category,
          symbol,
        }
      );

      return json({
        mode: "DEMO",
        ...result,
      });
    }

    /*
     * CREATE DEMO ORDER
     */
    if (action === "create_demo_order") {
      const category = String(
        body.category || "spot"
      );

      const symbol = String(
        body.symbol || "BTCUSDT"
      ).toUpperCase();

      const side = String(
        body.side || "Buy"
      );

      const orderType = String(
        body.orderType || "Market"
      );

      const qty = String(
        body.qty || ""
      );

      if (!qty) {
        return json(
          {
            ok: false,
            error: "QTY_REQUIRED",
          },
          400
        );
      }

      if (!/^(Buy|Sell)$/.test(side)) {
        return json(
          {
            ok: false,
            error: "INVALID_SIDE",
          },
          400
        );
      }

      if (!/^(Market|Limit)$/.test(orderType)) {
        return json(
          {
            ok: false,
            error: "INVALID_ORDER_TYPE",
          },
          400
        );
      }

      const order = {
        category,
        symbol,
        side,
        orderType,
        qty,
      };

      if (body.price != null) {
        order.price = String(body.price);
      }

      if (body.timeInForce != null) {
        order.timeInForce = String(
          body.timeInForce
        );
      }

      const result = await privatePost(
        "/v5/order/create",
        order,
        key,
        secret
      );

      return json({
        mode: "DEMO",
        ...result,
      });
    }

    /*
     * ORDER STATUS
     */
    if (action === "order_status") {
      const category = String(
        body.category || "spot"
      );

      const params = {
        category,
      };

      if (body.orderId) {
        params.orderId = String(
          body.orderId
        );
      } else if (body.orderLinkId) {
        params.orderLinkId = String(
          body.orderLinkId
        );
      } else {
        return json(
          {
            ok: false,
            error: "ORDER_ID_REQUIRED",
          },
          400
        );
      }

      const result = await privateGet(
        "/v5/order/realtime",
        params,
        key,
        secret
      );

      return json({
        mode: "DEMO",
        ...result,
      });
    }

    /*
     * CANCEL DEMO ORDER
     */
    if (action === "cancel_demo_order") {
      const category = String(
        body.category || "spot"
      );

      const symbol = String(
        body.symbol || "BTCUSDT"
      ).toUpperCase();

      const params = {
        category,
        symbol,
      };

      if (body.orderId) {
        params.orderId = String(
          body.orderId
        );
      } else if (body.orderLinkId) {
        params.orderLinkId = String(
          body.orderLinkId
        );
      } else {
        return json(
          {
            ok: false,
            error: "ORDER_ID_REQUIRED",
          },
          400
        );
      }

      const result = await privatePost(
        "/v5/order/cancel",
        params,
        key,
        secret
      );

      return json({
        mode: "DEMO",
        ...result,
      });
    }

    return json(
      {
        ok: false,
        error: "UNKNOWN_ACTION",
        action,
      },
      400
    );
  } catch (error) {
    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "INTERNAL_ERROR",
      },
      500
    );
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
