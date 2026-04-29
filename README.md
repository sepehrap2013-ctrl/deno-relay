Deno Deploy XHTTP/VLESS Relay (adapted from Vercel-XHTTP and netlify-relay).

Set environment variable:
- `TARGET=https://xray.nickgur.online:8443` (or TARGET_DOMAIN)

Deploy via GitHub integration on https://dash.deno.com. Use the client config with `host=your-deno-subdomain.deno.net` and `path=/daddy` (or whatever your backend Xray inbound expects).
