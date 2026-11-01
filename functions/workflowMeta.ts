/**
 * Pure metadata decisions for the workflow detail page (`/explore/workflow/?id=<id>`).
 *
 * This module intentionally has NO imports and NO Cloudflare-only globals so it can be
 * unit-tested from a plain Node process (Node 24 strips the types natively):
 *
 *     node functions/workflowMeta.test.mjs
 *
 * For the same reason only *erasable* TypeScript syntax is used here: no enums, no
 * namespaces, no parameter properties, no runtime-only TS helpers.
 *
 * The edge middleware (`functions/_middleware.ts`) is responsible for D1/HTTP concerns;
 * everything that can be decided without I/O lives in this file so it is testable.
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

/** Path (without locale prefix) of the workflow detail page. */
export const WORKFLOW_DETAIL_PATH = "/explore/workflow";

/** Path (without locale prefix) of the workflow explorer page. */
export const EXPLORE_PATH = "/explore";

/** Brand name used in the document title / JSON-LD. */
export const SITE_NAME = "Diflowy";

/** Upper bound for the meta description. */
export const DESCRIPTION_MAX_LENGTH = 160;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const TRAILING_SEPARATORS = /[\s,;:.!?\-–—]+$/;

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

export interface WorkflowDetailPathMatch {
  /** Canonical locale code; `""` means the unprefixed default locale (`en`). */
  locale: string;
}

/**
 * Matches `/explore/workflow` and `/<locale>/explore/workflow` (optional trailing slash)
 * for every supported locale. Returns `null` for anything else.
 */
export function matchWorkflowDetailPath(
  pathname: string,
): WorkflowDetailPathMatch | null {
  if (typeof pathname !== "string" || pathname.length === 0) return null;
  // Only trailing slashes are tolerated; every other segment must match exactly.
  const path = pathname.trim().replace(/\/+$/, "");
  if (path === WORKFLOW_DETAIL_PATH) return { locale: "" };

  const match = /^\/([^/]+)\/explore\/workflow$/.exec(path);
  if (match === null) return null;
  const locale = normalizeLocale(match[1]);
  if (locale === null || locale === "") return null;
  return { locale };
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

/** Locale-prefixed path of the workflow detail page (`en` -> unprefixed path). */
export function workflowPathForLocale(locale: string): string {
  const normalized = normalizeLocale(locale);
  if (normalized === null || normalized === "") return WORKFLOW_DETAIL_PATH;
  return `/${normalized}${WORKFLOW_DETAIL_PATH}`;
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

export interface CanonicalHrefInput {
  /** Request origin, e.g. `https://diflowy.greenerai.top`. */
  origin: string;
  /** Request pathname, e.g. `/zh/explore/workflow/`. */
  pathname: string;
  /** Raw workflow id (will be URL-encoded). */
  workflowId: string;
}

/**
 * The one and only canonical form of a workflow detail URL:
 *
 *     <origin>/<locale?>/explore/workflow/?id=<encodeURIComponent(id)>
 *
 * The trailing slash is deliberate: it is the URL Cloudflare Pages serves with 200
 * (the slashless form is 308-redirected to it), so canonical, og:url and every
 * hreflang alternate never name a redirecting URL. It is used for
 * `<link rel=canonical>`, `og:url` and every hreflang alternate href.
 */
export function canonicalHref(input: CanonicalHrefInput): string {
  const origin = String(input.origin ?? "").replace(/\/+$/, "");
  const pathname = normalizePathname(input.pathname);
  return `${origin}${pathname}?id=${encodeURIComponent(String(input.workflowId ?? ""))}`;
}

/** Normalizes to an absolute path with exactly one trailing slash (the served form). */
function normalizePathname(pathname: string): string {
  let path = String(pathname ?? "/").trim();
  if (!path.startsWith("/")) path = `/${path}`;
  return `${path.replace(/\/+$/, "")}/`;
}

export interface AlternateLink {
  hreflang: string;
  href: string;
}

/**
 * Builds canonical-with-id hrefs for all 12 supported locales (locale-preserving).
 * The `hreflang` values match the ones generated by `astro-i18next`'s `HeadHrefLangs`.
 */
export function buildAlternateLinks(input: {
  origin: string;
  workflowId: string;
}): AlternateLink[] {
  return SUPPORTED_LOCALES.map((locale) => ({
    hreflang: locale,
    href: canonicalHref({
      origin: input.origin,
      pathname: workflowPathForLocale(locale),
      workflowId: input.workflowId,
    }),
  }));
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
  /** `id` query-string value; missing/blank means redirect to the explorer. */
  workflowId?: string | null;
  /** D1 row, or `null` when the id is unknown. */
  row?: WorkflowMetaRow | null;
}

export interface WorkflowRedirectDecision {
  kind: "redirect";
  status: 302;
  locale: string;
  /** Locale explorer path, e.g. `/explore` or `/zh/explore`. */
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
  canonicalUrl: string;
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

/** Decisions a page response can be rendered with (a request with an id can't redirect). */
export type WorkflowResolvedDecision =
  | WorkflowNotFoundDecision
  | WorkflowMetadataDecision;

function isPrivateRow(row: WorkflowMetaRow): boolean {
  const value = row.is_private;
  return value === true || value === 1 || value === "1";
}

/**
 * Decides what the edge should do with a workflow detail request.
 *
 * - missing/blank `id`        -> 302 to the locale's `/explore` page
 * - `row === null`            -> 404 (unknown id), page is still served but noindexed
 * - `is_private === 1`        -> 200 + noindex, no name/description injected (no leak)
 * - public row                -> 200 + full metadata (title/canonical/og/twitter/hreflang/h1/JSON-LD)
 */
export function buildWorkflowMetadata(
  input: WorkflowMetadataInput,
): WorkflowMetadataResult {
  const match = matchWorkflowDetailPath(input.pathname);
  const locale = match === null ? "" : match.locale;
  const workflowId =
    typeof input.workflowId === "string" ? input.workflowId.trim() : "";

  if (workflowId.length === 0) {
    return {
      kind: "redirect",
      status: 302,
      locale,
      location: explorePathForLocale(locale),
    };
  }

  const row = input.row ?? null;
  const rowId = row === null || row.id === null || row.id === undefined
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
  const canonicalUrl = canonicalHref({
    origin: input.origin,
    pathname: input.pathname,
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
