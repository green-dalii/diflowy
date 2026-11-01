/**
 * Node-native tests for the pure workflow metadata decisions (path-style URLs, phase 2).
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
  SOCIAL_IMAGE_HEIGHT,
  SOCIAL_IMAGE_PATH,
  SOCIAL_IMAGE_TYPE,
  SOCIAL_IMAGE_WIDTH,
  SUPPORTED_LOCALES,
  WORKFLOW_DETAIL_PATH,
  buildAlternateLinks,
  buildWorkflowMetadata,
  escapeHtmlAttribute,
  explorePathForLocale,
  legacyQueryRedirect,
  matchWorkflowDetailIdPath,
  matchWorkflowDetailPath,
  missingWorkflowIdRedirect,
  normalizeLocale,
  serializeJsonLd,
  toPlainText,
  truncateText,
  workflowDetailHref,
  workflowPathForLocale,
  workflowSocialImageHref,
  workflowStaticPagePathForLocale,
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

/** Locale-prefixed bare page path, `""`/`en` -> unprefixed, no trailing slash. */
function pagePathFor(locale) {
  return !locale || locale === "en"
    ? WORKFLOW_DETAIL_PATH
    : `/${locale}${WORKFLOW_DETAIL_PATH}`;
}

/** Path-style detail URL: /<locale?>/explore/workflow/<encoded id>. */
function idPathFor(locale, workflowId = WORKFLOW_ID) {
  return `${pagePathFor(locale)}/${encodeURIComponent(workflowId)}`;
}

/** Canonical path-style href for a locale. */
function expectedCanonical(locale, workflowId = WORKFLOW_ID) {
  return `${ORIGIN}${idPathFor(locale, workflowId)}`;
}

function decisionFor(overrides = {}) {
  return buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: idPathFor("", WORKFLOW_ID),
    row: PUBLIC_ROW,
    ...overrides,
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Path matching: bare page (no id)
// ---------------------------------------------------------------------------

test("matchWorkflowDetailPath: default locale, with and without trailing slash", () => {
  assert.deepEqual(matchWorkflowDetailPath("/explore/workflow"), { locale: "" });
  assert.deepEqual(matchWorkflowDetailPath("/explore/workflow/"), { locale: "" });
  assert.deepEqual(matchWorkflowDetailPath("/explore/workflow///"), { locale: "" });
});

test("matchWorkflowDetailPath: every supported locale path", () => {
  const locales = [...SUPPORTED_LOCALES];
  assert.equal(locales.length, 12);
  assert.equal(locales[0], DEFAULT_LOCALE);

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

test("matchWorkflowDetailPath: rejects non-page paths (incl. id-style paths)", () => {
  const rejected = [
    "/",
    "",
    "/explore",
    "/explore/",
    "/explore/workflow/extra",
    `/explore/workflow/${WORKFLOW_ID}`,
    "/explore/workflowing",
    "/zh/explore",
    `/zh/explore/workflow/${WORKFLOW_ID}`,
    "/explore//workflow",
    "/en/explore/workflow",
    "/xx/explore/workflow",
    "/api/workflow",
    "/api/workflow/download/abc",
  ];
  for (const pathname of rejected) {
    assert.equal(
      matchWorkflowDetailPath(pathname),
      null,
      `should reject ${pathname}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Path matching: path-style id
// ---------------------------------------------------------------------------

test("matchWorkflowDetailIdPath: default locale, with and without trailing slash", () => {
  assert.deepEqual(matchWorkflowDetailIdPath(idPathFor("en")), {
    locale: "",
    workflowId: WORKFLOW_ID,
  });
  assert.deepEqual(matchWorkflowDetailIdPath(`${idPathFor("en")}/`), {
    locale: "",
    workflowId: WORKFLOW_ID,
  });
});

test("matchWorkflowDetailIdPath: every supported locale path", () => {
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en") continue;
    assert.deepEqual(
      matchWorkflowDetailIdPath(idPathFor(locale)),
      { locale, workflowId: WORKFLOW_ID },
      `id path for ${locale}`,
    );
    assert.deepEqual(
      matchWorkflowDetailIdPath(`${idPathFor(locale)}/`),
      { locale, workflowId: WORKFLOW_ID },
      `id path with trailing slash for ${locale}`,
    );
  }
});

test("matchWorkflowDetailIdPath: decodes percent-encoded ids, tolerates malformed ones", () => {
  assert.deepEqual(matchWorkflowDetailIdPath("/explore/workflow/a%20b"), {
    locale: "",
    workflowId: "a b",
  });
  assert.deepEqual(matchWorkflowDetailIdPath("/explore/workflow/a%2Fb"), {
    locale: "",
    workflowId: "a/b",
  });
  // decodeURIComponent throws on malformed sequences — fall back to the raw segment.
  assert.deepEqual(matchWorkflowDetailIdPath("/explore/workflow/100%"), {
    locale: "",
    workflowId: "100%",
  });
  assert.deepEqual(matchWorkflowDetailIdPath("/ZH/explore/workflow/abc"), {
    locale: "zh",
    workflowId: "abc",
  });
});

test("matchWorkflowDetailIdPath: rejects page paths, extra segments, unknown locales", () => {
  const rejected = [
    "",
    "/",
    "/explore",
    "/explore/workflow",
    "/explore/workflow/",
    "/explore/workflow/a/b",
    "/zh/explore/workflow/a/b",
    "/xx/explore/workflow/abc",
    "/en/explore/workflow/abc",
    "/explore//workflow/abc",
    "/explore/workflowing/abc",
    "/api/workflow/download/abc",
  ];
  for (const pathname of rejected) {
    assert.equal(
      matchWorkflowDetailIdPath(pathname),
      null,
      `should reject ${pathname}`,
    );
  }
});

test("locale helpers normalize case and keep the static page path form", () => {
  assert.equal(normalizeLocale("en"), "");
  assert.equal(normalizeLocale("EN"), "");
  assert.equal(normalizeLocale(""), "");
  assert.equal(normalizeLocale("zh-hant"), "zh-Hant");
  assert.equal(normalizeLocale("xx"), null);
  assert.equal(workflowPathForLocale("en"), "/explore/workflow");
  assert.equal(workflowPathForLocale("zh-Hant"), "/zh-Hant/explore/workflow");
  assert.equal(workflowStaticPagePathForLocale("en"), "/explore/workflow/");
  assert.equal(workflowStaticPagePathForLocale("ja"), "/ja/explore/workflow/");
  assert.equal(explorePathForLocale("en"), "/explore");
  assert.equal(explorePathForLocale("ja"), "/ja/explore");
});

// ---------------------------------------------------------------------------
// Path-style canonical URLs
// ---------------------------------------------------------------------------

test("workflowDetailHref: path-style, no trailing slash, no query, encoded id", () => {
  assert.equal(
    workflowDetailHref({ origin: ORIGIN, locale: "", workflowId: "abc" }),
    `${ORIGIN}/explore/workflow/abc`,
  );
  assert.equal(
    workflowDetailHref({ origin: ORIGIN, locale: "ja", workflowId: "abc" }),
    `${ORIGIN}/ja/explore/workflow/abc`,
  );
  assert.equal(
    workflowDetailHref({
      origin: `${ORIGIN}/`,
      locale: "zh-Hant",
      workflowId: "a b/c&d=e?f#g",
    }),
    `${ORIGIN}/zh-Hant/explore/workflow/a%20b%2Fc%26d%3De%3Ff%23g`,
  );
});

test("buildAlternateLinks covers all locales in the path-style canonical form", () => {
  const alternates = buildAlternateLinks({ origin: ORIGIN, workflowId: "abc" });
  assert.equal(alternates.length, 12);
  assert.deepEqual(
    alternates.map((alternate) => alternate.hreflang),
    [...SUPPORTED_LOCALES],
  );
  const hrefs = alternates.map((alternate) => alternate.href);
  assert.equal(new Set(hrefs).size, 12, "one distinct href per locale");
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(
      hrefs.includes(`${ORIGIN}${pagePathFor(locale)}/abc`),
      `missing path-style alternate for ${locale}`,
    );
    for (const href of hrefs) {
      assert.ok(!href.includes("?"), "no query string in path-style alternates");
      assert.ok(!href.endsWith("/abc/"), "no trailing slash after the id");
    }
  }
});

// ---------------------------------------------------------------------------
// Legacy ?id= -> 301 path form (no D1)
// ---------------------------------------------------------------------------

test("legacy ?id= on the bare page 301-redirects to the path form (all locales)", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const pathname = `${pagePathFor(locale)}/`; // query-style request path (slash form)
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname,
      queryWorkflowId: WORKFLOW_ID,
      row: null, // redirect must not depend on D1
    });
    assert.equal(decision.kind, "redirect", `${locale} kind`);
    assert.equal(decision.status, 301, `${locale} status`);
    assert.equal(decision.locale, locale === "en" ? "" : locale);
    assert.equal(decision.location, expectedCanonical(locale), `${locale} location`);
  }
});

test("legacyQueryRedirect helper is pure and locale-preserving", () => {
  for (const [pathname, expected] of [
    ["/explore/workflow/", `${ORIGIN}/explore/workflow/${ENCODED_ID}`],
    ["/ja/explore/workflow/", `${ORIGIN}/ja/explore/workflow/${ENCODED_ID}`],
    ["/zh-Hant/explore/workflow", `${ORIGIN}/zh-Hant/explore/workflow/${ENCODED_ID}`],
  ]) {
    const decision = legacyQueryRedirect({
      origin: ORIGIN,
      pathname,
      workflowId: WORKFLOW_ID,
    });
    assert.equal(decision.kind, "redirect");
    assert.equal(decision.status, 301);
    assert.equal(decision.location, expected, pathname);
  }
});

test("path-style id wins over a stray ?id= (never redirect an id-style URL)", () => {
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: idPathFor("ja", WORKFLOW_ID),
    queryWorkflowId: "some-other-id",
    row: PUBLIC_ROW,
  });
  assert.equal(decision.kind, "metadata");
  assert.equal(decision.canonicalUrl, expectedCanonical("ja"));
});

test("blank query id on the bare page is a missing id, not a 301", () => {
  for (const queryWorkflowId of [null, undefined, "", "   "]) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname: "/explore/workflow/",
      queryWorkflowId,
      row: null,
    });
    assert.equal(decision.kind, "redirect");
    assert.equal(decision.status, 302);
    assert.equal(decision.location, "/explore");
  }
});

test("missingWorkflowIdRedirect: 302 to the locale explorer", () => {
  assert.deepEqual(missingWorkflowIdRedirect({ locale: "" }), {
    kind: "redirect",
    status: 302,
    locale: "",
    location: "/explore",
  });
  assert.equal(missingWorkflowIdRedirect({ locale: "ja" }).location, "/ja/explore");
});

test("bare page without id 302-redirects to the locale explorer", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname: `${pagePathFor(locale)}/`,
      row: PUBLIC_ROW,
    });
    assert.equal(decision.kind, "redirect", `${locale} kind`);
    assert.equal(decision.status, 302, `${locale} status`);
    assert.equal(
      decision.location,
      locale === "en" ? "/explore" : `/${locale}/explore`,
      `${locale} location`,
    );
  }
});

// ---------------------------------------------------------------------------
// Path-style public row -> full metadata
// ---------------------------------------------------------------------------

test("path-style public row injects title, path canonical, alternates, heading, JSON-LD", () => {
  const decision = decisionFor();

  assert.equal(decision.kind, "metadata");
  assert.equal(decision.status, 200);
  assert.equal(decision.indexable, true);
  assert.equal(decision.robots, null);
  assert.equal(decision.locale, "");
  assert.equal(decision.title, `My RAG Workflow | ${SITE_NAME}`);
  assert.equal(decision.heading, "My RAG Workflow");
  assert.equal(decision.description, PUBLIC_ROW.description);

  const expected = `${ORIGIN}/explore/workflow/${ENCODED_ID}`;
  assert.equal(decision.canonicalUrl, expected);
  assert.equal(decision.canonicalUrl, expectedCanonical("en"));

  assert.equal(decision.alternates.length, SUPPORTED_LOCALES.length);
  for (const alternate of decision.alternates) {
    assert.equal(
      alternate.href,
      `${ORIGIN}${pagePathFor(alternate.hreflang)}/${ENCODED_ID}`,
      alternate.hreflang,
    );
    assert.ok(!alternate.href.includes("?"), `${alternate.hreflang} no query`);
    assert.ok(!/\/[^/]+\/$/.test(alternate.href), `${alternate.hreflang} no trailing slash`);
  }
});

test("canonical is path form for every locale and both request forms (slash-tolerant)", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const pathname of [idPathFor(locale), `${idPathFor(locale)}/`]) {
      const decision = decisionFor({ pathname });
      assert.equal(decision.kind, "metadata", `${locale} ${pathname}`);
      assert.equal(decision.canonicalUrl, expectedCanonical(locale), `${locale} ${pathname}`);
      // og:url and JSON-LD url are built from the same single canonical value.
      assert.equal(JSON.parse(decision.jsonLd).url, expectedCanonical(locale));
      assert.equal(decision.alternates.length, 12);
    }
  }
});

test("canonical path form matches the exact served shape (one slash after origin/locale)", () => {
  const prefixedLocales = [...SUPPORTED_LOCALES]
    .filter((locale) => locale !== "en")
    .join("|");
  const pattern = new RegExp(
    `^${escapeRegExp(ORIGIN)}/(?:(?:${prefixedLocales})/)?explore/workflow/${escapeRegExp(ENCODED_ID)}$`,
  );
  for (const locale of SUPPORTED_LOCALES) {
    const decision = decisionFor({ pathname: idPathFor(locale) });
    assert.match(decision.canonicalUrl, pattern, locale);
    assert.ok(!decision.canonicalUrl.includes("?"), `${locale} has no query string`);
  }
});

test("decoded path ids are re-encoded in canonical URLs", () => {
  const rawId = "a b/c&d=e?f#g";
  const encoded = encodeURIComponent(rawId);
  const decision = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: `/ja/explore/workflow/${encoded}`,
    row: { ...PUBLIC_ROW, id: rawId },
  });
  assert.equal(decision.kind, "metadata");
  assert.equal(decision.canonicalUrl, `${ORIGIN}/ja/explore/workflow/${encoded}`);
  assert.equal(decision.canonicalUrl, expectedCanonical("ja", rawId));
  for (const alternate of decision.alternates) {
    assert.ok(alternate.href.endsWith(`/${encoded}`), alternate.href);
  }
  assert.equal(JSON.parse(decision.jsonLd).url, decision.canonicalUrl);
});

test("JSON-LD carries schema.org CreativeWork data with the path url", () => {
  const decision = decisionFor({ pathname: idPathFor("ja") });
  assert.ok(decision.jsonLd);
  const jsonLd = JSON.parse(decision.jsonLd);
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "CreativeWork");
  assert.equal(jsonLd.name, "My RAG Workflow");
  assert.equal(jsonLd.description, PUBLIC_ROW.description);
  assert.equal(jsonLd.url, `${ORIGIN}/ja/explore/workflow/${ENCODED_ID}`);
  assert.equal(jsonLd.inLanguage, "ja");
  assert.deepEqual(jsonLd.author, {
    "@type": "Person",
    name: "Alice",
    url: "https://example.com/alice",
  });
  assert.equal(jsonLd.keywords, "rag, documents");
});

test("JSON-LD uses author_data/dateModified when available and tolerates junk", () => {
  const withDate = decisionFor({
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

  const junk = decisionFor({
    row: { ...PUBLIC_ROW, author_data: "{not json", tags: null },
  });
  const junkJsonLd = JSON.parse(junk.jsonLd);
  assert.equal(junkJsonLd.author, undefined);
  assert.equal(junkJsonLd.keywords, undefined);
});

test("empty description/name fall back gracefully", () => {
  const decision = decisionFor({
    row: { ...PUBLIC_ROW, filename: null, description: null },
  });
  assert.equal(decision.kind, "metadata");
  assert.equal(decision.title, `Workflow | ${SITE_NAME}`);
  assert.equal(decision.heading, "Workflow");
  assert.equal(decision.description, null);
  assert.equal(JSON.parse(decision.jsonLd).description, undefined);
});

// ---------------------------------------------------------------------------
// Unknown id and private rows (path style)
// ---------------------------------------------------------------------------

test("unknown path id yields a 404 noindex decision", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const decision = buildWorkflowMetadata({
      origin: ORIGIN,
      pathname: idPathFor(locale, "does-not-exist"),
      row: null,
    });
    assert.equal(decision.kind, "notFound", locale);
    assert.equal(decision.status, 404);
    assert.equal(decision.locale, locale === "en" ? "" : locale);
    assert.equal(decision.indexable, false);
    assert.equal(decision.robots, "noindex");
  }
});

test("private path row: 200 + noindex, no name/description anywhere", () => {
  const secretName = "Top Secret Workflow";
  const secretDescription = "Secret description that must never leak.";
  for (const isPrivate of [1, "1", true]) {
    const decision = decisionFor({
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

    // URL identity is allowed (it only repeats the request id), content is not.
    assert.equal(decision.canonicalUrl, expectedCanonical("en"));
    assert.equal(decision.alternates.length, SUPPORTED_LOCALES.length);

    const serialized = JSON.stringify(decision);
    assert.ok(!serialized.includes(secretName), "no private name");
    assert.ok(!serialized.includes("Top Secret"), "no private name");
    assert.ok(!serialized.includes(secretDescription), "no private description");
  }
});

test("private flag values 0 / \"0\" / false are treated as public", () => {
  for (const isPrivate of [0, "0", false]) {
    const decision = decisionFor({ row: { ...PUBLIC_ROW, is_private: isPrivate } });
    assert.equal(decision.indexable, true);
    assert.equal(decision.title, `My RAG Workflow | ${SITE_NAME}`);
  }
});

// ---------------------------------------------------------------------------
// Escaping & truncation (unchanged behaviour, path-style URLs)
// ---------------------------------------------------------------------------

test("hostile name/description are escaped in JSON-LD and kept out of the script", () => {
  const hostileName = 'Tom & Jerry <script>alert("x")</script> \'quoted\'';
  const hostileDescription =
    'Line one & <b>bold</b> "quoted" \'single\' </script> ' +
    "plus some padding so the text is not suspiciously short.";

  const decision = decisionFor({
    row: {
      ...PUBLIC_ROW,
      filename: hostileName,
      description: hostileDescription,
    },
  });

  assert.equal(decision.kind, "metadata");
  assert.equal(decision.title, `${toPlainText(hostileName)} | ${SITE_NAME}`);
  assert.equal(decision.heading, toPlainText(hostileName));

  assert.ok(decision.jsonLd);
  assert.ok(!decision.jsonLd.includes("</script"), "no raw script terminator");
  assert.ok(!/<|>/.test(decision.jsonLd), "no raw angle brackets in JSON-LD");
  assert.ok(decision.jsonLd.includes("\\u003c"), "angle brackets escaped");
  assert.ok(decision.jsonLd.includes("\\u0026"), "ampersands escaped");

  const jsonLd = JSON.parse(decision.jsonLd);
  assert.equal(jsonLd.name, toPlainText(hostileName));
  assert.equal(jsonLd.description, decision.description);
});

test("escapeHtmlAttribute escapes & < > but leaves quotes to HTMLRewriter", () => {
  assert.equal(escapeHtmlAttribute("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(escapeHtmlAttribute("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtmlAttribute("</script>"), "&lt;/script&gt;");
  assert.equal(escapeHtmlAttribute("a < b > c"), "a &lt; b &gt; c");
  assert.equal(escapeHtmlAttribute("&lt;"), "&amp;lt;");
  assert.equal(escapeHtmlAttribute("&quot;"), "&amp;quot;");
  assert.equal(escapeHtmlAttribute('"double" \'single\''), '"double" \'single\'');
  assert.equal(escapeHtmlAttribute(""), "");
  assert.equal(escapeHtmlAttribute("plain text"), "plain text");
});

test("escaping a hostile workflow title/description leaves no raw markup", () => {
  const decision = decisionFor({
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

test("description is truncated to ~160 chars on a word boundary", () => {
  const longDescription = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
  const decision = decisionFor({ row: { ...PUBLIC_ROW, description: longDescription } });
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
// Per-workflow Open Graph image (public rows only)
// ---------------------------------------------------------------------------

test("workflowSocialImageHref: /og/workflow.png with the id encoded exactly once", () => {
  assert.equal(SOCIAL_IMAGE_PATH, "/og/workflow.png");
  assert.equal(SOCIAL_IMAGE_TYPE, "image/png");
  assert.equal(SOCIAL_IMAGE_WIDTH, 1200);
  assert.equal(SOCIAL_IMAGE_HEIGHT, 630);

  // Default locale (`en`/absent) omits the lang hint: Latin-only card auto-detects.
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID }),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}`,
  );
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale: "en" }),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}`,
  );
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale: "" }),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}`,
  );
  // Non-default locales add the satori fallback-font hint.
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale: "ja" }),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}&lang=ja`,
  );
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale: "zh-Hant" }),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}&lang=zh-Hant`,
  );
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale: "ko" }),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}&lang=ko`,
  );
  // Both the id and the locale are encoded exactly once.
  assert.equal(
    workflowSocialImageHref({
      origin: `${ORIGIN}/`,
      workflowId: "a b/c&d=e?f#g",
      locale: "ja",
    }),
    `${ORIGIN}/og/workflow.png?id=a%20b%2Fc%26d%3De%3Ff%23g&lang=ja`,
  );
  // Raw ids are encoded once, never double-encoded.
  assert.equal(
    workflowSocialImageHref({ origin: ORIGIN, workflowId: "a%2Fb" }),
    `${ORIGIN}/og/workflow.png?id=a%252Fb`,
  );
  // Attribute context: the raw markup must carry `&amp;lang=`.
  assert.equal(
    escapeHtmlAttribute(
      workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale: "ja" }),
    ),
    `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}&amp;lang=ja`,
  );
});

test("public decisions carry the per-workflow og:image + lang hint for every locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const decision = decisionFor({ pathname: idPathFor(locale) });
    assert.equal(decision.kind, "metadata", locale);
    // The card endpoint is shared, but non-default locales pass their satori hint.
    const langHint = locale === "en" ? "" : `&lang=${locale}`;
    assert.equal(
      decision.socialImageUrl,
      `${ORIGIN}/og/workflow.png?id=${ENCODED_ID}${langHint}`,
      locale,
    );
    if (locale === "en") {
      assert.ok(!decision.socialImageUrl.includes("lang="), "en has no lang hint");
    } else {
      assert.ok(
        decision.socialImageUrl.includes(`&lang=${locale}`),
        `${locale} carries the raw (unescaped) lang hint in the decision`,
      );
      assert.ok(!decision.socialImageUrl.includes("&amp;"), "decision value is unescaped");
    }
    assert.equal(decision.socialImageAlt, decision.title, locale);
    assert.equal(decision.socialImageAlt, `My RAG Workflow | ${SITE_NAME}`);
    assert.equal(
      decision.socialImageUrl,
      workflowSocialImageHref({ origin: ORIGIN, workflowId: WORKFLOW_ID, locale }),
    );
  }

  // Encoded ids use the same single encoding as the canonical URL.
  const special = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: `/explore/workflow/${encodeURIComponent("a b")}`,
    row: { ...PUBLIC_ROW, id: "a b" },
  });
  assert.equal(special.kind, "metadata");
  assert.equal(special.socialImageUrl, `${ORIGIN}/og/workflow.png?id=a%20b`);
  assert.ok(special.canonicalUrl.endsWith("/a%20b"));

  // Locale + special id together: each encoded once, lang hint present.
  const specialJa = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: `/ja/explore/workflow/${encodeURIComponent("a b")}`,
    row: { ...PUBLIC_ROW, id: "a b" },
  });
  assert.equal(specialJa.kind, "metadata");
  assert.equal(specialJa.socialImageUrl, `${ORIGIN}/og/workflow.png?id=a%20b&lang=ja`);
  assert.equal(
    escapeHtmlAttribute(specialJa.socialImageUrl),
    `${ORIGIN}/og/workflow.png?id=a%20b&amp;lang=ja`,
  );
});

test("private and notFound decisions keep the site-wide og.jpg (no per-workflow image)", () => {
  const privateDecision = decisionFor({ row: { ...PUBLIC_ROW, is_private: 1 } });
  assert.equal(privateDecision.kind, "metadata");
  assert.equal(privateDecision.socialImageUrl, null);
  assert.equal(privateDecision.socialImageAlt, null);
  assert.ok(
    !JSON.stringify(privateDecision).includes("/og/workflow.png"),
    "private decision never advertises the card endpoint",
  );

  const notFound = buildWorkflowMetadata({
    origin: ORIGIN,
    pathname: idPathFor("en", "does-not-exist"),
    row: null,
  });
  assert.equal(notFound.kind, "notFound");
  assert.ok(!("socialImageUrl" in notFound));
  assert.ok(!JSON.stringify(notFound).includes("/og/workflow.png"));
});
