import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { parseStrictJson } from "./strict-json.js";

export const failure = (code) => Object.assign(new Error(code), { code });
export function publicIp(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Conservative global-unicast policy. Mapped IPv4, local, multicast and transition ranges are denied.
  if (net.isIP(address) === 6) {
    const normalized = new URL("http://[" + address + "]").hostname.slice(
      1,
      -1,
    );
    const parts = normalized.split(":");
    return (
      /^[23][0-9a-f]{3}:/i.test(normalized) &&
      !(
        parts[0] === "2001" &&
        (parseInt(parts[1] || "0", 16) < 512 || parts[1] === "db8")
      ) &&
      !/^(2002|3fff):/i.test(normalized)
    );
  }
  return false;
}
export function endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw failure("ENDPOINT_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw failure("ENDPOINT_POLICY_DENIED");
  if (
    net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    !url.hostname.includes(".") ||
    /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)
  )
    throw failure("ENDPOINT_POLICY_DENIED");
  return url;
}

// DNS is checked on every request, then that exact address is pinned into TLS lookup.
// Redirects/proxies are never followed. URLs/credentials/upstream error bodies are not logged.
export async function requestJson(
  value,
  { body, signal, timeoutMs = 12000, maxBytes = 1024 * 1024 } = {},
) {
  const url = endpoint(value),
    controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false,
    abortListener;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const aborted = new Promise((_, reject) => {
      abortListener = () =>
        reject(failure(timedOut ? "UPSTREAM_TIMEOUT" : "REQUEST_ABORTED"));
      controller.signal.addEventListener("abort", abortListener, {
        once: true,
      });
      if (controller.signal.aborted) abortListener();
    });
    return await Promise.race([
      aborted,
      (async () => {
        if (controller.signal.aborted) throw failure("REQUEST_ABORTED");
        let addresses;
        try {
          addresses = await dns.lookup(url.hostname, { all: true });
        } catch {
          throw failure("DNS_UNAVAILABLE");
        }
        if (
          !addresses.length ||
          addresses.some((item) => !publicIp(item.address))
        )
          throw failure("PRIVATE_NETWORK_DENIED");
        if (controller.signal.aborted) throw failure("REQUEST_ABORTED");
        const selected =
          addresses.find((item) => item.family === 4) || addresses[0];
        const payload =
          body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        return await new Promise((resolve, reject) => {
          const req = https.request(
            url,
            {
              method: payload ? "POST" : "GET",
              agent: false,
              signal: controller.signal,
              lookup: (_host, options, callback) =>
                options?.all
                  ? callback(null, [selected])
                  : callback(null, selected.address, selected.family),
              headers: {
                accept: "application/json",
                "accept-encoding": "identity",
                ...(payload
                  ? {
                      "content-type": "application/json",
                      "content-length": payload.length,
                    }
                  : {}),
              },
            },
            (res) => {
              const status = res.statusCode;
              if (status !== 200) {
                res.destroy();
                reject(
                  failure(
                    status === 429
                      ? "RATE_LIMITED"
                      : status >= 300 && status < 400
                        ? "REDIRECT_DENIED"
                        : "UPSTREAM_HTTP_ERROR",
                  ),
                );
                return;
              }
              if (
                !/^application\/(?:[\w.+-]*\+)?json(?:\s*;|$)/i.test(
                  res.headers["content-type"] || "",
                )
              ) {
                res.destroy();
                reject(failure("CONTENT_TYPE_INVALID"));
                return;
              }
              let size = 0;
              const chunks = [];
              res.on("data", (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                  res.destroy();
                  reject(failure("RESPONSE_TOO_LARGE"));
                } else chunks.push(chunk);
              });
              res.on("error", () => reject(failure("RESPONSE_INCOMPLETE")));
              res.on("end", () => {
                const rawBytes = Buffer.concat(chunks);
                try {
                  resolve({ body: parseStrictJson(rawBytes), rawBytes });
                } catch {
                  reject(failure("UPSTREAM_JSON_INVALID"));
                }
              });
            },
          );
          req.on("error", () =>
            reject(
              failure(
                timedOut
                  ? "UPSTREAM_TIMEOUT"
                  : controller.signal.aborted
                    ? "REQUEST_ABORTED"
                    : "UPSTREAM_UNAVAILABLE",
              ),
            ),
          );
          req.end(payload);
        });
      })(),
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    controller.signal.removeEventListener("abort", abortListener);
  }
}
