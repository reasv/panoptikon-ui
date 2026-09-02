// Assertions for lib/policyTokenOrigin.ts: which gateway origins an SSR
// request may be routed to from the `x-panoptikon-policy` token. No test
// runner in this repo — run it directly from the ui root:
//
//   node --experimental-strip-types scripts/policytoken.test.mjs
//
// Exits non-zero on the first failing assertion set.

import { createChecker } from "./harness.mjs"
import { register } from "node:module"
register("./ts-hooks.mjs", import.meta.url)

const { originFromPolicyToken, retargetRequest } = await import(
  "../lib/policyTokenOrigin.ts"
)
const { check, finish } = createChecker()

const enc = (s) => Buffer.from(s, "utf8").toString("base64url")
// The gateway's shape: <policy>.<expiry>.<origin_b64url>.<hmac_hex>. The
// HMAC is opaque to this server, so any hex will do here.
const token = (origin, policy = "localhost") =>
  `${policy}.1900000000.${enc(origin)}.${"ab".repeat(32)}`

// Accepted: exactly what the gateway mints for a loopback listener.
check(
  "ipv4 loopback origin",
  originFromPolicyToken(token("http://127.0.0.1:6344")) === "http://127.0.0.1:6344"
)
check(
  "ipv6 loopback origin",
  originFromPolicyToken(token("http://[::1]:6342")) === "http://[::1]:6342"
)
check(
  "localhost origin",
  originFromPolicyToken(token("http://localhost:6342")) === "http://localhost:6342"
)
check(
  "other 127/8 address",
  originFromPolicyToken(token("http://127.0.0.2:6342")) === "http://127.0.0.2:6342"
)
check(
  "dotted policy name does not shift the origin segment",
  originFromPolicyToken(token("http://127.0.0.1:1", "a.b.c")) === "http://127.0.0.1:1"
)
// Canonicalized, not compared textually: the gateway mints an explicit
// port and whatever host spelling its config holds.
check(
  "default port 80 (parser elides it)",
  originFromPolicyToken(token("http://127.0.0.1:80")) === "http://127.0.0.1"
)
check(
  "long-form ipv6 loopback",
  originFromPolicyToken(token("http://[0:0:0:0:0:0:0:1]:6342")) === "http://[::1]:6342"
)
check(
  "mixed-case localhost",
  originFromPolicyToken(token("http://LOCALHOST:6342")) === "http://localhost:6342"
)
check(
  "127.1 shorthand canonicalizes to loopback",
  originFromPolicyToken(token("http://127.1:6342")) === "http://127.0.0.1:6342"
)
check(
  "trailing slash canonicalizes to the origin",
  originFromPolicyToken(token("http://127.0.0.1:6342/")) === "http://127.0.0.1:6342"
)

// Refused: everything that is not a plain-http loopback origin, and every
// token shape that does not carry one.
const refused = [
  ["null", null],
  ["undefined", undefined],
  ["empty", ""],
  ["three-segment pre-origin format", `localhost.1900000000.${"ab".repeat(32)}`],
  ["garbage", "total.garbage"],
  ["origin segment not base64url", `localhost.1900000000.!!!!.${"ab".repeat(32)}`],
  ["empty origin segment", `localhost.1900000000..${"ab".repeat(32)}`],
  ["origin segment not a URL", `localhost.1900000000.${enc("not a url")}.${"ab".repeat(32)}`],
  ["non-loopback host", token("http://10.0.0.5:6342")],
  ["public hostname", token("http://example.com:6342")],
  ["https refused", token("https://127.0.0.1:6342")],
  ["path refused", token("http://127.0.0.1:6342/api")],
  ["query refused", token("http://127.0.0.1:6342?x=1")],
  ["credentials refused", token("http://user:pw@127.0.0.1:6342")],
  ["empty policy name", `.1900000000.${enc("http://127.0.0.1:6342")}.${"ab".repeat(32)}`],
  ["localhost subdomain refused", token("http://evil.localhost:6342")],
  ["file scheme refused", token("file:///etc/passwd")],
]
for (const [name, value] of refused) {
  const got = originFromPolicyToken(value)
  check(`refused: ${name}`, got === null, got === null ? "" : `got ${got}`)
}

// retargetRequest: what SSR actually sends. Node's global Request is the
// same WHATWG implementation (undici) Next's server runtime uses.
const post = () =>
  new Request("http://127.0.0.1:6342/api/search/pql?index_db=a%20b%26c", {
    method: "POST",
    headers: { "content-type": "application/json", "x-panoptikon-policy": "t" },
    body: JSON.stringify({ query: { and_: [] } }),
    cache: "no-cache",
  })

{
  const req = post()
  check(
    "env var set: request untouched, whatever the token says",
    (await retargetRequest(req, token("http://127.0.0.1:6355"), "http://127.0.0.1:6343")) === req
  )
}
{
  const req = post()
  check("no token: request untouched", (await retargetRequest(req, null, null)) === req)
}
{
  const req = post()
  check(
    "unusable origin: request untouched",
    (await retargetRequest(req, token("http://10.0.0.5:6355"), null)) === req
  )
}
{
  const req = post()
  check(
    "already at the token origin: request untouched",
    (await retargetRequest(req, token("http://127.0.0.1:6342"), null)) === req
  )
}
{
  const req = post()
  const out = await retargetRequest(req, token("http://127.0.0.1:6355"), null)
  check("re-pointed: new request", out !== req)
  check(
    "re-pointed: origin swapped, path and encoded query kept",
    out.url === "http://127.0.0.1:6355/api/search/pql?index_db=a%20b%26c",
    out.url
  )
  check("re-pointed: method kept", out.method === "POST")
  check(
    "re-pointed: headers kept",
    out.headers.get("content-type") === "application/json" &&
      out.headers.get("x-panoptikon-policy") === "t"
  )
  check("re-pointed: cache mode kept", out.cache === "no-cache", out.cache)
  const text = await out.text()
  check("re-pointed: body kept", text === JSON.stringify({ query: { and_: [] } }), text)
}
{
  const req = new Request("http://127.0.0.1:6342/api/db", { method: "GET" })
  const out = await retargetRequest(req, token("http://[::1]:6355"), null)
  check("re-pointed GET: no body, ipv6 origin", out.url === "http://[::1]:6355/api/db" && out.body === null, out.url)
}

finish()
