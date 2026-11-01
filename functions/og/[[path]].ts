/**
 * Dynamic per-workflow Open Graph image.
 *
 * `GET /og/workflow.png?id=<workflowId>` returns a 1200x630 PNG:
 *  - public workflow row  -> card with the workflow's name/description/author,
 *  - private row, unknown id, or any failure -> generic Diflowy card.
 *
 * The page middleware (`functions/_middleware.ts` + `functions/workflowMeta.ts`)
 * points `og:image` at this URL for locale workflow detail pages; it is kept
 * independent of that middleware so a broken image can never break the page.
 *
 * Rendering uses `@cloudflare/pages-plugin-vercel-og` (satori + resvg wasm) and
 * the two SIL-OFL Inter weights under `public/fonts/`, loaded from static assets
 * on first use and cached in module scope.
 *
 * Failure policy: every code path is wrapped in try/catch and degrades to the
 * generic card, whose content never depends on the requested workflow. The
 * rendered PNG is buffered before returning so that render errors (which would
 * otherwise surface lazily inside the response stream, after the 200 was sent)
 * can be caught and replaced.
 */
import type { Env } from "../api/auth";
import { ImageResponse } from "@cloudflare/pages-plugin-vercel-og/api";
import {
  OG_CACHE_CONTROL,
  OG_ERROR_CACHE_CONTROL,
  OG_HEIGHT,
  OG_WIDTH,
  buildGenericCard,
  buildWorkflowCard,
  buildWorkflowCardData,
  isPublicWorkflowRow,
  normalizeCardLanguage,
  type SatoriElement,
  type WorkflowOgRow,
} from "./card";

/** Exactly the columns the card needs, looked up by primary key. */
const WORKFLOW_OG_QUERY =
  "SELECT id, filename, description, is_private, author_data, tags FROM yaml_files WHERE id = ?";

/** The only path this function serves (the `[[path]]` route matches any /og/*). */
const WORKFLOW_OG_PATH = "/og/workflow.png";

/** Defensive cap: workflow ids are ~16 chars, anything longer is junk. */
const WORKFLOW_ID_MAX_LENGTH = 128;

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

const FONT_SOURCES: ReadonlyArray<{ path: string; weight: 400 | 700 }> = [
  { path: "/fonts/Inter-Regular.ttf", weight: 400 },
  { path: "/fonts/Inter-Bold.ttf", weight: 700 },
];

/**
 * Font binaries are static and identical for every request, so they are fetched
 * once per isolate and reused (an isolate serves many image requests).
 */
let fontsPromise: Promise<OgFont[]> | null = null;

function loadFonts(request: Request, env: Env): Promise<OgFont[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all(
      FONT_SOURCES.map(async (source) => {
        const response = await fetchStaticAsset(request, env, source.path);
        if (!response.ok) {
          throw new Error(`font asset ${source.path} returned HTTP ${response.status}`);
        }
        return {
          name: "Inter",
          data: await response.arrayBuffer(),
          weight: source.weight,
          style: "normal" as const,
        };
      }),
    ).catch((error) => {
      // Let the next request retry instead of caching a rejected promise.
      fontsPromise = null;
      throw error;
    });
  }
  return fontsPromise;
}

/**
 * Reads a file from the project's static assets. Pages exposes the asset router
 * as `env.ASSETS`; a same-origin `fetch` is a plain fallback for environments
 * without that binding (the pattern used by Cloudflare's own OG examples).
 */
async function fetchStaticAsset(request: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(path, request.url).toString();
  const assets = (env as Env & {
    ASSETS?: { fetch?: (input: Request | string) => Promise<Response> };
  }).ASSETS;
  if (assets && typeof assets.fetch === "function") {
    try {
      const viaAssets = await assets.fetch(new Request(url, { method: "GET" }));
      if (viaAssets.ok) return viaAssets;
    } catch (error) {
      // Fall through to a same-origin fetch instead of failing the card.
      console.warn(`og-image: ASSETS fetch failed for ${path}`, error);
    }
  }
  return fetch(url, { method: "GET" });
}

/** Renders a satori element to PNG bytes, buffered so failures are catchable. */
async function renderPng(element: SatoriElement, fonts: OgFont[]): Promise<Uint8Array> {
  const image = new ImageResponse(element as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
  if (!image.body) throw new Error("renderer returned an empty body");
  const bytes = await new Response(image.body).arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("renderer returned an empty PNG");
  return new Uint8Array(bytes);
}

function pngResponse(png: Uint8Array, cacheControl: string): Response {
  return new Response(png, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": cacheControl,
      "content-length": String(png.byteLength),
    },
  });
}

/** Last-resort image when even the generic card cannot be rendered. */
async function staticImageFallback(request: Request, env: Env): Promise<Response> {
  try {
    const response = await fetchStaticAsset(request, env, "/og.jpg");
    if (response.ok) {
      return new Response(await response.arrayBuffer(), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "cache-control": OG_ERROR_CACHE_CONTROL,
        },
      });
    }
  } catch (error) {
    console.error("og-image: static fallback failed", error);
  }
  // Never a 500: an empty 204 lets the crawler keep its default preview.
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/**
 * Generic card for private rows, unknown ids and recoverable failures. It never
 * contains workflow data, so it is safe to cache publicly.
 */
async function genericResponse(
  request: Request,
  env: Env,
  cacheControl: string,
  reason: string,
): Promise<Response> {
  try {
    const fonts = await loadFonts(request, env);
    const png = await renderPng(buildGenericCard(), fonts);
    console.log(
      `og-image: card=generic reason=${reason} bytes=${png.byteLength} cache=${cacheControl}`,
    );
    return pngResponse(png, cacheControl);
  } catch (error) {
    console.error("og-image: generic card render failed", error);
    return staticImageFallback(request, env);
  }
}

async function lookupWorkflow(
  env: Env,
  workflowId: string,
): Promise<{ row: WorkflowOgRow | null; error: unknown }> {
  try {
    if (!env.D1) return { row: null, error: new Error("D1 binding is not configured") };
    const row = await env.D1.prepare(WORKFLOW_OG_QUERY)
      .bind(workflowId)
      .first<WorkflowOgRow>();
    return { row: row ?? null, error: null };
  } catch (error) {
    return { row: null, error };
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const startedAt = Date.now();

  try {
    if (url.pathname !== WORKFLOW_OG_PATH) {
      return new Response("Not Found", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    // Optional locale hint from the page middleware (e.g. `&lang=zh-Hant`) so
    // CJK text loads the right Noto fallback family; ignored when absent.
    const language = normalizeCardLanguage(url.searchParams.get("lang"));

    const rawId = url.searchParams.get("id");
    const workflowId = rawId === null ? "" : rawId.trim().slice(0, WORKFLOW_ID_MAX_LENGTH);
    if (workflowId.length === 0) {
      return await genericResponse(request, env, OG_CACHE_CONTROL, "missing-id");
    }

    const { row, error } = await lookupWorkflow(env, workflowId);
    if (error) {
      // A D1 hiccup must not 500 on a crawler; serve the generic card briefly.
      console.error(`og-image: D1 lookup failed for id=${workflowId}`, error);
      return await genericResponse(request, env, OG_ERROR_CACHE_CONTROL, "d1-error");
    }
    if (!row) {
      return await genericResponse(request, env, OG_CACHE_CONTROL, "unknown-id");
    }
    if (!isPublicWorkflowRow(row)) {
      // Private row: never render its name/description/author. The log line
      // intentionally contains only the id and the decision.
      return await genericResponse(request, env, OG_CACHE_CONTROL, "private-row");
    }

    // Public row: render the workflow card. Any render failure degrades to the
    // generic card with a short TTL so a transient issue is not cached for long.
    try {
      const data = buildWorkflowCardData(row, language);
      const fonts = await loadFonts(request, env);
      const png = await renderPng(buildWorkflowCard(data), fonts);
      console.log(
        `og-image: card=workflow id=${workflowId} name=${JSON.stringify(data.name)} ` +
          `author=${JSON.stringify(data.author)} lang=${data.language ?? "auto"} ` +
          `bytes=${png.byteLength} ms=${Date.now() - startedAt}`,
      );
      return pngResponse(png, OG_CACHE_CONTROL);
    } catch (renderError) {
      console.error(`og-image: workflow card render failed for id=${workflowId}`, renderError);
      return await genericResponse(request, env, OG_ERROR_CACHE_CONTROL, "render-error");
    }
  } catch (error) {
    // Absolute backstop: any unexpected throw still yields an image.
    console.error("og-image: unhandled failure", error);
    return staticImageFallback(request, env);
  }
};
