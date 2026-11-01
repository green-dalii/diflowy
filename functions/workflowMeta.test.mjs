/**
 * Node-native tests for the pure workflow metadata decisions.
 *
 * Run with:  node functions/workflowMeta.test.mjs
 * (Node 24 strips the TS types of `workflowMeta.ts` natively — no build step needed.)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LOCALE,
  DESCRIPTION_MAX_LENGTH,
  SITE_NAME,
  SUPPORTED_LOCALES,
  WORKFLOW_DETAIL_PATH,
  buildAlternateLinks,
  buildWorkflowMetadata,
  canonicalHref,
  escapeHtmlAttribute,
  explorePathForLocale,
  matchWorkflowDetailPath,
  normalizeLocale,
  serializeJsonLd,
  toPlainText,
  truncateText,
  workflowPathForLocale,
} from "./workflowMeta.ts";

const ORIGIN = "https://diflowy.greenerai.top";
const WORKFLOW_ID = "0f3a6e0e-1a2b-4c3d-9e8f-1234567890ab";
const ENCODED_ID = encodeURIComponent(WORKFLOW_ID);

const PUBLIC_ROW = {
  id: WORKFLOW_ID,
  filename: "My RAG Workflow",
  description: "A public workflow that answers questions over your own documents.",
  is_private: 0,
  author_data: JSON.stringify({
    authorName: "Alice",
    socialLink: "https://example.com/alice",
  }),
  tags: JSON.stringify(["rag", "documents"]),
};

/** Locale-prefixed detail path, `en` -> unprefixed (route form, no canonical slash). */
function detailPathFor(locale) {
  return locale === "en" ? WORKFLOW_DETAIL_PATH : `/${locale}${WORKFLOW_DETAIL_PATH}`;
}

/** Served (200) detail path: canonical/og:url/alternates always end with "/". */
function servedPathFor(locale) {
  return `${detailPathFor(locale)}/`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicDecision(overrides = {}) {
  return buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: `${WORKFLOW_DETAIL_PATH}/`,
    workflowId: WORKFLOW_ID,
    row: PUBLIC_ROW,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

test("matchWorkflowDetailPath: default locale, with and without trailing slash", () => {
  assert.deepEqual(matchWorkflowDetailPath("/explore/workflow"), { locale: "" });
  assert.deepEqual(matchWorkflowDetailPath("/explore/workflow/"), { locale: "" });
  assert.deepEqual(matchWorkflowDetailPath("/explore/workflow///"), { locale: "" });
});

test("matchWorkflowDetailPath: every supported locale path", () => {
  const locales = [...SUPPORTED_LOCALES];
  assert.equal(locales.length, 12);
  assert.equal(locales[DEFAULT_LOCALE === "en" ? 0 : -1], "en");

  for (const locale of locales) {
    if (locale === "en") continue;
    assert.deepEqual(
      matchWorkflowDetailPath(`/${locale}/explore/workflow`),
      { locale },
      `prefixed path for ${locale}`,
    );
    assert.deepEqual(
      matchWorkflowDetailPath(`/${locale}/explore/workflow/`),
      { locale },
      `prefixed path with trailing slash for ${locale}`,
    );
  }
});

test("matchWorkflowDetailPath: rejects non-detail paths", () => {
  const rejected = [
    "/",
    "",
    "/explore",
    "/explore/",
    "/explore/workflow/extra",
    "/explore/workflowing",
    "/zh/explore",
    "/en/explore/workflow",
    "/xx/explore/workflow",
    "/api/workflow",
    "/api/workflow/download/abc",
    "/explore/index",
    "/explore//workflow",
  ];
  for (const pathname of rejected) {
    assert.equal(matchWorkflowDetailPath(pathname), null, `should reject ${pathname}`);
  }
});

test("locale helpers normalize case and fall back to the default locale", () => {
  assert.equal(normalizeLocale("en"), "");
  assert.equal(normalizeLocale("EN"), "");
  assert.equal(normalizeLocale(""), "");
  assert.equal(normalizeLocale("zh-hant"), "zh-Hant");
  assert.equal(normalizeLocale("ZH"), "zh");
  assert.equal(normalizeLocale("xx"), null);
  assert.equal(workflowPathForLocale("en"), "/explore/workflow");
  assert.equal(workflowPathForLocale("zh-Hant"), "/zh-Hant/explore/workflow");
  assert.equal(explorePathForLocale("en"), "/explore");
  assert.equal(explorePathForLocale("ja"), "/ja/explore");
});

// ---------------------------------------------------------------------------
// Missing id -> redirect
// ---------------------------------------------------------------------------

test("missing id redirects to the locale explorer page", () => {
  for (const [pathname, location] of [
    ["/explore/workflow", "/explore"],
    ["/explore/workflow/", "/explore"],
    ["/zh/explore/workflow/", "/zh/explore"],
    ["/zh-Hant/explore/workflow", "/zh-Hant/explore"],
    ["/ja/explore/workflow/", "/ja/explore"],
    ["/ko/explore/workflow/", "/ko/explore"],
    ["/fr/explore/workflow/", "/fr/explore"],
    ["/pt/explore/workflow/", "/pt/explore"],
    ["/es/explore/workflow/", "/es/explore"],
    ["/de/explore/workflow/", "/de/explore"],
    ["/it/explore/workflow/", "/it/explore"],
    ["/ru/explore/workflow/", "/ru/explore"],
    ["/ar/explore/workflow/", "/ar/explore"],
  ]) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname,
      workflowId: null,
      row: null,
    });
    assert.equal(decision.kind, "redirect", pathname);
    assert.equal(decision.status, 302, pathname);
    assert.equal(decision.location, location, pathname);
    assert.equal(decision.locale, matchWorkflowDetailPath(pathname).locale, pathname);
  }
});

test("blank id is treated as missing (redirect, no DB row needed)", () => {
  for (const workflowId of [null, undefined, "", "   "]) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname: "/zh/explore/workflow/",
      workflowId,
      row: null,
    });
    assert.equal(decision.kind, "redirect");
    assert.equal(decision.location, "/zh/explore");
  }
});

// ---------------------------------------------------------------------------
// Unknown id -> 404 + noindex
// ---------------------------------------------------------------------------

test("unknown id yields a 404 noindex decision", () => {
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: "does-not-exist",
    row: null,
  });
  assert.equal(decision.kind, "notFound");
  assert.equal(decision.status, 404);
  assert.equal(decision.locale, "");
  assert.equal(decision.indexable, false);
  assert.equal(decision.robots, "noindex");
});

// ---------------------------------------------------------------------------
// Public row -> full metadata
// ---------------------------------------------------------------------------

test("public row injects title, canonical, alternates, heading and JSON-LD", () => {
  const decision = publicDecision();

  assert.equal(decision.kind, "metadata");
  assert.equal(decision.status, 200);
  assert.equal(decision.indexable, true);
  assert.equal(decision.robots, null);
  assert.equal(decision.locale, "");
  assert.equal(decision.title, `My RAG Workflow | ${SITE_NAME}`);
  assert.equal(decision.heading, "My RAG Workflow");
  assert.equal(decision.description, PUBLIC_ROW.description);

  const expectedCanonical = `${ORIGIN}/explore/workflow/?id=${ENCODED_ID}`;
  assert.equal(decision.canonicalUrl, expectedCanonical);
  assert.ok(
    decision.canonicalUrl.endsWith(`/explore/workflow/?id=${ENCODED_ID}`),
    "canonical uses the served trailing-slash form",
  );

  assert.equal(decision.alternates.length, SUPPORTED_LOCALES.length);
  assert.deepEqual(
    decision.alternates.map((alternate) => alternate.hreflang),
    [...SUPPORTED_LOCALES],
  );
  for (const alternate of decision.alternates) {
    const expected = `${ORIGIN}${servedPathFor(alternate.hreflang)}?id=${ENCODED_ID}`;
    assert.equal(alternate.href, expected, alternate.hreflang);
    assert.ok(
      /\/explore\/workflow\/\?id=/.test(alternate.href),
      `trailing-slash canonical for ${alternate.hreflang}`,
    );
  }
});

test("canonical/hreflang URLs are locale-preserving (zh-Hant page)", () => {
  const decision = publicDecision({
    pathname: "/zh-Hant/explore/workflow/",
  });
  assert.equal(decision.kind, "metadata");
  assert.equal(decision.locale, "zh-Hant");
  assert.equal(decision.canonicalUrl, `${ORIGIN}/zh-Hant/explore/workflow/?id=${ENCODED_ID}`);
  const en = decision.alternates.find((alternate) => alternate.hreflang === "en");
  const zhHant = decision.alternates.find((alternate) => alternate.hreflang === "zh-Hant");
  assert.equal(en.href, `${ORIGIN}/explore/workflow/?id=${ENCODED_ID}`);
  assert.equal(zhHant.href, `${ORIGIN}/zh-Hant/explore/workflow/?id=${ENCODED_ID}`);
});

test("trailing slash never changes the canonical form", () => {
  const withSlash = publicDecision({ pathname: "/explore/workflow/" });
  const withoutSlash = publicDecision({ pathname: "/explore/workflow" });
  assert.equal(withSlash.canonicalUrl, withoutSlash.canonicalUrl);
  assert.equal(withSlash.canonicalUrl, `${ORIGIN}/explore/workflow/?id=${ENCODED_ID}`);
});

test("the id is URL-encoded in every canonical form", () => {
  const rawId = "a b/c&d=e?f#g";
  const encoded = encodeURIComponent(rawId);
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/ja/explore/workflow/",
    workflowId: rawId,
    row: { ...PUBLIC_ROW, id: rawId },
  });
  assert.equal(decision.kind, "metadata");
  assert.ok(decision.canonicalUrl.endsWith(`?id=${encoded}`), decision.canonicalUrl);
  assert.ok(decision.canonicalUrl.includes("/ja/explore/workflow/?id="), decision.canonicalUrl);
  for (const alternate of decision.alternates) {
    assert.ok(alternate.href.endsWith(`?id=${encoded}`), alternate.href);
  }
});

test("JSON-LD carries schema.org CreativeWork data", () => {
  const decision = publicDecision();
  assert.ok(decision.jsonLd);
  const jsonLd = JSON.parse(decision.jsonLd);
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "CreativeWork");
  assert.equal(jsonLd.name, "My RAG Workflow");
  assert.equal(jsonLd.description, PUBLIC_ROW.description);
  assert.equal(jsonLd.url, decision.canonicalUrl);
  assert.equal(jsonLd.inLanguage, "en");
  assert.deepEqual(jsonLd.author, {
    "@type": "Person",
    name: "Alice",
    url: "https://example.com/alice",
  });
  assert.equal(jsonLd.keywords, "rag, documents");
});

test("JSON-LD inLanguage follows the page locale", () => {
  const ja = publicDecision({ pathname: "/ja/explore/workflow/" });
  assert.equal(JSON.parse(ja.jsonLd).inLanguage, "ja");
  const zhHant = publicDecision({ pathname: "/zh-Hant/explore/workflow/" });
  assert.equal(JSON.parse(zhHant.jsonLd).inLanguage, "zh-Hant");
});

test("JSON-LD uses author_data/dateModified when available and tolerates junk", () => {
  const withDate = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: WORKFLOW_ID,
    row: {
      ...PUBLIC_ROW,
      update_time: "2024-05-06T07:08:09Z",
      author_data: '{"authorName":"Bob"}',
      tags: "not-json",
    },
  });
  const jsonLd = JSON.parse(withDate.jsonLd);
  assert.deepEqual(jsonLd.author, { "@type": "Person", name: "Bob" });
  assert.equal(jsonLd.dateModified, "2024-05-06T07:08:09Z");
  assert.equal(jsonLd.keywords, undefined);

  const junk = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: WORKFLOW_ID,
    row: { ...PUBLIC_ROW, author_data: "{not json", tags: null },
  });
  const junkJsonLd = JSON.parse(junk.jsonLd);
  assert.equal(junkJsonLd.author, undefined);
  assert.equal(junkJsonLd.keywords, undefined);
});

test("empty description/name fall back gracefully", () => {
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: WORKFLOW_ID,
    row: { ...PUBLIC_ROW, filename: null, description: null },
  });
  assert.equal(decision.kind, "metadata");
  assert.equal(decision.title, `Workflow | ${SITE_NAME}`);
  assert.equal(decision.heading, "Workflow");
  assert.equal(decision.description, null);
  assert.equal(JSON.parse(decision.jsonLd).description, undefined);
});

// ---------------------------------------------------------------------------
// Escaping & truncation of hostile workflow names/descriptions
// ---------------------------------------------------------------------------

test("hostile name/description are escaped in JSON-LD and kept out of the script", () => {
  const hostileName = 'Tom & Jerry <script>alert("x")</script> \'quoted\'';
  const hostileDescription =
    'Line one & <b>bold</b> "quoted" \'single\' </script> ' +
    "plus some padding so the text is not suspiciously short.";

  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: WORKFLOW_ID,
    row: {
      ...PUBLIC_ROW,
      filename: hostileName,
      description: hostileDescription,
    },
  });

  assert.equal(decision.kind, "metadata");
  // Title/heading/description are raw text here; HTMLRewriter escapes them when writing
  // them into attributes/text nodes.
  assert.equal(decision.title, `${toPlainText(hostileName)} | ${SITE_NAME}`);
  assert.equal(decision.heading, toPlainText(hostileName));

  // The JSON-LD payload is inlined inside a <script> element, so it must be escaped.
  assert.ok(decision.jsonLd);
  assert.ok(!decision.jsonLd.includes("</script"), "no raw script terminator");
  assert.ok(!/<|>/.test(decision.jsonLd), "no raw angle brackets in JSON-LD");
  assert.ok(decision.jsonLd.includes("\\u003c"), "angle brackets escaped");
  assert.ok(decision.jsonLd.includes("\\u0026"), "ampersands escaped");

  // Escaping must be transparent to JSON parsers.
  const jsonLd = JSON.parse(decision.jsonLd);
  assert.equal(jsonLd.name, toPlainText(hostileName));
  assert.equal(jsonLd.description, decision.description);
});

test("description is truncated to ~160 chars on a word boundary", () => {
  const longDescription = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: WORKFLOW_ID,
    row: { ...PUBLIC_ROW, description: longDescription },
  });
  assert.equal(decision.kind, "metadata");
  assert.ok(decision.description.endsWith("…"), decision.description);
  assert.ok(
    decision.description.length <= DESCRIPTION_MAX_LENGTH + 1,
    `length ${decision.description.length}`,
  );
  const cut = decision.description.slice(0, -1);
  assert.ok(cut.length <= DESCRIPTION_MAX_LENGTH);
  assert.ok(longDescription.startsWith(cut), "truncation keeps a prefix");
  assert.equal(longDescription[cut.length], " ", "truncation ends on a word boundary");
  assert.equal(JSON.parse(decision.jsonLd).description, decision.description);
});

test("short descriptions are kept verbatim (whitespace-normalized only)", () => {
  assert.equal(truncateText("  hello\n\n   world  "), "hello world");
  assert.equal(toPlainText(null), "");
  assert.equal(toPlainText(undefined), "");
  assert.equal(toPlainText("a\u0000b"), "a b");
  assert.equal(truncateText("already short"), "already short");
});

test("escapeHtmlAttribute escapes & < > but leaves quotes to HTMLRewriter", () => {
  // HTMLRewriter.setAttribute only escapes `"`; `&`, `<` and `>` must be escaped here.
  assert.equal(escapeHtmlAttribute("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(escapeHtmlAttribute("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtmlAttribute("</script>"), "&lt;/script&gt;");
  assert.equal(escapeHtmlAttribute("a < b > c"), "a &lt; b &gt; c");
  // Order matters: all `&` are escaped exactly once.
  assert.equal(escapeHtmlAttribute("&lt;"), "&amp;lt;");
  assert.equal(escapeHtmlAttribute("&quot;"), "&amp;quot;");
  // Quotes are intentionally NOT escaped (HTMLRewriter handles them; escaping would
  // double-escape and show `&quot;` in the page).
  assert.equal(escapeHtmlAttribute('"double" \'single\''), '"double" \'single\'');
  assert.equal(escapeHtmlAttribute(""), "");
  assert.equal(escapeHtmlAttribute("plain text"), "plain text");
});

test("escaping a hostile workflow title/description leaves no raw markup", () => {
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: "/explore/workflow/",
    workflowId: WORKFLOW_ID,
    row: {
      ...PUBLIC_ROW,
      filename: 'Tom & Jerry <script>alert("x")</script>',
      description: "Fish & chips </script> &quot; &lt;",
    },
  });
  const titleAttribute = escapeHtmlAttribute(decision.title);
  const descriptionAttribute = escapeHtmlAttribute(decision.description);
  for (const value of [titleAttribute, descriptionAttribute]) {
    assert.ok(!value.includes("<"), "no raw `<`");
    assert.ok(!value.includes(">"), "no raw `>`");
    assert.ok(!value.includes("</script"), "no raw script terminator");
  }
  assert.ok(titleAttribute.includes("&amp;"), "ampersand escaped once");
  assert.ok(titleAttribute.includes("&lt;script&gt;"), "script tag escaped");
  assert.equal(escapeHtmlAttribute("&quot;"), "&amp;quot;");
});

test("serializeJsonLd escapes script terminators and unicode line separators", () => {
  const serialized = serializeJsonLd({
    text: "</script><script>alert(1)</script>",
    line: "a\u2028b\u2029c",
  });
  assert.ok(!serialized.includes("</script"));
  assert.ok(!/<|>/.test(serialized));
  assert.ok(serialized.includes("\\u2028"));
  assert.ok(serialized.includes("\\u2029"));
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.text, "</script><script>alert(1)</script>");
  assert.equal(parsed.line, "a\u2028b\u2029c");
});

// ---------------------------------------------------------------------------
// Private row -> noindex, no leak
// ---------------------------------------------------------------------------

test("private row: 200 + noindex, no name/description anywhere", () => {
  const secretName = "Top Secret Workflow";
  const secretDescription = "Secret description that must never leak.";
  for (const isPrivate of [1, "1", true]) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname: "/explore/workflow/",
      workflowId: WORKFLOW_ID,
      row: {
        ...PUBLIC_ROW,
        filename: secretName,
        description: secretDescription,
        is_private: isPrivate,
      },
    });
    assert.equal(decision.kind, "metadata");
    assert.equal(decision.status, 200);
    assert.equal(decision.indexable, false);
    assert.equal(decision.robots, "noindex");
    assert.equal(decision.locale, "");
    assert.equal(decision.title, null);
    assert.equal(decision.heading, null);
    assert.equal(decision.description, null);
    assert.equal(decision.jsonLd, null);

    // URL identity is allowed to include the id, but the workflow content is not.
    assert.equal(decision.canonicalUrl, `${ORIGIN}/explore/workflow/?id=${ENCODED_ID}`);
    assert.equal(decision.alternates.length, SUPPORTED_LOCALES.length);

    const serializedDecision = JSON.stringify(decision);
    assert.ok(!serializedDecision.includes(secretName), "no private name");
    assert.ok(!serializedDecision.includes("Top Secret"), "no private name");
    assert.ok(!serializedDecision.includes(secretDescription), "no private description");
    assert.ok(!serializedDecision.includes("Secret description"), "no private description");
  }
});

test("private flag values 0 / \"0\" / false are treated as public", () => {
  for (const isPrivate of [0, "0", false]) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname: "/explore/workflow/",
      workflowId: WORKFLOW_ID,
      row: { ...PUBLIC_ROW, is_private: isPrivate },
    });
    assert.equal(decision.indexable, true);
    assert.equal(decision.title, `My RAG Workflow | ${SITE_NAME}`);
  }
});

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

test("canonicalHref normalizes origin/pathname and encodes the id", () => {
  assert.equal(
    canonicalHref({
      origin: "https://diflowy.greenerai.top/",
      pathname: "/zh/explore/workflow/",
      workflowId: "a b",
    }),
    "https://diflowy.greenerai.top/zh/explore/workflow/?id=a%20b",
  );
  assert.equal(
    canonicalHref({ origin: ORIGIN, pathname: "explore/workflow", workflowId: "x" }),
    `${ORIGIN}/explore/workflow/?id=x`,
  );
});

test("buildAlternateLinks covers all locales in the canonical form", () => {
  const alternates = buildAlternateLinks({ origin: ORIGIN, workflowId: "abc" });
  assert.equal(alternates.length, 12);
  const hrefs = alternates.map((alternate) => alternate.href);
  assert.equal(new Set(hrefs).size, 12, "one distinct href per locale");
  for (const locale of SUPPORTED_LOCALES) {
    const expected = `${ORIGIN}${servedPathFor(locale)}?id=abc`;
    assert.ok(hrefs.includes(expected), `missing ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// Canonical form must be the URL production serves (200), i.e. with the trailing
// slash, so canonical/og:url/hreflang never name a 308-redirecting URL.
// ---------------------------------------------------------------------------

test("(a) canonical always matches the served trailing-slash form for every locale", () => {
  const prefixedLocales = [...SUPPORTED_LOCALES]
    .filter((locale) => locale !== "en")
    .join("|");
  const pattern = new RegExp(
    `^${escapeRegExp(ORIGIN)}/(?:(?:${prefixedLocales})/)?explore/workflow/\\?id=${escapeRegExp(ENCODED_ID)}$`,
  );
  for (const locale of SUPPORTED_LOCALES) {
    // Both request forms (Pages 308s the slashless one) must yield the served form.
    for (const pathname of [detailPathFor(locale), servedPathFor(locale)]) {
      const decision = publicDecision({ pathname });
      assert.equal(decision.kind, "metadata");
      assert.match(decision.canonicalUrl, pattern, `${locale} request ${pathname}`);
      assert.equal(
        decision.canonicalUrl,
        `${ORIGIN}${servedPathFor(locale)}?id=${ENCODED_ID}`,
        `${locale} request ${pathname}`,
      );
    }
  }
});

test("(b) og:url/canonical is one single normalized form", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const decision = publicDecision({ pathname: detailPathFor(locale) });
    const expected = `${ORIGIN}${servedPathFor(locale)}?id=${ENCODED_ID}`;
    // The middleware writes <link rel=canonical> and <meta property=og:url> from this
    // single decision field, so both necessarily carry the identical URL.
    assert.equal(decision.canonicalUrl, expected);
    assert.equal(
      canonicalHref({
        origin: ORIGIN,
        pathname: servedPathFor(locale),
        workflowId: WORKFLOW_ID,
      }),
      expected,
    );
    assert.equal(JSON.parse(decision.jsonLd).url, expected, "JSON-LD url matches canonical");
  }
});

test("(c) all 12 hreflang alternates use the same trailing-slash canonical form", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const decision = publicDecision({ pathname: detailPathFor(locale) });
    assert.equal(decision.alternates.length, 12);
    for (const alternate of decision.alternates) {
      assert.match(
        alternate.href,
        /\/explore\/workflow\/\?id=[^/]+$/,
        alternate.hreflang,
      );
      assert.equal(
        alternate.href,
        `${ORIGIN}${servedPathFor(alternate.hreflang)}?id=${ENCODED_ID}`,
        alternate.hreflang,
      );
    }
    assert.equal(new Set(decision.alternates.map((alternate) => alternate.href)).size, 12);
  }
});

test("(d) slashless and trailing-slash requests resolve to the same decision", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const slashless = publicDecision({ pathname: detailPathFor(locale) });
    const withSlash = publicDecision({ pathname: servedPathFor(locale) });
    assert.deepEqual(slashless, withSlash, `${locale} request form`);
    assert.equal(slashless.canonicalUrl, `${ORIGIN}${servedPathFor(locale)}?id=${ENCODED_ID}`);
  }
});
