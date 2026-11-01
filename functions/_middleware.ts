/**
 * Cloudflare Pages Functions middleware for the workflow detail page.
 *
 * The page itself is static HTML (Astro) and is hydrated client-side from
 * `/api/workflow?workflowId=...`. The edge can not know the workflow at build time, so
 * this middleware fills in title/canonical/og/twitter/hreflang/heading/JSON-LD from D1.
 *
 * Responsibilities kept here are only Cloudflare-specific ones (request gating, D1,
 * HTMLRewriter, status/headers). All decisions live in `./workflowMeta.ts`, which is
 * pure and unit-tested by `node functions/workflowMeta.test.mjs`.
 *
 * Failure policy: the middleware must never break the page. Any unexpected error falls
 * back to the unmodified response (`next()` has already been awaited where possible).
 */
import type { Env } from "./api/auth";
import type {
  AlternateLink,
  WorkflowMetaRow,
  WorkflowResolvedDecision,
} from "./workflowMeta";
import {
  buildWorkflowMetadata,
  canonicalHref,
  escapeHtmlAttribute,
  matchWorkflowDetailPath,
} from "./workflowMeta";

/** One D1 round-trip: exactly the columns the metadata decision needs. */
const WORKFLOW_META_QUERY =
  "SELECT id, filename, description, is_private, author_data, tags FROM yaml_files WHERE id = ?";

const ROBOTS_NOINDEX_META = '<meta name="robots" content="noindex">';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;

  // Used for the "never break the page" fallback: if we already have an untouched
  // response, prefer it over calling next() a second time.
  let response: Response | undefined;

  try {
    // Only GET navigations of the (locale-prefixed) workflow detail page are handled.
    if (request.method !== "GET") return next();

    const url = new URL(request.url);
    if (matchWorkflowDetailPath(url.pathname) === null) return next();

    const accept = request.headers.get("accept") ?? "";
    const acceptsHtml =
      accept.length === 0 || /text\/html/i.test(accept) || accept.includes("*/*");
    if (!acceptsHtml) return next();

    const rawId = url.searchParams.get("id");
    const workflowId = rawId === null ? null : rawId.trim();

    // Missing id: redirect to the locale explorer *before* touching D1.
    const missingIdDecision = buildWorkflowMetadata({
      origin: url.origin,
      pathname: url.pathname,
      workflowId,
      row: null,
    });
    if (missingIdDecision.kind === "redirect") {
      return new Response(null, {
        status: missingIdDecision.status,
        headers: {
          Location: missingIdDecision.location,
          "Cache-Control": "no-store",
        },
      });
    }

    let row: WorkflowMetaRow | null = null;
    try {
      if (workflowId !== null && workflowId.length > 0 && env.D1) {
        row =
          (await env.D1.prepare(WORKFLOW_META_QUERY)
            .bind(workflowId)
            .first<WorkflowMetaRow>()) ?? null;
      }
    } catch (error) {
      // A D1 hiccup must not take the page down: serve it unmodified.
      console.error("workflow-metadata: D1 lookup failed", error);
      return next();
    }

    const decision = buildWorkflowMetadata({
      origin: url.origin,
      pathname: url.pathname,
      workflowId,
      row,
    });

    response = await next();

    if (!response.ok) return response; // e.g. 304 Not Modified
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) return response;

    // An id is present at this point, so a redirect is impossible; guard for types.
    if (decision.kind === "redirect") return response;

    return renderWorkflowMetadata(response, decision, workflowId ?? "");
  } catch (error) {
    console.error("workflow-metadata: middleware failed", error);
    return response ?? next();
  }
};

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

    // Works for both the current <h3 id="workflowname"> and the future <h1>.
    if (meta.heading !== null) {
      const heading = meta.heading;
      rewriter.on("#workflowname", {
        element(element) {
          element.setInnerContent(heading);
        },
      });
    }

    // One normalized URL form for canonical, og:url and every hreflang alternate.
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
        // Unknown locale: keep it locale-preserving by normalizing its own href.
        const currentHref = element.getAttribute("href");
        if (currentHref === null) return;
        try {
          const alternateUrl = new URL(currentHref, meta.canonicalUrl);
          element.setAttribute(
            "href",
            canonicalHref({
              origin: alternateUrl.origin,
              pathname: alternateUrl.pathname,
              workflowId,
            }),
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
