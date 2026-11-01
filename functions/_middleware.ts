/**
 * Cloudflare Pages Functions middleware for the path-style workflow detail page.
 *
 * The page itself is static HTML (Astro, at `/<locale?>/explore/workflow/`) and is
 * hydrated client-side from `/api/workflow?workflowId=...`. The edge can not know the
 * workflow at build time, so this middleware:
 *
 *   1. permanently redirects the legacy query style to the path style
 *      (`/explore/workflow/?id=<id>` -> `/explore/workflow/<id>`, 301, no D1 lookup),
 *   2. redirects the id-less page to the locale explorer (302),
 *   3. for `/explore/workflow/<id>` rewrites the request to the static page HTML,
 *      looks the workflow up in D1 and injects title/canonical/og/twitter/hreflang/
 *      heading/JSON-LD with HTMLRewriter.
 *
 * Responsibilities kept here are only Cloudflare-specific ones (request gating, D1,
 * rewrite, HTMLRewriter, status/headers). All decisions live in `./workflowMeta.ts`,
 * which is pure and unit-tested by `node functions/workflowMeta.test.mjs`.
 *
 * Failure policy: the middleware must never break the page. A failed D1 lookup still
 * serves the static (client-hydrated) page; unexpected errors fall back to the
 * unmodified response.
 */
import type { Env } from "./api/auth";
import type {
  AlternateLink,
  WorkflowMetaRow,
  WorkflowResolvedDecision,
} from "./workflowMeta";
import {
  SOCIAL_IMAGE_HEIGHT,
  SOCIAL_IMAGE_TYPE,
  SOCIAL_IMAGE_WIDTH,
  buildWorkflowMetadata,
  escapeHtmlAttribute,
  matchWorkflowDetailIdPath,
  matchWorkflowDetailPath,
  workflowStaticPagePathForLocale,
} from "./workflowMeta";

/** One D1 round-trip: exactly the columns the metadata decision needs. */
const WORKFLOW_META_QUERY =
  "SELECT id, filename, description, is_private, author_data, tags FROM yaml_files WHERE id = ?";

const ROBOTS_NOINDEX_META = '<meta name="robots" content="noindex">';

/**
 * Marker header set on the internally rewritten request. If Pages re-enters the
 * middleware for the rewritten page URL, this makes that pass an immediate no-op so
 * the second pass can never redirect or rewrite the static page request.
 */
const REWRITE_MARKER_HEADER = "x-diflowy-workflow-page";
const REWRITE_MARKER_VALUE = "1";

/** Signature of the Pages `context.next()` helper. */
type NextFunction = (input?: Request | string, init?: RequestInit) => Promise<Response>;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;

  // Used for the "never break the page" fallback: if we already have an untouched
  // response, prefer it over calling next() a second time.
  let response: Response | undefined;

  try {
    // HEAD is treated exactly like GET for metadata purposes; its body is dropped at
    // the end (see emptyBodyResponse). Other methods stay untouched.
    if (request.method !== "GET" && request.method !== "HEAD") return next();

    const url = new URL(request.url);
    const idMatch = matchWorkflowDetailIdPath(url.pathname);
    const pageMatch =
      idMatch === null ? matchWorkflowDetailPath(url.pathname) : null;
    if (idMatch === null && pageMatch === null) return next();

    // Internal rewrite passthrough (see REWRITE_MARKER_HEADER).
    if (request.headers.get(REWRITE_MARKER_HEADER) === REWRITE_MARKER_VALUE) {
      return next();
    }

    const accept = request.headers.get("accept") ?? "";
    const acceptsHtml =
      accept.length === 0 || /text\/html/i.test(accept) || accept.includes("*/*");
    if (!acceptsHtml) return next();

    const locale =
      idMatch !== null ? idMatch.locale : pageMatch !== null ? pageMatch.locale : "";

    if (idMatch === null) {
      // Bare page: legacy ?id= -> 301 to the path form, otherwise 302 to /explore.
      const queryWorkflowId = (url.searchParams.get("id") ?? "").trim();
      const redirect = buildWorkflowMetadata({
        origin: url.origin,
        pathname: url.pathname,
        queryWorkflowId,
        row: null,
      });
      if (redirect.kind !== "redirect") return next();
      return redirectResponse(redirect.location, redirect.status);
    }

    // Path style: resolve the id (already URL-decoded by the matcher) in D1.
    const workflowId = idMatch.workflowId;
    let row: WorkflowMetaRow | null = null;
    try {
      if (env.D1) {
        row =
          (await env.D1.prepare(WORKFLOW_META_QUERY)
            .bind(workflowId)
            .first<WorkflowMetaRow>()) ?? null;
      }
    } catch (error) {
      // A D1 hiccup must not take the page down: serve it unmodified so the
      // client-side hydration can still load the workflow.
      console.error("workflow-metadata: D1 lookup failed", error);
      const fallbackPage = await serveStaticPage(next, request, url, locale);
      return request.method === "HEAD" ? emptyBodyResponse(fallbackPage) : fallbackPage;
    }

    const decision = buildWorkflowMetadata({
      origin: url.origin,
      pathname: url.pathname,
      pathWorkflowId: workflowId,
      row,
    });
    if (decision.kind === "redirect") {
      // Defensive: a path-style URL cannot redirect, but never swallow it if it does.
      return redirectResponse(decision.location, decision.status);
    }

    response = await serveStaticPage(next, request, url, decision.locale);
    if (!response.ok) return response; // e.g. 304 Not Modified
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return response;

    const rendered = renderWorkflowMetadata(response, decision, workflowId);
    return request.method === "HEAD" ? emptyBodyResponse(rendered) : rendered;
  } catch (error) {
    console.error("workflow-metadata: middleware failed", error);
    return response ?? next();
  }
};

/**
 * HEAD response: identical status/headers to the GET response, but no body.
 * The (streaming) body is cancelled so the HTMLRewriter pipeline is torn down.
 */
function emptyBodyResponse(response: Response): Response {
  try {
    void response.body?.cancel();
  } catch {
    // Body may already be locked/consumed; headers are all that matters for HEAD.
  }
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function redirectResponse(location: string, status: 301 | 302): Response {
  const headers: Record<string, string> = { Location: location };
  if (status === 302) headers["Cache-Control"] = "no-store";
  return new Response(null, { status, headers });
}

/**
 * Serves the static Astro page HTML for the workflow detail route by rewriting the
 * request inside the middleware. `/explore/workflow/<id>` has no static asset of its
 * own; the page lives at `/<locale?>/explore/workflow/`.
 *
 * `next(input)` forwards the (rewritten) request to the rest of the Pages chain, where
 * the asset server answers with the directory-index HTML. The marker header makes the
 * re-entrant middleware pass (if Pages chooses to run it) a no-op.
 */
async function serveStaticPage(
  next: NextFunction,
  request: Request,
  url: URL,
  locale: string,
): Promise<Response> {
  const pagePath = workflowStaticPagePathForLocale(locale);
  if (pagePath === url.pathname) return next();

  const headers = new Headers(request.headers);
  headers.set(REWRITE_MARKER_HEADER, REWRITE_MARKER_VALUE);
  const rewriteRequest = new Request(new URL(pagePath, url.origin).toString(), {
    method: "GET",
    headers,
  });
  return next(rewriteRequest);
}

/**
 * Applies the decision to the static HTML response.
 *
 * HTMLRewriter escapes text/attribute values for us, so `setInnerContent`/`setAttribute`
 * are safe for hostile workflow names. JSON-LD is the exception (raw text inside a
 * `<script>` element) and is escaped beforehand by `serializeJsonLd`.
 */
function renderWorkflowMetadata(
  response: Response,
  decision: WorkflowResolvedDecision,
  workflowId: string,
): Response {
  const metadata = decision.kind === "metadata" ? decision : null;
  const noindex =
    decision.kind === "notFound" ||
    (metadata !== null && metadata.robots === "noindex");

  const rewriter = new HTMLRewriter();

  if (metadata !== null) {
    const meta = metadata;

    if (meta.title !== null) {
      const title = meta.title;
      // HTMLRewriter escapes text content itself, so <title> takes the raw value.
      rewriter.on("title", {
        element(element) {
          element.setInnerContent(title);
        },
      });
      // Attribute values need explicit escaping (HTMLRewriter only escapes `"`).
      const titleAttribute = escapeHtmlAttribute(title);
      rewriter.on('meta[property="og:title"]', {
        element(element) {
          element.setAttribute("content", titleAttribute);
        },
      });
      rewriter.on('meta[name="twitter:title"]', {
        element(element) {
          element.setAttribute("content", titleAttribute);
        },
      });
    }

    if (meta.description !== null) {
      const descriptionAttribute = escapeHtmlAttribute(meta.description);
      rewriter.on('meta[name="description"]', {
        element(element) {
          element.setAttribute("content", descriptionAttribute);
        },
      });
      rewriter.on('meta[property="og:description"]', {
        element(element) {
          element.setAttribute("content", descriptionAttribute);
        },
      });
      rewriter.on('meta[name="twitter:description"]', {
        element(element) {
          element.setAttribute("content", descriptionAttribute);
        },
      });
    }

    // Per-workflow Open Graph image (public rows only). Private/notFound decisions carry
    // `socialImageUrl: null`, so those pages keep the site-wide og.jpg untouched.
    if (meta.socialImageUrl !== null && meta.socialImageAlt !== null) {
      // May carry `&lang=<locale>`: attribute-escape it so the raw markup is
      // `&amp;lang=...` (browsers/crawlers decode it back to `&`).
      const socialImageUrl = escapeHtmlAttribute(meta.socialImageUrl);
      const socialImageAlt = escapeHtmlAttribute(meta.socialImageAlt);
      for (const selector of [
        'meta[property="og:image"]',
        'meta[property="og:image:url"]',
        'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]',
      ]) {
        rewriter.on(selector, {
          element(element) {
            element.setAttribute("content", socialImageUrl);
          },
        });
      }
      rewriter.on('meta[property="og:image:type"]', {
        element(element) {
          element.setAttribute("content", SOCIAL_IMAGE_TYPE);
        },
      });
      rewriter.on('meta[property="og:image:width"]', {
        element(element) {
          element.setAttribute("content", String(SOCIAL_IMAGE_WIDTH));
        },
      });
      rewriter.on('meta[property="og:image:height"]', {
        element(element) {
          element.setAttribute("content", String(SOCIAL_IMAGE_HEIGHT));
        },
      });
      for (const selector of [
        'meta[property="og:image:alt"]',
        'meta[name="twitter:image:alt"]',
      ]) {
        rewriter.on(selector, {
          element(element) {
            element.setAttribute("content", socialImageAlt);
          },
        });
      }
    }

    // Works for both the current <h1 id="workflowname"> and the older <h3>.
    if (meta.heading !== null) {
      const heading = meta.heading;
      rewriter.on("#workflowname", {
        element(element) {
          element.setInnerContent(heading);
        },
      });
    }

    // One normalized path-style URL form for canonical, og:url and hreflang alternates.
    const canonicalUrl = meta.canonicalUrl;
    rewriter.on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", canonicalUrl);
      },
    });
    rewriter.on('meta[property="og:url"]', {
      element(element) {
        element.setAttribute("content", canonicalUrl);
      },
    });

    const alternates = new Map<string, string>(
      meta.alternates.map((alternate: AlternateLink) => [
        alternate.hreflang.toLowerCase(),
        alternate.href,
      ]),
    );
    // NOTE: `rel="sitemap"` links are intentionally left alone; only alternates with an
    // `hreflang` attribute are rewritten.
    rewriter.on('link[rel="alternate"]', {
      element(element) {
        const hreflang = element.getAttribute("hreflang");
        if (hreflang === null || hreflang.trim().length === 0) return;
        const mapped = alternates.get(hreflang.trim().toLowerCase());
        if (mapped !== undefined) {
          element.setAttribute("href", mapped);
          return;
        }
        // Unknown locale: keep it locale-preserving by turning its page href into the
        // path-style form with the current workflow id.
        const currentHref = element.getAttribute("href");
        if (currentHref === null) return;
        try {
          const alternateUrl = new URL(currentHref, meta.canonicalUrl);
          const basePath = alternateUrl.pathname.replace(/\/+$/, "");
          element.setAttribute(
            "href",
            `${alternateUrl.origin}${basePath}/${encodeURIComponent(workflowId)}`,
          );
        } catch {
          // Leave unparseable hrefs untouched.
        }
      },
    });
  }

  // Single `head` handler so JSON-LD and the noindex meta can be appended together.
  const jsonLd =
    metadata !== null && metadata.jsonLd !== null
      ? `<script type="application/ld+json">${metadata.jsonLd}</script>`
      : null;
  if (jsonLd !== null || noindex) {
    rewriter.on("head", {
      element(element) {
        if (jsonLd !== null) element.append(jsonLd, { html: true });
        if (noindex) element.append(ROBOTS_NOINDEX_META, { html: true });
      },
    });
  }

  const transformed = rewriter.transform(response);
  const headers = new Headers(transformed.headers);
  // The body changed, so upstream validators/length/encoding no longer apply.
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.delete("last-modified");
  if (noindex) headers.set("X-Robots-Tag", "noindex");

  const notFound = decision.kind === "notFound";
  return new Response(transformed.body, {
    status: notFound ? 404 : transformed.status,
    statusText: notFound ? "Not Found" : transformed.statusText,
    headers,
  });
}
