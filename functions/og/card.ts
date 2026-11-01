/**
 * Pure helpers for the dynamic per-workflow Open Graph image.
 *
 * Kept free of Workers-only APIs and of satori/resvg so that the decision logic
 * (public/private gating, text sanitising, truncation) can be reasoned about in
 * isolation — mirroring the `functions/workflowMeta.ts` split used by the page
 * middleware. `functions/og/[[path]].ts` does the D1 lookup, font loading and
 * PNG rendering and only ever calls into this module.
 *
 * Security invariant: this module never decides that a row is renderable. The
 * caller must only pass data here for rows that are explicitly public; private
 * rows must be mapped to the generic card data in `[[path]].ts`.
 */

/** Rendered image size. Open Graph/Twitter large-image ratio. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Cache policy for cards built from D1 data (public row, or a confirmed
 * private/unknown id). The response only depends on the `id` query parameter,
 * which is already part of the CDN cache key, so no `Vary` is needed: the card
 * is identical for every viewer of the same URL and never depends on cookies,
 * auth or Accept-Language.
 */
export const OG_CACHE_CONTROL = "public, max-age=3600";

/**
 * Shorter TTL used when the card is generic because of a transient failure
 * (D1 error / render error) rather than because the row is private or missing.
 * A brief cache keeps a DB hiccup from pinning the generic card for an hour.
 */
export const OG_ERROR_CACHE_CONTROL = "public, max-age=60";

export const SITE_NAME = "Diflowy";
export const SITE_HOST = "diflowy.greenerai.top";
export const SITE_TAGLINE = "Explore, Share, Host Dify Workflows";

/** Max characters kept per text line (code points, once whitespace is collapsed). */
export const NAME_MAX_CHARS = 60;
export const DESCRIPTION_MAX_CHARS = 110;
export const AUTHOR_MAX_CHARS = 40;
export const TAG_MAX_CHARS = 18;
export const TAGS_MAX_COUNT = 3;

/** The subset of a `yaml_files` row that the OG card needs. */
export type WorkflowOgRow = {
  id: string;
  filename: string | null;
  description: string | null;
  is_private: number | string | boolean | null;
  author_data: string | null;
  tags: string | null;
};

/** Values ready to be laid out on a card. */
export type WorkflowCardData = {
  name: string;
  description: string;
  author: string;
  tags: string[];
  /** Explicit satori fallback-font language (see detectCardLanguage). */
  language?: string;
};

/** A satori element (what JSX compiles to): `{ type, props }`. */
export type SatoriElement = {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: unknown;
    /** satori fallback-font hint (e.g. "zh-CN"); see detectCardLanguage. */
    lang?: string;
  };
};

/**
 * Public-row test. Only an explicit "public" value renders workflow data;
 * anything unexpected (NULL, 1, "1", true, garbage) is treated as private so a
 * schema change can never turn this endpoint into a leak.
 */
export function isPublicWorkflowRow(row: WorkflowOgRow | null | undefined): boolean {
  if (!row) return false;
  const raw = row.is_private;
  return raw === 0 || raw === false || raw === "0";
}

/** Control/format characters that must not reach satori or the PNG output. */
const UNSAFE_TEXT_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u206f\ufeff]/g;

/**
 * Collapses whitespace, strips control/bidi characters and truncates to
 * `maxChars` code points with an ellipsis. Text is plain text (satori draws it,
 * it is never parsed as HTML), so no HTML escaping is required here; the only
 * goal is deterministic, layout-safe output for hostile names like `</script>`.
 */
export function sanitizeCardText(value: unknown, maxChars: number): string {
  if (typeof value !== "string" || maxChars <= 0) return "";
  const cleaned = value.replace(UNSAFE_TEXT_CHARS, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(cleaned);
  if (chars.length <= maxChars) return cleaned;
  return chars.slice(0, maxChars - 1).join("").trimEnd() + "\u2026";
}

/** Extracts the display author name from the `author_data` JSON blob. */
export function parseAuthorName(authorData: unknown): string {
  if (typeof authorData !== "string" || authorData.length === 0) return "";
  try {
    const parsed: unknown = JSON.parse(authorData);
    if (typeof parsed !== "object" || parsed === null) return "";
    const candidate = (parsed as { authorName?: unknown }).authorName;
    return sanitizeCardText(candidate, AUTHOR_MAX_CHARS);
  } catch {
    return "";
  }
}

/** Extracts the first few tag labels from the `tags` JSON blob. */
export function parseTags(tags: unknown, limit: number = TAGS_MAX_COUNT): string[] {
  if (typeof tags !== "string" || tags.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(tags);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const tag of parsed) {
      const label = sanitizeCardText(tag, TAG_MAX_CHARS);
      if (label.length > 0 && !out.includes(label)) out.push(label);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Languages satori/@vercel/og can load fallback fonts for. */
const FALLBACK_LANGUAGES: Readonly<Record<string, string>> = {
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
  "zh-hans": "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hant": "zh-TW",
  "zh-tw": "zh-TW",
  "zh-hk": "zh-HK",
};

const KANA_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/u;
const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af]/u;
const HAN_PATTERN = /\p{scx=Han}/u;

/**
 * Maps a locale-ish hint (`?lang=`, e.g. the page locale) to a fallback-font
 * language satori understands. Unknown values are ignored (auto-detect applies).
 */
export function normalizeCardLanguage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase().slice(0, 20);
  if (value.length === 0) return undefined;
  return FALLBACK_LANGUAGES[value] ?? FALLBACK_LANGUAGES[value.split("-")[0]];
}

/**
 * satori's own language detection gives Han script priority to ja-JP (its
 * Japanese regex includes Han before the Chinese one), which makes simplified
 * Chinese text load the Japanese Noto Sans JP fallback and render boxes for
 * simplified-only characters. Passing an explicit `lang` to the text element
 * fixes that. Han without kana/hangul is treated as zh-CN; the caller can
 * override it from the page locale (e.g. zh-Hant -> zh-TW) via `?lang=`.
 */
export function detectCardLanguage(text: string, override?: string): string | undefined {
  if (override) return override;
  if (KANA_PATTERN.test(text)) return "ja-JP";
  if (HANGUL_PATTERN.test(text)) return "ko-KR";
  if (HAN_PATTERN.test(text)) return "zh-CN";
  return undefined;
}

/** Builds the display data for a row that is already known to be public. */
export function buildWorkflowCardData(
  row: WorkflowOgRow,
  languageOverride?: string,
): WorkflowCardData {
  const name = sanitizeCardText(row.filename, NAME_MAX_CHARS);
  const finalName = name.length > 0 ? name : "Untitled workflow";
  const description = sanitizeCardText(row.description, DESCRIPTION_MAX_CHARS);
  const author = parseAuthorName(row.author_data);
  const tags = parseTags(row.tags);
  const language =
    detectCardLanguage(`${finalName} ${description} ${author} ${tags.join(" ")}`, languageOverride) ??
    undefined;
  return {
    // A nameless public workflow still gets a workflow card, just a neutral title.
    name: finalName,
    description,
    author,
    tags,
    language,
  };
}

/** The generic card data used for private rows, unknown ids and all failures. */
export function buildGenericCardData(): WorkflowCardData {
  return {
    name: SITE_TAGLINE,
    description: "Discover and share community Dify workflows.",
    author: SITE_NAME,
    tags: [],
  };
}

function element(
  type: string,
  style: Record<string, string | number>,
  children?: unknown,
  lang?: string,
): SatoriElement {
  const props: SatoriElement["props"] = { style };
  if (children !== undefined) props.children = children;
  if (lang) props.lang = lang;
  return { type, props };
}

/** Drops empty children so satori never receives null/false nodes. */
function children(...nodes: unknown[]): unknown[] {
  return nodes.filter(
    (node) => node !== null && node !== undefined && node !== false && node !== "",
  );
}

/** Shared blue gradient background matching the site's existing OG artwork. */
const CARD_BACKGROUND = "linear-gradient(135deg, #0a46c4 0%, #1f7bff 52%, #74c4ff 100%)";
const TEXT_WHITE = "#ffffff";
const TEXT_SOFT = "rgba(255,255,255,0.86)";
const TEXT_FAINT = "rgba(255,255,255,0.68)";

function headerRow(badge: string): SatoriElement {
  return element(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
    },
    children(
      element(
        "div",
        { display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" },
        SITE_NAME,
      ),
      element(
        "div",
        {
          display: "flex",
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: "0.12em",
          padding: "10px 20px",
          borderRadius: 999,
          border: "2px solid rgba(255,255,255,0.45)",
          color: TEXT_SOFT,
        },
        badge,
      ),
    ),
  );
}

function footerRow(left: string): SatoriElement {
  const hasLeft = left.length > 0;
  return element(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: hasLeft ? "space-between" : "flex-end",
      width: "100%",
      fontSize: 22,
      color: TEXT_FAINT,
    },
    children(
      hasLeft ? element("div", { display: "flex" }, left, detectCardLanguage(left)) : null,
      element("div", { display: "flex" }, SITE_HOST),
    ),
  );
}

/**
 * Public-workflow card: brand, workflow name, one short description line and
 * the author, all on the site's blue gradient.
 */
export function buildWorkflowCard(data: WorkflowCardData): SatoriElement {
  // Long names get a slightly smaller size so two lines stay within the card.
  const nameFontSize = data.name.length > 42 ? 54 : 66;
  const nameLines = data.name.length > 42 ? 3 : 2;

  const name = element(
    "div",
    {
      display: "flex",
      fontSize: nameFontSize,
      fontWeight: 700,
      lineHeight: 1.12,
      letterSpacing: "-0.02em",
      color: TEXT_WHITE,
      marginTop: 18,
      maxHeight: Math.ceil(nameLines * nameFontSize * 1.12),
      overflow: "hidden",
    },
    data.name,
    data.language,
  );

  const description =
    data.description.length > 0
      ? element(
          "div",
          {
            display: "flex",
            fontSize: 27,
            fontWeight: 400,
            lineHeight: 1.4,
            color: TEXT_SOFT,
            marginTop: 22,
            maxHeight: Math.ceil(2 * 27 * 1.4),
            overflow: "hidden",
          },
          data.description,
          data.language,
        )
      : null;

  const tagPills = data.tags.length
    ? element(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          width: "100%",
          marginTop: 26,
        },
        data.tags.map((tag) =>
          element(
            "div",
            {
              display: "flex",
              fontSize: 20,
              fontWeight: 500,
              color: TEXT_WHITE,
              backgroundColor: "rgba(255,255,255,0.18)",
              padding: "8px 18px",
              borderRadius: 999,
              marginRight: 12,
            },
            `#${tag}`,
            detectCardLanguage(tag),
          ),
        ),
      )
    : null;

  return element(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: OG_WIDTH,
      height: OG_HEIGHT,
      background: CARD_BACKGROUND,
      color: TEXT_WHITE,
      fontFamily: "Inter",
      padding: "56px 64px",
    },
    children(
      headerRow("DIFY WORKFLOW"),
      element(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          flexGrow: 1,
          justifyContent: "center",
          paddingTop: 12,
          paddingBottom: 12,
        },
        children(
          element(
            "div",
            {
              display: "flex",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: TEXT_FAINT,
            },
            "WORKFLOW",
          ),
          name,
          description,
          tagPills,
        ),
      ),
      footerRow(data.author.length > 0 ? `by ${data.author}` : "diflowy.greenerai.top"),
    ),
  );
}

/**
 * Generic card: brand + tagline only. Contains no workflow data, which is what
 * makes it safe to serve for private rows, unknown ids and every error path.
 */
export function buildGenericCard(): SatoriElement {
  return element(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: OG_WIDTH,
      height: OG_HEIGHT,
      background: CARD_BACKGROUND,
      color: TEXT_WHITE,
      fontFamily: "Inter",
      padding: "56px 64px",
    },
    children(
      headerRow("DIFY WORKFLOW LIBRARY"),
      element(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          flexGrow: 1,
          justifyContent: "center",
        },
        children(
          element(
            "div",
            {
              display: "flex",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: TEXT_FAINT,
              marginBottom: 20,
            },
            SITE_NAME,
          ),
          element(
            "div",
            {
              display: "flex",
              fontSize: 78,
              fontWeight: 700,
              lineHeight: 1.14,
              letterSpacing: "-0.02em",
              color: TEXT_WHITE,
              maxHeight: 280,
              overflow: "hidden",
            },
            SITE_TAGLINE,
          ),
          element(
            "div",
            {
              display: "flex",
              fontSize: 27,
              fontWeight: 400,
              lineHeight: 1.4,
              color: TEXT_SOFT,
              marginTop: 24,
            },
            "Discover and share community Dify workflows.",
          ),
        ),
      ),
      footerRow("Dify workflow library"),
    ),
  );
}
