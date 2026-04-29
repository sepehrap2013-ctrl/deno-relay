const TARGET_BASE = (Deno.env.get("TARGET") || Deno.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-vercel-id",
  "x-deno-id", // platform specific
]);

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname + url.search;
  
  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname} -> ${TARGET_BASE || "(no target)"}`);

  if (!TARGET_BASE) {
    return new Response("Misconfigured: Set TARGET env var (e.g. https://xray.nickgur.online:8443)", { 
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const targetUrl = TARGET_BASE + pathname;

  const headers = new Headers();
  let clientIp = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

  for (const [key, value] of req.headers.entries()) {
    const k = key.toLowerCase();
    if (STRIP_HEADERS.has(k) || k.startsWith("x-deno-") || k.startsWith("x-vercel-") || k.startsWith("cf-")) continue;
    if (k === "x-real-ip" || k === "x-forwarded-for") continue;
    headers.set(key, value);
  }

  if (clientIp) headers.set("x-forwarded-for", clientIp);

  // Important: Backend usually expects its own hostname in the Host header
  try {
    const backendHost = new URL(TARGET_BASE).host;
    headers.set("host", backendHost);
  } catch (e) {
    console.error("Invalid TARGET URL format");
  }

  const method = req.method;
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);

  const fetchOptions: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };

  if (hasBody && req.body) {
    fetchOptions.body = req.body;
    // @ts-ignore - Duplex is supported in recent runtimes for streaming
    (fetchOptions as any).duplex = "half";
  }

  try {
    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers(upstream.headers);
    for (const k of STRIP_HEADERS) {
      responseHeaders.delete(k);
    }
    responseHeaders.delete("transfer-encoding");
    responseHeaders.delete("content-length"); // Let Deno/streaming handle sizing where possible

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("Relay error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { 
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
});
