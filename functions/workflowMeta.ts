/**
 * Pure metadata decisions for the path-style workflow detail page.
 *
 * Supported URL styles:
 *
 *     path style (canonical): /explore/workflow/<id>
 *                             /<locale>/explore/workflow/<id>
 *     legacy query style:     /explore/workflow/?id=<id>   -> 301 to path style
 *                             /<locale>/explore/workflow/?id=<id>
 *     bare page (no id):      /explore/workflow/           -> 302 to /explore
 *
 * This module intentionally has NO imports and NO Cloudflare-only globals so it can be
 * unit-tested from a plain Node process (Node 24 strips the types natively):
 *
 *     node functions/workflowMeta.test.mjs
 *
 * For the same reason only *erasable* TypeScript syntax is used here: no enums, no
 * namespaces, no parameter properties, no runtime-only TS helpers.
 *
 * Serving the static page for `/explore/workflow/<id>` (a rewrite inside the Pages
 * Function middleware) and all HTTP/header handling live in `functions/_middleware.ts`.
 */

/** Default locale: `en` is served without a URL prefix. */
export const DEFAULT_LOCALE = "en";

/** Locales supported by the site. `en` has no path prefix; the rest are `/<locale>/...`. */
export const SUPPORTED_LOCALES = [
  "en",
  "zh",
  "zh-Hant",
  "ja",
  "ko",
  "fr",
  "pt",
  "es",
  "de",
  "it",
  "ru",
  "ar",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Path (without locale prefix and without id) of the workflow detail page. */
export const WORKFLOW_DETAIL_PATH = "/explore/workflow";

/** Path (without locale prefix) of the workflow explorer page. */
export const EXPLORE_PATH = "/explore";

/** Brand name used in the document title / JSON-LD. */
export const SITE_NAME = "Diflowy";

/** Upper bound for the meta description. */
export const DESCRIPTION_MAX_LENGTH = 160;

/** Path of the dynamic per-workflow Open Graph image endpoint. */
export const SOCIAL_IMAGE_PATH = "/og/workflow.png";

/** Dimensions/type of the PNG rendered by that endpoint. */
export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;
export const SOCIAL_IMAGE_TYPE = "image/png";

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const TRAILING_SEPARATORS = /[\s,;:.!?\-–—]+$/;

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

export interface WorkflowDetailPathMatch {
  /** Canonical locale code; `""` means the unprefixed default locale (`en`). */
  locale: string;
}

export interface WorkflowDetailIdPathMatch {
  /** Canonical locale code; `""` means the unprefixed default locale (`en`). */
  locale: string;
  /** Workflow id taken from the last path segment, already URL-decoded. */
  workflowId: string;
}

/**
 * Splits an absolute pathname into segments, tolerating trailing slashes but not
 * empty segments in the middle (`/explore//workflow` is rejected by the matchers).
 */
function pathSegments(pathname: unknown): string[] | null {
  if (typeof pathname !== "string") return null;
  const trimmed = pathname.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("/")) return null;
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, "");
  if (withoutTrailingSlashes.length === 0) return [];
  return withoutTrailingSlashes.slice(1).split("/");
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Matches the *bare* workflow detail page (no id in the path), with an optional
 * trailing slash: `/explore/workflow[/]` and `/<locale>/explore/workflow[/]`.
 * Returns `null` for id-style paths, unknown locales and anything else.
 */
export function matchWorkflowDetailPath(
  pathname: string,
): WorkflowDetailPathMatch | null {
  const segments = pathSegments(pathname);
  if (segments === null) return null;
  if (segments.length === 2) {
    if (segments[0] === "explore" && segments[1] === "workflow") {
      return { locale: "" };
    }
    return null;
  }
  if (segments.length === 3 && segments[1] === "explore" && segments[2] === "workflow") {
    const locale = normalizeLocale(segments[0]);
    if (locale === null || locale === "") return null;
    return { locale };
  }
  return null;
}

/**
 * Matches the path-style workflow detail page, with an optional trailing slash:
 * `/explore/workflow/<id>[/]` and `/<locale>/explore/workflow/<id>[/]`.
 * The id is returned decoded; unknown locale prefixes and extra path segments are
 * rejected.
 */
export function matchWorkflowDetailIdPath(
  pathname: string,
): WorkflowDetailIdPathMatch | null {
  const segments = pathSegments(pathname);
  if (segments === null) return null;
  if (segments.length === 3 && segments[0] === "explore" && segments[1] === "workflow") {
    const workflowId = decodePathSegment(segments[2]);
    if (workflowId.length === 0) return null;
    return { locale: "", workflowId };
  }
  if (
    segments.length === 4 &&
    segments[1] === "explore" &&
    segments[2] === "workflow"
  ) {
    const locale = normalizeLocale(segments[0]);
    if (locale === null || locale === "") return null;
    const workflowId = decodePathSegment(segments[3]);
    if (workflowId.length === 0) return null;
    return { locale, workflowId };
  }
  return null;
}

/**
 * Resolves a case-insensitive locale code to its canonical spelling.
 * Returns `""` for the default locale (`en`) and `null` when unsupported/unknown.
 */
export function normalizeLocale(locale: string): string | null {
  const candidate = typeof locale === "string" ? locale.trim() : "";
  if (candidate.length === 0) return "";
  const lower = candidate.toLowerCase();
  if (lower === DEFAULT_LOCALE) return "";
  for (const supported of SUPPORTED_LOCALES) {
    if (supported.toLowerCase() === lower) return supported;
  }
  return null;
}

/** Locale-prefixed detail page path, without id and without trailing slash. */
export function workflowPathForLocale(locale: string): string {
  const normalized = normalizeLocale(locale);
  if (normalized === null || normalized === "") return WORKFLOW_DETAIL_PATH;
  return `/${normalized}${WORKFLOW_DETAIL_PATH}`;
}

/**
 * Locale-prefixed *static page* path used by the middleware rewrite. The trailing
 * slash is what Cloudflare Pages serves with 200 for the Astro directory index.
 */
export function workflowStaticPagePathForLocale(locale: string): string {
  return `${workflowPathForLocale(locale)}/`;
}

/** Locale-prefixed path of the explore page (`en` -> unprefixed path). */
export function explorePathForLocale(locale: string): string {
  const normalized = normalizeLocale(locale);
  if (normalized === null || normalized === "") return EXPLORE_PATH;
  return `/${normalized}${EXPLORE_PATH}`;
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

export interface WorkflowDetailHrefInput {
  /** Request origin, e.g. `https://diflowy.greenerai.top`. */
  origin: string;
  /** Workflow detail page locale; `""`/`en` means the unprefixed form. */
  locale: string;
  /** Raw workflow id (will be URL-encoded once). */
  workflowId: string;
}

/**
 * The one and only canonical form of a path-style workflow detail URL:
 *
 *     <origin>/<locale?>/explore/workflow/<encodeURIComponent(id)>
 *
 * No trailing slash and no query string. Used for `<link rel=canonical>`, `og:url`,
 * JSON-LD `url`, every hreflang alternate, and as the target of the legacy `?id=`
 * 301 redirect.
 */
export function workflowDetailHref(input: WorkflowDetailHrefInput): string {
  const origin = String(input.origin ?? "").replace(/\/+$/, "");
  const path = workflowPathForLocale(input.locale);
  return `${origin}${path}/${encodeURIComponent(String(input.workflowId ?? ""))}`;
}

export interface WorkflowSocialImageHrefInput {
  /** Request origin, e.g. `https://diflowy.greenerai.top`. */
  origin: string;
  /** Raw workflow id (will be URL-encoded exactly once). */
  workflowId: string;
  /**
   * Page locale; adds a `&lang=` hint for the card renderer (satori's Han detection
   * defaults to zh-CN, so ja/ko/zh-Hant text can render as tofu without it).
   * The unprefixed default locale (`en`/`""`) is omitted — Latin cards auto-detect.
   */
  locale?: string;
}

/**
 * Per-workflow Open Graph image URL:
 *
 *     <origin>/og/workflow.png?id=<encodeURIComponent(id)>
 *     <origin>/og/workflow.png?id=<encodeURIComponent(id)>&lang=<locale>   (non-en)
 *
 * Served by `functions/og/[[path]].ts` as a 1200x630 PNG. The id is encoded the same
 * way as in the canonical URL, so the card always depicts the same workflow the page
 * canonicalises to. When setting this in an HTML attribute it must go through
 * `escapeHtmlAttribute()` so the raw markup carries `&amp;lang=`.
 */
export function workflowSocialImageHref(
  input: WorkflowSocialImageHrefInput,
): string {
  const origin = String(input.origin ?? "").replace(/\/+$/, "");
  const rawLocale = typeof input.locale === "string" ? input.locale.trim() : "";
  const locale = normalizeLocale(rawLocale) ?? rawLocale;
  const langHint = locale.length > 0 ? `&lang=${encodeURIComponent(locale)}` : "";
  return `${origin}${SOCIAL_IMAGE_PATH}?id=${encodeURIComponent(
    String(input.workflowId ?? ""),
  )}${langHint}`;
}

export interface AlternateLink {
  hreflang: string;
  href: string;
}

/**
 * Builds path-style canonical-with-id hrefs for all 12 supported locales
 * (locale-preserving). The `hreflang` values match the ones generated by
 * `astro-i18next`'s `HeadHrefLangs`.
 */
export function buildAlternateLinks(input: {
  origin: string;
  workflowId: string;
}): AlternateLink[] {
  return SUPPORTED_LOCALES.map((locale) => ({
    hreflang: locale,
    href: workflowDetailHref({
      origin: input.origin,
      locale,
      workflowId: input.workflowId,
    }),
  }));
}

/** Locale explorer redirect (302) target for requests without any workflow id. */
export function missingWorkflowIdRedirect(input: {
  locale: string;
}): { kind: "redirect"; status: 302; locale: string; location: string } {
  const locale = normalizeLocale(input.locale) ?? "";
  return {
    kind: "redirect",
    status: 302,
    locale,
    location: explorePathForLocale(locale),
  };
}

/**
 * Permanent (301) redirect target for the legacy query-string style URL:
 * `/explore/workflow/?id=<id>` -> `/explore/workflow/<id>` (locale-preserving).
 * No D1 lookup is needed to build it.
 */
export function legacyQueryRedirect(input: {
  origin: string;
  pathname: string;
  workflowId: string;
}): { kind: "redirect"; status: 301; locale: string; location: string } {
  const match =
    matchWorkflowDetailPath(input.pathname) ??
    matchWorkflowDetailIdPath(input.pathname);
  const locale = match === null ? "" : match.locale;
  return {
    kind: "redirect",
    status: 301,
    locale,
    location: workflowDetailHref({
      origin: input.origin,
      locale,
      workflowId: input.workflowId,
    }),
  };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Collapses control characters / newlines / runs of whitespace into single spaces. */
export function toPlainText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value)
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/**
 * Truncates text to roughly `maxLength` characters on a word boundary.
 * The result is at most `maxLength + 1` characters (the ellipsis).
 */
export function truncateText(
  value: unknown,
  maxLength: number = DESCRIPTION_MAX_LENGTH,
): string {
  const text = toPlainText(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  let cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  cut = cut.replace(TRAILING_SEPARATORS, "");
  if (cut.length === 0) cut = slice;
  return `${cut}…`;
}

/**
 * Escapes a plain-text value for use inside an HTML *attribute* value.
 *
 * `HTMLRewriter.setAttribute` only escapes `"` (quotes) and leaves `&`, `<` and `>`
 * raw inside quoted attribute values (valid HTML, but raw markup ends up in the
 * Open Graph and Twitter meta tags). Pre-escaping `&`, `<` and `>` — but
 * deliberately NOT `"`/`'`, which HTMLRewriter escapes itself — keeps the serialized
 * attribute strictly escaped and still round-trips to the original text in the
 * browser.
 */
export function escapeHtmlAttribute(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Serializes a JSON-LD object into a string that is safe to inline inside
 * `<script type="application/ld+json">`: `<`, `>`, `&` and U+2028/U+2029 are
 * escaped so the payload can never terminate the script element.
 */
export function serializeJsonLd(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof json !== "string") return "";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  const text = raw.trim();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseAuthor(
  raw: unknown,
): { "@type": "Person"; name: string; url?: string } | null {
  const data = parseJsonValue(raw);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const name = toPlainText(
    record.authorName ?? record.name ?? record.username,
  );
  if (name.length === 0) return null;
  const author: { "@type": "Person"; name: string; url?: string } = {
    "@type": "Person",
    name,
  };
  const socialLink = toPlainText(record.socialLink ?? record.social_link ?? "");
  if (socialLink.length > 0) author.url = socialLink;
  return author;
}

function parseKeywords(raw: unknown): string[] {
  const data = parseJsonValue(raw);
  if (!Array.isArray(data)) return [];
  const keywords: string[] = [];
  for (const entry of data) {
    if (typeof entry !== "string") continue;
    const keyword = toPlainText(entry);
    if (keyword.length > 0) keywords.push(keyword);
    if (keywords.length >= 12) break;
  }
  return keywords;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

// ---------------------------------------------------------------------------
// Decision building
// ---------------------------------------------------------------------------

/** The subset of `yaml_files` columns the middleware reads (plus optional dates). */
export interface WorkflowMetaRow {
  id?: string | null;
  filename?: string | null;
  description?: string | null;
  is_private?: number | string | boolean | null;
  author_data?: string | null;
  tags?: string | null;
  /** Not selected by default; used for schema.org `dateModified` when available. */
  update_time?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface WorkflowMetadataInput {
  origin: string;
  pathname: string;
  /** Legacy `id` query-string value (`?id=`) — triggers a 301 to the path form. */
  queryWorkflowId?: string | null;
  /** Workflow id already resolved from the path's last segment (optional override). */
  pathWorkflowId?: string | null;
  /** D1 row, or `null` when the id is unknown. */
  row?: WorkflowMetaRow | null;
}

export interface WorkflowRedirectDecision {
  kind: "redirect";
  status: 301 | 302;
  locale: string;
  /** Absolute URL for the 301 path-style form, or a path for the 302 explorer redirect. */
  location: string;
}

export interface WorkflowNotFoundDecision {
  kind: "notFound";
  status: 404;
  locale: string;
  indexable: false;
  robots: "noindex";
}

export interface WorkflowMetadataDecision {
  kind: "metadata";
  status: 200;
  locale: string;
  indexable: boolean;
  robots: "noindex" | null;
  /** Path-style canonical URL (`.../explore/workflow/<encoded id>`). */
  canonicalUrl: string;
  /** Per-workflow Open Graph image URL; `null` keeps the site-wide og.jpg. */
  socialImageUrl: string | null;
  /** Alt text for og:image / twitter:image (public rows only). */
  socialImageAlt: string | null;
  alternates: AlternateLink[];
  /** New `<title>` inner text, or `null` to leave the static page untouched. */
  title: string | null;
  /** Meta description for og/twitter/description, or `null` to leave untouched. */
  description: string | null;
  /** New `#workflowname` inner text (works for both `<h1>` and `<h3>`). */
  heading: string | null;
  /** Pre-escaped JSON-LD payload (without the surrounding `<script>` tag). */
  jsonLd: string | null;
}

export type WorkflowMetadataResult =
  | WorkflowRedirectDecision
  | WorkflowNotFoundDecision
  | WorkflowMetadataDecision;

/** Decisions a page response can be rendered with (a resolved page never redirects). */
export type WorkflowResolvedDecision =
  | WorkflowNotFoundDecision
  | WorkflowMetadataDecision;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPrivateRow(row: WorkflowMetaRow): boolean {
  const value = row.is_private;
  return value === true || value === 1 || value === "1";
}

/**
 * Decides what the edge should do with a workflow detail request.
 *
 * - path style `/explore/workflow/<id>`      -> metadata / notFound / private noindex
 * - legacy `?id=` (no path id)               -> 301 to the path style form (no D1)
 * - bare page `/explore/workflow/` (no id)   -> 302 to the locale explorer
 *
 * `row === null` means D1 had no such id (unknown id -> 404 noindex page).
 * A private row is served with 200 + noindex and never leaks name/description.
 */
export function buildWorkflowMetadata(
  input: WorkflowMetadataInput,
): WorkflowMetadataResult {
  const idMatch = matchWorkflowDetailIdPath(input.pathname);
  const pageMatch =
    idMatch === null ? matchWorkflowDetailPath(input.pathname) : null;
  const locale =
    idMatch !== null ? idMatch.locale : pageMatch !== null ? pageMatch.locale : "";

  if (idMatch === null) {
    // Legacy query style: permanent redirect to the path form, no D1 lookup needed.
    const queryWorkflowId = normalizeId(input.queryWorkflowId);
    if (queryWorkflowId.length > 0) {
      return legacyQueryRedirect({
        origin: input.origin,
        pathname: input.pathname,
        workflowId: queryWorkflowId,
      });
    }
    // No id at all (or an unrecognised path): back to the locale explorer.
    return missingWorkflowIdRedirect({ locale });
  }

  // The path id wins over any stray ?id= value (never redirect an id-style URL).
  const workflowId = normalizeId(input.pathWorkflowId) || idMatch.workflowId;
  if (workflowId.length === 0) return missingWorkflowIdRedirect({ locale });

  const row = input.row ?? null;
  const rowId =
    row === null || row.id === null || row.id === undefined
      ? ""
      : String(row.id).trim();
  if (row === null || rowId.length === 0) {
    return {
      kind: "notFound",
      status: 404,
      locale,
      indexable: false,
      robots: "noindex",
    };
  }

  // URL identity is never sensitive: it only repeats the id that is already in the
  // request URL. Name/description are only emitted for public rows below.
  const canonicalUrl = workflowDetailHref({
    origin: input.origin,
    locale,
    workflowId,
  });
  const alternates = buildAlternateLinks({
    origin: input.origin,
    workflowId,
  });

  if (isPrivateRow(row)) {
    return {
      kind: "metadata",
      status: 200,
      locale,
      indexable: false,
      robots: "noindex",
      canonicalUrl,
      socialImageUrl: null,
      socialImageAlt: null,
      alternates,
      title: null,
      description: null,
      heading: null,
      jsonLd: null,
    };
  }

  const name = toPlainText(row.filename) || "Workflow";
  const description = truncateText(row.description) || null;
  const jsonLd = serializeJsonLd(
    buildJsonLd({ name, description, canonicalUrl, locale, row }),
  );

  return {
    kind: "metadata",
    status: 200,
    locale,
    indexable: true,
    robots: null,
    canonicalUrl,
    socialImageUrl: workflowSocialImageHref({
      origin: input.origin,
      workflowId,
      locale,
    }),
    socialImageAlt: `${name} | ${SITE_NAME}`,
    alternates,
    title: `${name} | ${SITE_NAME}`,
    description,
    heading: name,
    jsonLd,
  };
}

function buildJsonLd(input: {
  name: string;
  description: string | null;
  canonicalUrl: string;
  locale: string;
  row: WorkflowMetaRow;
}): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: input.name,
    url: input.canonicalUrl,
    inLanguage: input.locale.length > 0 ? input.locale : DEFAULT_LOCALE,
  };
  if (input.description) jsonLd.description = input.description;
  const author = parseAuthor(input.row.author_data);
  if (author !== null) jsonLd.author = author;
  const keywords = parseKeywords(input.row.tags);
  if (keywords.length > 0) jsonLd.keywords = keywords.join(", ");
  const dateModified = firstNonEmptyString(
    input.row.update_time,
    input.row.updated_at,
    input.row.created_at,
  );
  if (dateModified.length > 0) jsonLd.dateModified = dateModified;
  return jsonLd;
}
