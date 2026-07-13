/**
 * Cloudflare Worker — CORS gateway in front of the public R2 bucket.
 *
 * Upstream assets live at:
 *   https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev/Home3D/...
 *
 * Example: /Home3D/models/floor.glb
 *   → https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev/Home3D/models/floor.glb
 *
 * Serves full-file HTTP 200 only (no Range / 206) for Three.js GLTFLoader.
 */

const R2_PUBLIC_BASE = "https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev";

const ALLOWED_ORIGINS = new Set([
  "https://bookman7705.github.io",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function corsHeaders(origin) {
  const allowOrigin =
    origin && isAllowedOrigin(origin) ? origin : "https://bookman7705.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    if (origin && !isAllowedOrigin(origin)) {
      return new Response("Forbidden", { status: 403, headers: cors });
    }

    const key = url.pathname.replace(/^\/+/, "");
    if (!key || key === "favicon.ico") {
      return new Response("Missing file", { status: 400, headers: cors });
    }

    // Prefer bound R2 bucket when configured; otherwise proxy the public R2 URL.
    let body = null;
    let status = 200;
    const headers = new Headers();

    if (env.MODELS) {
      let object = await env.MODELS.get(key);
      if (!object && key.startsWith("Home3D/")) {
        object = await env.MODELS.get(key.slice("Home3D/".length));
      } else if (!object && !key.startsWith("Home3D/")) {
        object = await env.MODELS.get(`Home3D/${key}`);
      }

      if (!object) {
        return new Response("Not found", { status: 404, headers: cors });
      }

      object.writeHttpMetadata(headers);
      if (object.httpEtag) headers.set("ETag", object.httpEtag);
      headers.set("Content-Length", String(object.size));
      if (request.method !== "HEAD") {
        body = await object.arrayBuffer();
      }
    } else {
      const upstreamUrl = `${R2_PUBLIC_BASE}/${key}`;
      const upstream = await fetch(upstreamUrl, {
        method: request.method === "HEAD" ? "GET" : request.method,
        cf: { cacheTtl: 86400, cacheEverything: true },
      });

      if (!upstream.ok) {
        return new Response("Not found", { status: upstream.status, headers: cors });
      }

      upstream.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        if (lower === "content-range" || lower === "accept-ranges") return;
        headers.set(name, value);
      });

      if (request.method === "HEAD") {
        status = 200;
      } else {
        body = await upstream.arrayBuffer();
        headers.set("Content-Length", String(body.byteLength));
      }
    }

    headers.delete("Content-Range");
    headers.delete("Accept-Ranges");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);

    return new Response(request.method === "HEAD" ? null : body, {
      status,
      headers,
    });
  },
};
