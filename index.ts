const TARGET_BASE = (Deno.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN env var is required", { status: 500 });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const targetUrl = new URL(url.pathname + url.search, TARGET_BASE).toString();

    const headers = new Headers();
    let clientIp: string | null = null;

    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k) || k.startsWith("x-deno-") || k.startsWith("cf-")) continue;
      if (k === "x-real-ip" || k === "x-forwarded-for") {
        clientIp = value;
        continue;
      }
      headers.set(k, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
      ...(hasBody && { body: req.body, duplex: "half" as any }),
    };

    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.delete("transfer-encoding");
    // Optional: add XHTTP-friendly headers if needed
    // responseHeaders.set("connection", "keep-alive");

    console.log(`${req.method} ${url.pathname} -> ${targetUrl} [${upstream.status}]`);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Relay error:", error);
    return new Response("Bad Gateway", { status: 502 });
  }
});
