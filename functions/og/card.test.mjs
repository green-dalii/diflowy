/**
 * Node-native tests for the pure OG card helpers (public/private gating, text
 * sanitising, truncation). Same pattern as `functions/workflowMeta.test.mjs`.
 *
 * Run with:  node --test functions/og/card.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DESCRIPTION_MAX_CHARS,
  NAME_MAX_CHARS,
  SITE_HOST,
  SITE_NAME,
  SITE_TAGLINE,
  buildGenericCard,
  buildGenericCardData,
  buildWorkflowCard,
  buildWorkflowCardData,
  detectCardLanguage,
  isPublicWorkflowRow,
  normalizeCardLanguage,
  parseAuthorName,
  parseTags,
  sanitizeCardText,
} from "./card.ts";

const PUBLIC_ROW = {
  id: "ve2dnziba57foh3e",
  filename: "YouTube Transcript Search by Arcmira",
  description: "Search YouTube transcripts with this Dify workflow.",
  is_private: 0,
  author_data: '{"authorName":"zealous1"}',
  tags: '["youtube","search","transcript"]',
};

const PRIVATE_ROW = {
  ...PUBLIC_ROW,
  id: "privatesecret00001",
  filename: "TOP SECRET Private Workflow Name",
  description: "Private description that must not leak.",
  is_private: 1,
  author_data: '{"authorName":"secretowner"}',
};

/** Collects every string rendered anywhere in a satori element tree. */
function collectText(element) {
  const out = [];
  const visit = (node) => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") visit(node.props?.children);
  };
  visit(element);
  return out.join(" ");
}

test("only explicit public values render a workflow card", () => {
  assert.equal(isPublicWorkflowRow({ ...PUBLIC_ROW, is_private: 0 }), true);
  assert.equal(isPublicWorkflowRow({ ...PUBLIC_ROW, is_private: "0" }), true);
  assert.equal(isPublicWorkflowRow({ ...PUBLIC_ROW, is_private: false }), true);
  assert.equal(isPublicWorkflowRow({ ...PRIVATE_ROW, is_private: 1 }), false);
  assert.equal(isPublicWorkflowRow({ ...PRIVATE_ROW, is_private: "1" }), false);
  assert.equal(isPublicWorkflowRow({ ...PRIVATE_ROW, is_private: true }), false);
  assert.equal(isPublicWorkflowRow({ ...PRIVATE_ROW, is_private: null }), false);
  assert.equal(isPublicWorkflowRow({ ...PRIVATE_ROW, is_private: "garbage" }), false);
  assert.equal(isPublicWorkflowRow(null), false);
  assert.equal(isPublicWorkflowRow(undefined), false);
});

test("sanitizeCardText strips control/bidi chars, collapses whitespace, truncates", () => {
  assert.equal(sanitizeCardText("  hello\n\tworld  ", 100), "hello world");
  assert.equal(sanitizeCardText("a\u0000b\u202ec", 100), "a b c");
  assert.equal(sanitizeCardText("x".repeat(50), 10), "xxxxxxxxx\u2026");
  assert.equal(sanitizeCardText("short", 10), "short");
  assert.equal(sanitizeCardText(null, 10), "");
  assert.equal(sanitizeCardText(undefined, 10), "");
  assert.equal(sanitizeCardText(42, 10), "");
  // Truncation counts code points, never splitting a surrogate pair.
  const emoji = sanitizeCardText("😀".repeat(20), 3);
  assert.equal(Array.from(emoji).length, 3);
});

test("workflow card data truncates name/description and parses author/tags", () => {
  const data = buildWorkflowCardData({
    ...PUBLIC_ROW,
    filename: "N".repeat(NAME_MAX_CHARS + 25),
    description: "D".repeat(DESCRIPTION_MAX_CHARS + 25),
  });
  assert.equal(Array.from(data.name).length, NAME_MAX_CHARS);
  assert.ok(data.name.endsWith("\u2026"));
  assert.equal(Array.from(data.description).length, DESCRIPTION_MAX_CHARS);
  assert.equal(data.author, "zealous1");
  assert.deepEqual(data.tags, ["youtube", "search", "transcript"]);
});

test("author/tags parsing is defensive", () => {
  assert.equal(parseAuthorName("not json"), "");
  assert.equal(parseAuthorName('{"authorName":42}'), "");
  assert.equal(parseAuthorName('{"authorName":"tester&co"}'), "tester&co");
  assert.deepEqual(parseTags("not json"), []);
  assert.deepEqual(parseTags('{"a":1}'), []);
  assert.deepEqual(parseTags('["a","a","b","c","d"]', 3), ["a", "b", "c"]);
});

test("public card renders the workflow name and HTML-ish characters as plain text", () => {
  const hostile = {
    ...PUBLIC_ROW,
    filename: 'Tom & Jerry\'s "Quote" </script> Workflow',
    description: 'A & "quoted" description with </script><script>alert("xss")</script>.',
    author_data: '{"authorName":"tester&co"}',
  };
  const data = buildWorkflowCardData(hostile);
  // Text is passed to satori as plain text, so markup characters survive as
  // literal characters (no HTML escaping is needed or wanted here).
  assert.ok(data.name.includes("</script>"));
  const text = collectText(buildWorkflowCard(data));
  assert.ok(text.includes(hostile.filename), "workflow name should be on the card");
  assert.ok(text.includes("tester&co"), "author should be on the card");
  assert.ok(!text.includes("\u0000"));
});

test("generic card contains no workflow data", () => {
  const generic = collectText(buildGenericCard());
  assert.ok(generic.includes(SITE_NAME));
  assert.ok(generic.includes(SITE_TAGLINE));
  assert.ok(generic.includes(SITE_HOST));
  for (const secret of [PRIVATE_ROW.filename, PRIVATE_ROW.description, "secretowner"]) {
    assert.ok(!generic.includes(secret), `generic card must not contain ${secret}`);
  }
});

test("generic card data is static", () => {
  assert.deepEqual(buildGenericCardData(), {
    name: SITE_TAGLINE,
    description: "Discover and share community Dify workflows.",
    author: SITE_NAME,
    tags: [],
  });
});

test("CJK language hints pick the right satori fallback family", () => {
  // Han only -> simplified Chinese (satori would otherwise pick ja-JP).
  assert.equal(detectCardLanguage("中文工作流"), "zh-CN");
  assert.equal(detectCardLanguage("中文工作流：智能客服与知识库问答系统"), "zh-CN");
  // Kana wins over Han for mixed Japanese text.
  assert.equal(detectCardLanguage("日本語のワークフロー"), "ja-JP");
  assert.equal(detectCardLanguage("한국어 워크플로"), "ko-KR");
  // Latin/ASCII text needs no fallback hint.
  assert.equal(detectCardLanguage("YouTube Transcript Search"), undefined);
  assert.equal(detectCardLanguage(""), undefined);
});

test("normalizeCardLanguage maps page locales to satori languages", () => {
  assert.equal(normalizeCardLanguage("zh"), "zh-CN");
  assert.equal(normalizeCardLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeCardLanguage("zh-Hant"), "zh-TW");
  assert.equal(normalizeCardLanguage("zh-TW"), "zh-TW");
  assert.equal(normalizeCardLanguage("ja"), "ja-JP");
  assert.equal(normalizeCardLanguage("ko"), "ko-KR");
  assert.equal(normalizeCardLanguage("en"), undefined);
  assert.equal(normalizeCardLanguage(""), undefined);
  assert.equal(normalizeCardLanguage(null), undefined);
  assert.equal(normalizeCardLanguage(42), undefined);
});

test("public card data carries the detected language for rendering", () => {
  const cjk = buildWorkflowCardData({
    ...PUBLIC_ROW,
    filename: "智能客服工作流",
    description: "基于知识库的中文问答工作流。",
    tags: '["客服","知识库"]',
    author_data: '{"authorName":"中文作者"}',
  });
  assert.equal(cjk.language, "zh-CN");
  assert.equal(buildWorkflowCardData(PUBLIC_ROW).language, undefined);
  // An explicit page-locale hint wins over auto-detection.
  assert.equal(buildWorkflowCardData(cjkRow(), "zh-TW").language, "zh-TW");
});

function cjkRow() {
  return {
    ...PUBLIC_ROW,
    filename: "繁體中文工作流",
    description: "以知識庫為基礎的工作流。",
    tags: '["客服"]',
  };
}
