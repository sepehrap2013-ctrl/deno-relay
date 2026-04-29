// server.ts — for Render (Node.js environment)
import { createServer, IncomingMessage, ServerResponse } from "node:http";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

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

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (!TARGET_BASE) {
    res.writeHead(500);
    res.end("Misconfigured: TARGET_DOMAIN env var is required");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  try {
    const targetUrl = new URL(req.url || "/", TARGET_BASE).toString();

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k) || k.startsWith("cf-")) continue;
      if (typeof value === "string") headers[k] = value;
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      ...(hasBody && {
        // @ts-ignore
        body: req,
        duplex: "half",
      }),
    });

    const responseHeaders: Record<string, string> = { ...corsHeaders() };
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (!["transfer-encoding", "connection", "keep-alive"].includes(k)) {
        responseHeaders[k] = value;
      }
    });

    res.writeHead(upstream.status, responseHeaders);

    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
    console.log(`${req.method} ${req.url} → ${targetUrl} [${upstream.status}]`);

  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    res.writeHead(isTimeout ? 504 : 502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: isTimeout ? "Gateway Timeout" : "Bad Gateway" }));
  }
});

const PORT = parseInt(process.env.PORT || "3000");
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
