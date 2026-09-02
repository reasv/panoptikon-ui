/**
 * Routing SSR API calls by the gateway origin a policy token names.
 *
 * The gateway stamps every request it proxies to this server with
 * `x-panoptikon-policy: <policy>.<expiry>.<origin_b64url>.<hmac>` (the
 * panoptikon repo's policy_token.rs). The third segment is the loopback
 * base URL of the gateway listener the browser's request arrived on.
 * lib/serverApi.ts routes SSR API calls there when PANOPTIKON_API_URL is
 * unset, so a `next start` the gateway did not launch talks back to the
 * gateway that is actually in front of it — not to a compiled-in default
 * port, which is right for exactly one gateway on the machine and silently
 * wrong for every other (a scratch gateway's pages once rendered another
 * instance's whole library that way).
 *
 * This server cannot verify the HMAC — the key never leaves the gateway —
 * so the claim is routing advice under two constraints, never authority:
 * only a plain-http loopback origin is honored, and the env var always
 * wins. The residual exposure is a server-side fetch of the page's fixed
 * API paths to an attacker-chosen loopback port, available only to whoever
 * can reach this server without going through the gateway; hence the
 * README's advice to bind a hand-run UI to loopback or set the env var.
 */

/**
 * The gateway origin a token names, or null when the token carries nothing
 * this server should route to: the older three-segment format, garbage,
 * https, a non-loopback host, a path, a query, credentials.
 */
export function originFromPolicyToken(
  token: string | null | undefined
): string | null {
  if (!token) return null
  // Policy names may contain dots; the origin is always the second segment
  // from the right, whatever the name's shape. The name itself is only
  // required to be present, as the gateway requires it.
  const segments = token.split(".")
  if (segments.length < 4 || segments[0] === "") return null
  const encoded = segments[segments.length - 2]
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null
  // Buffer's base64url decoder never throws; malformed input just yields
  // bytes that fail to parse as a URL below.
  const decoded = Buffer.from(encoded, "base64url").toString("utf8")
  let url: URL
  try {
    url = new URL(decoded)
  } catch {
    return null
  }
  if (url.protocol !== "http:") return null
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null
  }
  if (!isLoopbackHost(url.hostname)) return null
  // The canonical origin, not the decoded text: the gateway mints an
  // explicit port and the parser elides a default one (`:80`), and it may
  // mint whatever host spelling `[server] host` holds (long-form IPv6,
  // mixed case). Everything a claim could smuggle past canonicalization —
  // a path, a query, credentials — was refused above.
  return url.origin
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host === "[::1]" || host === "::1") return true
  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  return dotted !== null && dotted[1] === "127"
}

/**
 * The request SSR should actually send: `request` itself when the env var
 * is set (it is authoritative), when the token names no usable origin, or
 * when the request already targets that origin; otherwise a copy of the
 * request re-pointed at the token's origin, with the path, query, method,
 * headers and body carried over.
 *
 * The body is buffered rather than streamed into the copy: a stream body
 * goes out chunked with no Content-Length, which the gateway's own
 * handlers accept but a stricter `[upstreams.api]` behind it might not,
 * and these bodies are small JSON.
 */
export async function retargetRequest(
  request: Request,
  token: string | null | undefined,
  envApiUrl: string | null
): Promise<Request> {
  if (envApiUrl) return request
  const origin = originFromPolicyToken(token)
  if (!origin) return request
  const target = new URL(request.url)
  const gateway = new URL(origin)
  if (target.origin === gateway.origin) return request
  target.protocol = gateway.protocol
  target.host = gateway.host
  const body = request.body === null ? undefined : await request.arrayBuffer()
  return new Request(target, {
    method: request.method,
    headers: request.headers,
    body,
    cache: request.cache,
    redirect: request.redirect,
    signal: request.signal,
  })
}
