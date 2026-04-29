const TARGET_BASE = (Deno.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

const HOP_BY_HOP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-connection", "proxy-authenticate",
  "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-real-ip",
]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN env var is required (e.g. https://xray.example.com:8443)", { 
      status: 500, 
      headers: { "content-type": "text/plain" } 
    });
  }

  // Optional: Handle preflight (rarely needed for XHTTP clients but harmless)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const targetUrl = new URL(url.pathname + url.search, TARGET_BASE).toString();

    const headers = new Headers();
    let clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");

    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(k) || k.startsWith("x-deno-") || k.startsWith("cf-") || k.startsWith("x-vercel-")) {
        continue;
      }
      if (k === "x-real-ip" || k === "x-forwarded-for") continue;
      headers.set(key, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    // Let fetch set correct Host based on TARGET_BASE (or explicitly set if your backend requires a specific one)
    // headers.set("host", new URL(TARGET_BASE).host); // Uncomment only if needed

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const fetchOpts: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers,
      redirect: "manual",
    };

    if (hasBody && req.body) {
      fetchOpts.body = req.body;
      fetchOpts.duplex = "half"; // Critical for bidirectional streaming (upload while receiving response)
    }

    const upstream = await fetch(targetUrl, fetchOpts);

    const responseHeaders = new Headers(upstream.headers);
    // Strip only true hop-by-hop headers. Do NOT blindly delete transfer-encoding/content-length
    // (this was likely breaking your download streaming).
    for (const key of HOP_BY_HOP_HEADERS) {
      responseHeaders.delete(key);
    }

    // Optional: Make it look more like a normal site on root path
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("OK - XHTTP Relay Active (Deno Deploy)", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("XHTTP Relay Error:", error);
    return new Response(`Bad Gateway: ${(error as Error).message}`, { 
      status: 502,
      headers: { "content-type": "text/plain" } 
    });
  }
});      if (k === "x-real-ip" || k === "x-forwarded-for") {
        clientIp = value;
        continue;
      }
      headers.set(k, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const isBodyless = req.method === "GET" || req.method === "HEAD";
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
      duplex: isBodyless ? undefined : "half",
    };

    if (!isBodyless) {
      fetchOptions.body = req.body;
    }

    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.delete("transfer-encoding");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Relay error:", error);
    return new Response("Bad Gateway", { status: 502 });
  }
});      headers.set(k, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const method = request.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const fetchOptions: RequestInit = {
      method,
      headers,
      redirect: "manual",
    };

    if (hasBody) {
      fetchOptions.body = request.body;
    }

    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers();
    for (const [key, value] of upstream.headers) {
      const k = key.toLowerCase();
      if (k === "transfer-encoding") continue;
      responseHeaders.set(key, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Relay error:", error);
    return new Response("Bad Gateway: Relay Failed", { status: 502 });
  }
});
