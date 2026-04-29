// index.ts

const TARGET_BASE = (Deno.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded", "x-forwarded-host",
  "x-forwarded-proto", "x-forwarded-port",
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN env var is required", { status: 500 });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
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

    const hasBody = req.body !== null && !["GET", "HEAD"].includes(req.method);

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000), // 60s — important for XHTTP long-polling
      ...(hasBody && {
        body: req.body,
        // @ts-ignore: required for streaming request bodies
        duplex: "half",
      }),
    });

    const responseHeaders = new Headers(upstream.headers);

    // Inject CORS headers
    for (const [k, v] of Object.entries(corsHeaders())) {
      responseHeaders.set(k, v);
    }

    // Remove hop-by-hop headers from upstream response
    responseHeaders.delete("transfer-encoding");
    responseHeaders.delete("connection");
    responseHeaders.delete("keep-alive");

    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} → ${targetUrl} [${upstream.status}]`);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    console.error(`[ERROR] ${isTimeout ? "Timeout" : "Relay error"}:`, error);
    return new Response(
      JSON.stringify({ error: isTimeout ? "Gateway Timeout" : "Bad Gateway" }),
      {
        status: isTimeout ? 504 : 502,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );
  }
});
