#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/verify-workflow-seo.sh
#
# Reproducible local verification harness for GitHub issue #13 (per-workflow
# SEO for the Dify workflow detail page) — second wave: path-style URLs,
# per-workflow og:image, tag-alias API, localized titles.
#
# It is idempotent:
#   1. installs npm deps (npm ci with the local cache) if node_modules is missing
#   2. builds the site (astro check + astro build) if dist is missing/stale
#   3. validates the Pages Functions routing config (public/, dist/, repo-root)
#   4. reseeds the local D1 database (scripts/seed.sql: drop + create + 4 rows)
#   5. starts `wrangler pages dev dist` on a free port (default 8788)
#   6. asserts the whole contract, prints observed head lines per case
#   7. always tears the dev server down (trap), exits non-zero on failure
#
# Contract asserted (see task-6):
#   A  path-style EN page `/explore/workflow/<id>`                -> 200
#      exactly one canonical; canonical == og:url ==
#      `<origin>/explore/workflow/<encoded id>` (no trailing slash, no query);
#      title/h1 carry the workflow name; exactly one h1;
#      12/12 hreflang alternates in path form with the id;
#      og:image == og:image:url == og:image:secure_url == twitter:image ==
#      `<origin>/og/workflow.png?id=<encoded id>` (default locale) or the same
#      URL + `&lang=<locale>` on non-default locale pages (frozen tree contract:
#      the card renders CJK correctly only with the hint; raw markup carries
#      `&amp;lang=`), image/png, 1200x630.
#   B  legacy query style (with and without slash) + /ja variant -> 301 to the
#      path form, locale-preserving, no D1; Location is the path form.
#   C  id-less page (en + /ja)                                    -> 302 to
#      `/explore` / `/ja/explore`.
#   D  path-style /ja hostile row `/ja/explore/workflow/<id>`     -> 200,
#      locale canonical, hostile name escaped in text AND attribute contexts,
#      no raw script-terminator/alert injection, 12/12 path hreflang.
#   E  private path page                                          -> 200 +
#      noindex, name/description absent, NO `/og/workflow.png`, keeps og.jpg.
#   F  unknown id                                                 -> 404 +
#      noindex, keeps og.jpg, no `/og/workflow.png`; localized static titles
#      for en/zh/ja/ko (`Workflow | Diflowy`, `工作流 | Diflowy`, ...).
#   G  `/explore/` byte-identical to the built static file (middleware untouched).
#   H  `GET /og/workflow.png?id=<id>` -> 200 image/png, PNG magic, IHDR 1200x630.
#   I  HEAD path page is served (informational status line, not counted).
#   Plus: `_routes.json` (public/, dist/, repo-root) identical with 14 includes
#   (/api/*, 12 workflow patterns, /og/*) + "exclude": []; sitemap has zero
#   id-less `/explore/workflow` URLs; `/api/workflow` 200; D1 has 4 seed rows;
#   tag-alias API (`tags=Finance & Business` -> chinesetag0000001 row,
#   `tags=Productivity` -> rows). The tag-filter UI chip is client-side JS and
#   is NOT asserted here (curl cannot execute it).
#
# Usage:
#   scripts/verify-workflow-seo.sh [--build] [--no-build] [--port N]
#                                  [--keep-server] [--no-ci] [--verbose]
#
#   --build        force `npm run build` even if dist looks fresh
#   --no-build     smoke mode: serve the existing dist as-is (no build; stale-dist
#                  routing mismatches downgrade to warnings). Never a final result.
#   --port N       use a specific port (default 8788, auto-increments if busy)
#   --keep-server  leave `wrangler pages dev` running on exit (debugging)
#   --no-ci        do not run `npm ci` even if node_modules is missing
#   --verbose      also print the observed HTML head of every fetched page
#
# Exit codes: 0 = all assertions passed, 1 = assertion failure,
#             2 = harness/environment problem (install, build, seed, server).
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# --- pin the fixtures to scripts/seed.sql -----------------------------------
PUBLIC_ID="ve2dnziba57foh3e"
PUBLIC_NAME="YouTube Transcript Search by Arcmira"
SPECIAL_ID="specialchars000001"
SPECIAL_LOCALE="ja"
SPECIAL_RAW_NAME='Tom & Jerry'"'"'s "Quote" </script> Workflow'
PRIVATE_ID="privatesecret00001"
PRIVATE_NAME="TOP SECRET Private Workflow Name"
PRIVATE_DESCRIPTION="Private description that must not leak."
CHINESE_TAG_ID="chinesetag0000001"
SITE_NAME="Diflowy"
SEEDED_ROWS="4"

# --- local, sandbox-friendly locations (all under .wrangler/ or .npm-cache/) -
NPM_CACHE="$ROOT/.npm-cache"
WRANGLER_TOOL_DIR="$ROOT/.wrangler/tool"
WRANGLER_BIN=""
PERSIST_DIR="$ROOT/.wrangler/state"
XDG_CONFIG="$ROOT/.wrangler/home"
XDG_CACHE="$ROOT/.wrangler/cache"
LOG_DIR="$ROOT/.wrangler/logs"
BUILD_LOG="$LOG_DIR/build.log"
SEED_LOG="$LOG_DIR/seed.log"
DEV_LOG="$LOG_DIR/pages-dev.log"

# --- options ----------------------------------------------------------------
FORCE_BUILD=0
NO_BUILD=0
KEEP_SERVER=0
RUN_CI=1
VERBOSE=0
PORT_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) FORCE_BUILD=1 ;;
    --no-build) NO_BUILD=1 ;;
    --keep-server) KEEP_SERVER=1 ;;
    --no-ci) RUN_CI=0 ;;
    --verbose|-v) VERBOSE=1 ;;
    --port) shift; PORT_ARG="${1:-}" ;;
    -h|--help) sed -n '2,72p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$LOG_DIR" "$XDG_CONFIG" "$XDG_CACHE" "$PERSIST_DIR"
TMP="$ROOT/.wrangler/tmp/verify-$$"
rm -rf "$TMP"
mkdir -p "$TMP"

export XDG_CONFIG_HOME="$XDG_CONFIG"
export XDG_CACHE_HOME="$XDG_CACHE"
export WRANGLER_SEND_METRICS=false
export WRANGLER_LOG_SANITIZE=true
export CI=1
export NO_COLOR=1

# --- tiny assertion framework ----------------------------------------------
PASS=0
FAIL=0
FAILURES=()
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); FAILURES+=("$*"); printf '  FAIL  %s\n' "$*"; }
check_eq() { if [ "$2" = "$3" ]; then pass "$1 == '$3'"; else fail "$1 (expected '$2', got '$3')"; fi; }
check_contains() { if [[ "$3" == *"$2"* ]]; then pass "$1 contains '$2'"; else fail "$1 (expected to contain '$2')"; fi; }
check_not_contains() { if [[ "$3" != *"$2"* ]]; then pass "$1 does not contain '$2'"; else fail "$1 (must NOT contain '$2')"; fi; }
check_ge() { if [ "${3:-x}" -ge "$2" ] 2>/dev/null; then pass "$1 ($3 >= $2)"; else fail "$1 (expected >= $2, got '${3:-unparsed}')"; fi; }
section() { printf '\n== %s\n' "$*"; }

# --- HTTP helpers -----------------------------------------------------------
FETCH_CODE=""; FETCH_BODY=""; FETCH_HDR=""
fetch() { # fetch <path> <label>  ->  FETCH_CODE, $TMP/<label>.body/.hdr
  local path="$1" label="$2"
  FETCH_CODE=$(curl -sS --max-time 30 -D "$TMP/$label.hdr" -o "$TMP/$label.body" \
    -w '%{http_code}' "$BASE$path" 2>"$TMP/$label.err") || FETCH_CODE="000"
  FETCH_BODY="$TMP/$label.body"
  FETCH_HDR="$TMP/$label.hdr"
  if [ "$FETCH_CODE" = "000" ]; then
    fail "GET $path (curl could not connect: $(head -2 "$TMP/$label.err" | tr '\n' ' '))"
  fi
}
body() { cat "$FETCH_BODY" 2>/dev/null || true; }
header_first() { grep -iE "^$1:" "$FETCH_HDR" 2>/dev/null | head -1 | sed -E "s/^[^:]+: *//; s/\r$//"; }
loc_path() { local v="$1"; if [[ "$v" == "$BASE"* ]]; then echo "${v#"$BASE"}"; else echo "$v"; fi; }

# --- HTML/meta extractors ---------------------------------------------------
first_match() { grep -oE "$1" "$2" 2>/dev/null | head -1 || true; }
canonical_of() { first_match 'rel="canonical" href="[^"]*"' "$1" | sed -E 's/.*href="//; s/"$//'; }
canonical_count() { grep -oE 'rel="canonical"' "$1" 2>/dev/null | wc -l | tr -d ' '; }
ogurl_of() { meta_content "$1" property 'og:url'; }
ogtitle_of() { meta_content "$1" property 'og:title'; }
title_of() { first_match '<title>[^<]*</title>' "$1" | sed -E 's/^<title>//; s/<\/title>$//'; }
h1_count() { grep -oE '<h1[ >]' "$1" 2>/dev/null | wc -l | tr -d ' '; }
h1_text() {
  grep -qE '<h1[ >]' "$1" 2>/dev/null || return 0
  tr -d '\r\n' <"$1" | sed -E 's/.*<h1[^>]*>//; s/<\/h1>.*//'
}
# meta_content <html> <attribute: property|name> <key>  -> content="…" value
meta_content() {
  first_match "$2=\"$3\" content=\"[^\"]*\"" "$1" | sed -E 's/.*content="//; s/"$//'
}
hreflang_tags() { grep -oE '<link rel="alternate"[^>]*>' "$1" 2>/dev/null; }
hreflang_total() { hreflang_tags "$1" | wc -l | tr -d ' '; }
hreflang_with_id() { hreflang_tags "$1" | grep -c "/$2\"" || true; }
actual_hreflangs() { hreflang_tags "$1" | sed -E 's/.*href="([^"]*)".*/\1/'; }
# Non-default locales (plus `en`, unprefixed) => the 12 canonical alternate URLs.
NON_DEFAULT_LOCALES="zh zh-Hant ja ko fr pt es de it ru ar"
expected_hreflangs() { # <workflow id> -> 12 path-form canonical alternate URLs
  local id="$1" loc
  echo "$BASE/explore/workflow/$id"
  for loc in $NON_DEFAULT_LOCALES; do echo "$BASE/$loc/explore/workflow/$id"; done
}
compare_hreflangs() { # <label> <html file> <workflow id>
  local label="$1" f="$2" id="$3" expected actual
  expected=$(expected_hreflangs "$id" | sort)
  actual=$(actual_hreflangs "$f" | sort)
  if [ -n "$actual" ] && [ "$expected" = "$actual" ]; then
    pass "$label hreflang set == exactly the 12 locale path-form URLs with id"
  else
    fail "$label hreflang set mismatch — expected the 12 locale path-form URLs; got: $(actual_hreflangs "$f" | tr '\n' ' ')"
  fi
}
robots_of() { meta_content "$1" name 'robots'; }
png_info() { # png_info <file> -> "<magic-hex> <width> <height> <bytes>"
  node -e '
const fs = require("fs");
const b = fs.readFileSync(process.argv[1]);
const magic = b.subarray(0, 8).toString("hex");
if (b.length < 24) { console.log(`${magic} 0 0 ${b.length}`); process.exit(0); }
console.log(`${magic} ${b.readUInt32BE(16)} ${b.readUInt32BE(20)} ${b.length}`);
' "$1" 2>/dev/null
}

show_head() { # show_head <file>
  local f="$1" pat
  echo "  --- observed head ($(basename "$f")):"
  for pat in '<title>[^<]*</title>' 'rel="canonical" href="[^"]*"' \
    'property="og:url" content="[^"]*"' 'property="og:title" content="[^"]*"' \
    'property="og:site_name" content="[^"]*"' 'property="og:image" content="[^"]*"' \
    'property="og:image:url" content="[^"]*"' \
    'property="og:image:secure_url" content="[^"]*"' \
    'property="og:image:type" content="[^"]*"' \
    'property="og:image:width" content="[^"]*"' \
    'property="og:image:height" content="[^"]*"' \
    'name="twitter:image" content="[^"]*"' '<meta name="robots"[^>]*>'; do
    grep -oE "$pat" "$f" 2>/dev/null | head -2 | sed 's/^/  | /'
  done
  hreflang_tags "$f" | head -4 | sed 's/^/  | /'
}
show_value() { echo "  | $1: $2"; }

# --- teardown ---------------------------------------------------------------
SERVER_PID=""
PORT=""
kill_listener_on_port() {
  [ -n "${PORT:-}" ] || return 0
  command -v lsof >/dev/null 2>&1 || return 0
  local pids p
  pids=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$pids" ] || return 0
  for p in $pids; do kill "$p" 2>/dev/null || true; done
  sleep 0.3
  pids=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  for p in $pids; do kill -9 "$p" 2>/dev/null || true; done
}
cleanup() {
  local rc=$?
  if [ "$KEEP_SERVER" = "1" ] && [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    echo "== --keep-server: leaving wrangler pages dev (pid $SERVER_PID) on $BASE"
    echo "   (kill it later with: kill $SERVER_PID)"
  else
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
      kill "$SERVER_PID" 2>/dev/null || true
      local i
      for i in $(seq 1 40); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.25; done
      kill -9 "$SERVER_PID" 2>/dev/null || true
    fi
    kill_listener_on_port
  fi
  [ -n "$TMP" ] && rm -rf "$TMP"
  exit "${1:-$rc}"
}
trap cleanup EXIT INT TERM

die_harness() { echo; echo "HARNESS ERROR: $*" >&2; exit 2; }

# ---------------------------------------------------------------------------
section "0. environment"
echo "  repo:   $ROOT"
echo "  node:   $(node -v 2>/dev/null || echo missing)  npm: $(npm -v 2>/dev/null || echo missing)"
echo "  git:    $(git rev-parse --short HEAD 2>/dev/null || echo "no-git") ($(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') changed paths)"
echo "  time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$NO_BUILD" = "1" ]; then
  echo "  MODE:   --no-build smoke run against existing dist (NOT a final result)"
else
  echo "  MODE:   normal (build if dist missing/stale)"
fi

# 0a. npm dependencies (reproducible install, never touch package-lock.json)
if [ ! -x "$ROOT/node_modules/.bin/astro" ]; then
  [ "$RUN_CI" = "1" ] || die_harness "node_modules missing and --no-ci was given"
  echo "  installing dependencies: npm ci --cache .npm-cache --no-audit --no-fund"
  if ! npm ci --cache "$NPM_CACHE" --no-audit --no-fund >"$LOG_DIR/npm-ci.log" 2>&1; then
    tail -30 "$LOG_DIR/npm-ci.log" >&2
    die_harness "npm ci failed (log: $LOG_DIR/npm-ci.log)"
  fi
fi

# 0b. wrangler (isolated in .wrangler/tool so package.json/lock stay clean)
find_wrangler() {
  if [ -x "$ROOT/node_modules/.bin/wrangler" ]; then
    WRANGLER_BIN="$ROOT/node_modules/.bin/wrangler"
  elif [ -x "$WRANGLER_TOOL_DIR/node_modules/.bin/wrangler" ]; then
    WRANGLER_BIN="$WRANGLER_TOOL_DIR/node_modules/.bin/wrangler"
  elif command -v wrangler >/dev/null 2>&1; then
    WRANGLER_BIN="$(command -v wrangler)"
  else
    WRANGLER_BIN=""
  fi
}
find_wrangler
if [ -z "$WRANGLER_BIN" ]; then
  echo "  installing wrangler into .wrangler/tool (isolated)"
  mkdir -p "$WRANGLER_TOOL_DIR"
  if [ ! -f "$WRANGLER_TOOL_DIR/package.json" ]; then
    printf '{\n  "name": "diflowy-local-wrangler",\n  "private": true,\n  "version": "0.0.0"\n}\n' \
      >"$WRANGLER_TOOL_DIR/package.json"
  fi
  if ! (cd "$WRANGLER_TOOL_DIR" &&
    npm i wrangler --cache "$NPM_CACHE" --no-audit --no-fund --legacy-peer-deps \
      >"$LOG_DIR/wrangler-install.log" 2>&1); then
    tail -30 "$LOG_DIR/wrangler-install.log" >&2
    die_harness "wrangler install failed (log: $LOG_DIR/wrangler-install.log)"
  fi
  find_wrangler
  [ -n "$WRANGLER_BIN" ] || die_harness "wrangler binary not found after install"
fi
echo "  wrangler: $WRANGLER_BIN ($("$WRANGLER_BIN" --version 2>/dev/null))"

# ---------------------------------------------------------------------------
section "1. build"
MARKER="$ROOT/dist/explore/workflow/index.html"
if [ "$NO_BUILD" = "1" ]; then
  echo "  --no-build: skipping npm run build and dist freshness check"
  [ -f "$MARKER" ] || die_harness "--no-build given but $MARKER is missing"
  echo "  using existing dist marker: $(stat -f '%Sm' "$MARKER" 2>/dev/null || echo unknown)"
else
  NEED_BUILD="$FORCE_BUILD"
  if [ ! -f "$MARKER" ]; then
    NEED_BUILD=1
  elif [ -n "$(find "$ROOT/src" "$ROOT/functions" "$ROOT/public" "$ROOT/astro.config.mjs" \
    -newer "$MARKER" -type f 2>/dev/null | head -1)" ]; then
    NEED_BUILD=1
    echo "  dist is stale (sources newer than $MARKER)"
  fi
  if [ "$NEED_BUILD" = "1" ]; then
    echo "  running: npm run build  (astro check && astro build; log: $BUILD_LOG)"
    if ! npm run build >"$BUILD_LOG" 2>&1; then
      echo "  BUILD FAILED — tail of $BUILD_LOG:" >&2
      sed 's/\x1b\[[0-9;]*m//g' "$BUILD_LOG" | grep -E ' - error|Result \(|error TS' | head -20 >&2
      tail -40 "$BUILD_LOG" >&2
      die_harness "npm run build failed (in-flight edit or real error; log: $BUILD_LOG)"
    fi
    echo "  build ok: $(grep -E 'Complete!|page\(s\) built' "$BUILD_LOG" | tail -1 | sed 's/^ *//')"
    echo "  astro check: $(grep -A2 'Result (' "$BUILD_LOG" | tr '\n' ' ' | sed $'s/\x1b\\[[0-9;]*m//g' | sed 's/  */ /g')"
    echo "  build timestamp (dist page): $(stat -f '%Sm' "$MARKER" 2>/dev/null || echo unknown)"
  else
    echo "  dist looks fresh — skipping build (use --build to force)"
  fi
fi
echo "  built h1 count in dist/explore/workflow/index.html: $(h1_count "$MARKER")"

# 1b. Pages Functions routing config: public/, dist/ and repo-root must all be
#     valid and identical: 14 includes (/api/*, 12 workflow patterns, /og/*)
#     plus "exclude": [].  Source of truth is the repo; a missing/invalid file
#     is a harness failure (no patching ever).
ROUTES_F="$ROOT/dist/_routes.json"
ROUTES_PUBLIC="$ROOT/public/_routes.json"
ROUTES_ROOT="$ROOT/_routes.json"
EXPECTED_INCLUDES="/api/* /explore/workflow* /zh/explore/workflow* /zh-Hant/explore/workflow* /ja/explore/workflow* /ko/explore/workflow* /fr/explore/workflow* /pt/explore/workflow* /es/explore/workflow* /de/explore/workflow* /it/explore/workflow* /ru/explore/workflow* /ar/explore/workflow* /og/*"
EXPECTED_INCLUDE_COUNT=14
ROUTES_STRICT="strict"
[ "$NO_BUILD" = "1" ] && ROUTES_STRICT="warn"

validate_routes_file() { # <path> <label> <strict|warn>
  local f="$1" label="$2" mode="${3:-strict}" diag rc
  if [ ! -f "$f" ]; then
    if [ "$mode" = "warn" ]; then echo "  WARNING: $label _routes.json missing ($f)"; return 0; fi
    die_harness "$label _routes.json missing at $f (expected from public/_routes.json)"
  fi
  diag=$(node -e '
const fs = require("fs");
const f = process.argv[1];
const expected = process.argv[2].split(" ").filter(Boolean);
const expectedCount = Number(process.argv[3]);
let j;
try { j = JSON.parse(fs.readFileSync(f, "utf8")); }
catch (e) { console.error("not valid JSON: " + e.message); process.exit(3); }
if (typeof j !== "object" || j === null || Array.isArray(j)) { console.error("not a JSON object"); process.exit(3); }
if (j.version !== 1) { console.error("version must be the number 1"); process.exit(3); }
if (!Array.isArray(j.include) || j.include.length === 0) { console.error("include must be a non-empty array"); process.exit(3); }
if (!Array.isArray(j.exclude)) { console.error("missing exclude array (add exclude: [] to the file)"); process.exit(3); }
if (j.include.length !== expectedCount) { console.error(`include has ${j.include.length} entries, expected ${expectedCount}`); process.exit(3); }
const missing = expected.filter((p) => !j.include.includes(p));
if (missing.length > 0) { console.error("include is missing: " + missing.join(" ")); process.exit(3); }
console.log(`${j.include.length} include, ${j.exclude.length} exclude`);
' "$f" "$EXPECTED_INCLUDES" "$EXPECTED_INCLUDE_COUNT" 2>&1)
  rc=$?
  if [ "$rc" = "0" ]; then
    echo "  $label _routes.json: $diag"
  elif [ "$mode" = "warn" ]; then
    echo "  WARNING: $label _routes.json invalid for the new contract ($diag) — stale dist in --no-build mode"
  else
    die_harness "$label _routes.json invalid ($f): $diag"
  fi
}
validate_routes_file "$ROUTES_PUBLIC" "public/" "strict"
validate_routes_file "$ROUTES_F" "dist/" "$ROUTES_STRICT"
validate_routes_file "$ROUTES_ROOT" "repo-root" "strict"
routes_equal() { node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));console.log(JSON.stringify(a)===JSON.stringify(b)?"same":"different")' "$1" "$2" 2>/dev/null || echo error; }
if [ -f "$ROUTES_F" ] && [ -f "$ROUTES_PUBLIC" ]; then
  if [ "$(routes_equal "$ROUTES_PUBLIC" "$ROUTES_F")" = "same" ]; then
    echo "  routes public/ == dist/: yes"
  elif [ "$ROUTES_STRICT" = "warn" ]; then
    echo "  WARNING: public/_routes.json and dist/_routes.json differ (stale dist in --no-build mode)"
  else
    die_harness "public/_routes.json and dist/_routes.json disagree (stale build? run with --build)"
  fi
fi
if [ "$(routes_equal "$ROUTES_PUBLIC" "$ROUTES_ROOT")" = "same" ]; then
  echo "  routes public/ == repo-root: yes"
else
  die_harness "public/_routes.json and repo-root _routes.json disagree — they must carry the same rules"
fi

# 1c. the build-time sitemap must not advertise the id-less detail pages.
SM_FILES=$(ls "$ROOT"/dist/sitemap*.xml 2>/dev/null || true)
if [ -z "$SM_FILES" ]; then
  fail "sitemap: no dist/sitemap*.xml found after build"
else
  # shellcheck disable=SC2086
  SM_HITS=$(grep -ho "explore/workflow" $SM_FILES 2>/dev/null | wc -l | tr -d ' ')
  check_eq "sitemap: zero /explore/workflow URLs in dist/sitemap*.xml" "0" "$SM_HITS"
fi

# ---------------------------------------------------------------------------
section "2. seed local D1 (binding D1, persist: $PERSIST_DIR)"
if ! "$WRANGLER_BIN" d1 execute D1 --local --persist-to "$PERSIST_DIR" \
  --file "$ROOT/scripts/seed.sql" >"$SEED_LOG" 2>&1; then
  tail -30 "$SEED_LOG" >&2
  die_harness "wrangler d1 execute (seed) failed (log: $SEED_LOG)"
fi
ROWS=$("$WRANGLER_BIN" d1 execute D1 --local --persist-to "$PERSIST_DIR" \
  --command "SELECT COUNT(*) AS n FROM yaml_files" --json 2>/dev/null |
  grep -oE '"n": *[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
echo "  yaml_files rows: ${ROWS:-unparsed} (expected $SEEDED_ROWS)"
TAG_ROWS=$("$WRANGLER_BIN" d1 execute D1 --local --persist-to "$PERSIST_DIR" \
  --command "SELECT tags FROM yaml_files WHERE id = '$CHINESE_TAG_ID'" --json 2>/dev/null |
  grep -oE '金融与商业' | head -1 || true)
echo "  $CHINESE_TAG_ID tags contain 金融与商业: ${TAG_ROWS:-no}"

# ---------------------------------------------------------------------------
section "3. start wrangler pages dev"
port_busy() {
  command -v lsof >/dev/null 2>&1 || return 1
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}
if [ -n "$PORT_ARG" ]; then
  PORT="$PORT_ARG"
  port_busy "$PORT" && die_harness "port $PORT is already in use (use --port N)"
else
  PORT=8788
  while port_busy "$PORT"; do
    [ "$PORT" -lt 8798 ] || die_harness "no free port in 8788..8798"
    echo "  port $PORT busy, trying $((PORT + 1))"
    PORT=$((PORT + 1))
  done
fi
BASE="http://127.0.0.1:$PORT"
echo "  port: $PORT  (log: $DEV_LOG)"
: >"$DEV_LOG"
"$WRANGLER_BIN" pages dev dist \
  --port "$PORT" \
  --persist-to "$PERSIST_DIR" \
  --log-level=info \
  --show-interactive-dev-session=false \
  >"$DEV_LOG" 2>&1 &
SERVER_PID=$!

READY=0
for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -40 "$DEV_LOG" >&2
    die_harness "wrangler pages dev exited before becoming ready (log: $DEV_LOG)"
  fi
  if curl -sf --max-time 2 -o /dev/null "$BASE/api/workflow?workflowId=$PUBLIC_ID" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done
[ "$READY" = "1" ] || { tail -40 "$DEV_LOG" >&2; die_harness "wrangler pages dev did not become ready within 60s"; }
grep -E 'Ready on|wrangler:info' "$DEV_LOG" | head -3 | sed 's/^/  | /'

# ---------------------------------------------------------------------------
section "4. preflight: /api/workflow (D1 + Functions)"
fetch "/api/workflow?workflowId=$PUBLIC_ID" "api"
check_eq "preflight API status" "200" "$FETCH_CODE"
API_BODY=$(body)
check_contains "preflight API body carries the workflow id" "\"id\":\"$PUBLIC_ID\"" "$API_BODY"

# ---------------------------------------------------------------------------
section "5. tag-alias filter API (/api/workflow/filter)"
fetch "/api/workflow/filter?page=1&pageSize=50&myflow=no&isPrivate=no&tags=Finance%20%26%20Business" "tag_finance"
TAG_FINANCE_BODY=$(body)
TAG_FINANCE_TOTAL=$(echo "$TAG_FINANCE_BODY" | grep -oE '"total":[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
check_eq "tag filter (Finance & Business) status" "200" "$FETCH_CODE"
check_ge "tag filter (Finance & Business) total >= 1" 1 "${TAG_FINANCE_TOTAL:-0}"
check_contains "tag filter (Finance & Business) includes $CHINESE_TAG_ID" "\"id\":\"$CHINESE_TAG_ID\"" "$TAG_FINANCE_BODY"
show_value "Finance & Business -> total" "${TAG_FINANCE_TOTAL:-unparsed}"
show_value "Finance & Business -> ids" "$(echo "$TAG_FINANCE_BODY" | grep -oE '"id":"[^"]*"' | sed -E 's/"id":"//; s/"//' | tr '\n' ' ')"
fetch "/api/workflow/filter?page=1&pageSize=50&myflow=no&isPrivate=no&tags=Productivity" "tag_productivity"
TAG_PROD_BODY=$(body)
TAG_PROD_TOTAL=$(echo "$TAG_PROD_BODY" | grep -oE '"total":[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
check_eq "tag filter (Productivity) status" "200" "$FETCH_CODE"
check_ge "tag filter (Productivity) total >= 1" 1 "${TAG_PROD_TOTAL:-0}"
show_value "Productivity -> total" "${TAG_PROD_TOTAL:-unparsed}"
show_value "Productivity -> ids" "$(echo "$TAG_PROD_BODY" | grep -oE '"id":"[^"]*"' | sed -E 's/"id":"//; s/"//' | tr '\n' ' ')"
echo "  NOTE  the tag-filter UI chip is client-side JS — not asserted here (curl cannot execute it)"

OG_IMAGE_PATH="/og/workflow.png"
og_image_target() { echo "$BASE$OG_IMAGE_PATH?id=$1"; }

# ---------------------------------------------------------------------------
section "6. case A: path-style EN page /explore/workflow/$PUBLIC_ID"
fetch "/explore/workflow/$PUBLIC_ID" "a"
[ "$VERBOSE" = "1" ] && show_head "$FETCH_BODY"
BODY_A=$(body)
CANON_A=$(canonical_of "$FETCH_BODY")
OGURL_A=$(ogurl_of "$FETCH_BODY")
TITLE_A=$(title_of "$FETCH_BODY")
H1N_A=$(h1_count "$FETCH_BODY")
H1_A=$(h1_text "$FETCH_BODY")
HL_TOTAL_A=$(hreflang_total "$FETCH_BODY")
HL_ID_A=$(hreflang_with_id "$FETCH_BODY" "$PUBLIC_ID")
OGIMG_A=$(meta_content "$FETCH_BODY" property 'og:image')
OGIMG_URL_A=$(meta_content "$FETCH_BODY" property 'og:image:url')
OGIMG_SECURE_A=$(meta_content "$FETCH_BODY" property 'og:image:secure_url')
OGIMG_TYPE_A=$(meta_content "$FETCH_BODY" property 'og:image:type')
OGIMG_W_A=$(meta_content "$FETCH_BODY" property 'og:image:width')
OGIMG_H_A=$(meta_content "$FETCH_BODY" property 'og:image:height')
TWIMG_A=$(meta_content "$FETCH_BODY" name 'twitter:image')
check_eq "A status" "200" "$FETCH_CODE"
check_eq "A exactly one canonical tag" "1" "$(canonical_count "$FETCH_BODY")"
check_eq "A canonical exact path form (no trailing slash, no query)" "$BASE/explore/workflow/$PUBLIC_ID" "$CANON_A"
check_eq "A og:url === canonical" "$CANON_A" "$OGURL_A"
check_eq "A <title> == name | Diflowy" "$PUBLIC_NAME | $SITE_NAME" "$TITLE_A"
check_eq "A exactly one <h1>" "1" "$H1N_A"
check_eq "A <h1> == workflow name" "$PUBLIC_NAME" "$H1_A"
check_eq "A hreflang count == 12 (one per locale)" "12" "$HL_TOTAL_A"
check_eq "A all hreflang hrefs carry the path-form id" "12" "$HL_ID_A"
compare_hreflangs "A" "$FETCH_BODY" "$PUBLIC_ID"
check_eq "A og:image == per-workflow PNG URL (no lang hint on default locale)" "$(og_image_target "$PUBLIC_ID")" "$OGIMG_A"
check_not_contains "A default-locale og:image has no lang hint" "lang=" "$OGIMG_A"
check_eq "A og:image:url == og:image" "$OGIMG_A" "$OGIMG_URL_A"
check_eq "A og:image:secure_url == og:image" "$OGIMG_A" "$OGIMG_SECURE_A"
check_eq "A twitter:image == og:image" "$OGIMG_A" "$TWIMG_A"
check_eq "A og:image:type == image/png" "image/png" "$OGIMG_TYPE_A"
check_eq "A og:image:width == 1200" "1200" "$OGIMG_W_A"
check_eq "A og:image:height == 630" "630" "$OGIMG_H_A"
check_eq "A og:site_name == Diflowy" "$SITE_NAME" "$(meta_content "$FETCH_BODY" property 'og:site_name')"
show_value "title" "$TITLE_A"
show_value "canonical" "$CANON_A"
show_value "og:url" "$OGURL_A"
show_value "h1" "$H1_A"
show_value "og:image" "$OGIMG_A"
show_value "hreflang with id" "$HL_ID_A/$HL_TOTAL_A"

# ---------------------------------------------------------------------------
section "7. case B: legacy query style redirects 301 to the path form"
fetch "/explore/workflow/?id=$PUBLIC_ID" "b1"
LOC_B1=$(loc_path "$(header_first 'location')")
check_eq "B1 /explore/workflow/?id= status is 301" "301" "$FETCH_CODE"
check_eq "B1 Location" "/explore/workflow/$PUBLIC_ID" "$LOC_B1"
fetch "/explore/workflow?id=$PUBLIC_ID" "b2"
LOC_B2=$(loc_path "$(header_first 'location')")
check_eq "B2 /explore/workflow?id= (slashless) status is 301" "301" "$FETCH_CODE"
check_eq "B2 Location" "/explore/workflow/$PUBLIC_ID" "$LOC_B2"
fetch "/$SPECIAL_LOCALE/explore/workflow/?id=$SPECIAL_ID" "b3"
LOC_B3=$(loc_path "$(header_first 'location')")
check_eq "B3 /ja/explore/workflow/?id= status is 301" "301" "$FETCH_CODE"
check_eq "B3 Location is locale-preserving" "/$SPECIAL_LOCALE/explore/workflow/$SPECIAL_ID" "$LOC_B3"
show_value "301 Location (en, ?id=)" "$LOC_B1"
show_value "301 Location (en, slashless)" "$LOC_B2"
show_value "301 Location (ja, ?id=)" "$LOC_B3"

# ---------------------------------------------------------------------------
section "8. case C: id-less page redirects 302 to the locale explorer"
fetch "/explore/workflow/" "c1"
LOC_C1=$(loc_path "$(header_first 'location')")
check_eq "C1 /explore/workflow/ status is 302" "302" "$FETCH_CODE"
check_eq "C1 Location" "/explore" "$LOC_C1"
fetch "/$SPECIAL_LOCALE/explore/workflow/" "c2"
LOC_C2=$(loc_path "$(header_first 'location')")
check_eq "C2 /ja/explore/workflow/ status is 302" "302" "$FETCH_CODE"
check_eq "C2 Location is locale-preserving" "/$SPECIAL_LOCALE/explore" "$LOC_C2"
show_value "302 Location (en)" "$LOC_C1"
show_value "302 Location (ja)" "$LOC_C2"

# ---------------------------------------------------------------------------
section "9. case D: hostile row on /$SPECIAL_LOCALE path page"
fetch "/$SPECIAL_LOCALE/explore/workflow/$SPECIAL_ID" "d"
[ "$VERBOSE" = "1" ] && show_head "$FETCH_BODY"
BODY_D=$(body)
CANON_D=$(canonical_of "$FETCH_BODY")
TITLE_D=$(title_of "$FETCH_BODY")
H1N_D=$(h1_count "$FETCH_BODY")
H1_D=$(h1_text "$FETCH_BODY")
HL_TOTAL_D=$(hreflang_total "$FETCH_BODY")
HL_ID_D=$(hreflang_with_id "$FETCH_BODY" "$SPECIAL_ID")
OGTITLE_D=$(ogtitle_of "$FETCH_BODY")
OGDESC_D=$(meta_content "$FETCH_BODY" property 'og:description')
check_eq "D status" "200" "$FETCH_CODE"
check_eq "D exactly one canonical tag" "1" "$(canonical_count "$FETCH_BODY")"
check_eq "D canonical exact locale path form" "$BASE/$SPECIAL_LOCALE/explore/workflow/$SPECIAL_ID" "$CANON_D"
check_eq "D og:url === canonical" "$CANON_D" "$(ogurl_of "$FETCH_BODY")"
check_eq "D exactly one <h1>" "1" "$H1N_D"
check_contains "D title has escaped ampersand" "Tom &amp; Jerry" "$TITLE_D"
check_contains "D title escaped script terminator" "&lt;/script&gt;" "$TITLE_D"
check_contains "D h1 escaped name" "Tom &amp; Jerry" "$H1_D"
check_not_contains "D no raw '</script> Workflow' injection" "</script> Workflow" "$BODY_D"
check_not_contains "D raw special-chars name absent" "$SPECIAL_RAW_NAME" "$BODY_D"
check_not_contains "D no raw '<script>alert(\"xss\")' injection" '<script>alert("xss")' "$BODY_D"
check_not_contains "D no raw alert(\"xss\") text" 'alert("xss")' "$BODY_D"
check_not_contains "D no unescaped raw name in any attribute" "\"Quote\" </script>" "$BODY_D"
check_contains "D og:title attr escapes '&'" "&amp;" "$OGTITLE_D"
check_not_contains "D og:title attr has no raw '<'" "</script>" "$OGTITLE_D"
check_contains "D og:description attr escapes '&'" "&amp;" "$OGDESC_D"
check_not_contains "D og:description attr has no raw '<'" "</script>" "$OGDESC_D"
check_eq "D hreflang count == 12 (one per locale)" "12" "$HL_TOTAL_D"
check_eq "D all hreflang hrefs carry the path-form id" "12" "$HL_ID_D"
compare_hreflangs "D" "$FETCH_BODY" "$SPECIAL_ID"
# meta content is read from raw markup, so the locale hint appears HTML-escaped as &amp;
OGIMG_D_EXPECTED="$(og_image_target "$SPECIAL_ID")&amp;lang=$SPECIAL_LOCALE"
OGIMG_D=$(meta_content "$FETCH_BODY" property 'og:image')
check_eq "D og:image == per-workflow PNG URL + locale hint" "$OGIMG_D_EXPECTED" "$OGIMG_D"
check_eq "D og:image:url == og:image" "$OGIMG_D" "$(meta_content "$FETCH_BODY" property 'og:image:url')"
check_eq "D og:image:secure_url == og:image" "$OGIMG_D" "$(meta_content "$FETCH_BODY" property 'og:image:secure_url')"
check_eq "D twitter:image == og:image" "$OGIMG_D" "$(meta_content "$FETCH_BODY" name 'twitter:image')"
check_eq "D og:image:type == image/png" "image/png" "$(meta_content "$FETCH_BODY" property 'og:image:type')"
check_eq "D og:image:width == 1200" "1200" "$(meta_content "$FETCH_BODY" property 'og:image:width')"
check_eq "D og:image:height == 630" "630" "$(meta_content "$FETCH_BODY" property 'og:image:height')"
check_contains "D raw markup HTML-escapes the locale hint (&amp;lang=ja)" "&amp;lang=$SPECIAL_LOCALE" "$BODY_D"
show_value "title" "$TITLE_D"
show_value "canonical" "$CANON_D"
show_value "h1" "$H1_D"
show_value "og:title (raw attr source)" "$OGTITLE_D"
show_value "og:description (raw attr source)" "$OGDESC_D"
show_value "og:image" "$OGIMG_D"

# ---------------------------------------------------------------------------
section "10. case E: private path page -> 200 noindex, no leak, no per-workflow image"
fetch "/explore/workflow/$PRIVATE_ID" "e"
BODY_E=$(body)
check_eq "E status" "200" "$FETCH_CODE"
check_contains "E robots meta is noindex" "noindex" "$(robots_of "$FETCH_BODY")"
check_not_contains "E private name absent" "$PRIVATE_NAME" "$BODY_E"
check_not_contains "E private description absent" "$PRIVATE_DESCRIPTION" "$BODY_E"
check_not_contains "E no /og/workflow.png reference" "$OG_IMAGE_PATH" "$BODY_E"
check_contains "E keeps the site-wide og.jpg" "og.jpg" "$BODY_E"
check_eq "E static localized title kept (en)" "Workflow | $SITE_NAME" "$(title_of "$FETCH_BODY")"
show_value "status" "$FETCH_CODE"
show_value "robots" "$(robots_of "$FETCH_BODY")"
show_value "title" "$(title_of "$FETCH_BODY")"
show_value "og:image" "$(meta_content "$FETCH_BODY" property 'og:image')"

# ---------------------------------------------------------------------------
section "11. case F: unknown id -> 404 + noindex + localized static titles"
fetch "/explore/workflow/does-not-exist" "f_en"
check_eq "F1 unknown id status is 404 (en)" "404" "$FETCH_CODE"
check_contains "F1 robots meta is noindex" "noindex" "$(robots_of "$FETCH_BODY")"
check_eq "F1 en title" "Workflow | $SITE_NAME" "$(title_of "$FETCH_BODY")"
check_not_contains "F1 no /og/workflow.png reference" "$OG_IMAGE_PATH" "$(body)"
check_contains "F1 keeps the site-wide og.jpg" "og.jpg" "$(body)"
fetch "/zh/explore/workflow/does-not-exist" "f_zh"
check_eq "F2 unknown id status is 404 (zh)" "404" "$FETCH_CODE"
check_eq "F2 zh title" "工作流 | $SITE_NAME" "$(title_of "$FETCH_BODY")"
fetch "/ja/explore/workflow/does-not-exist" "f_ja"
check_eq "F3 unknown id status is 404 (ja)" "404" "$FETCH_CODE"
check_eq "F3 ja title" "ワークフロー | $SITE_NAME" "$(title_of "$FETCH_BODY")"
fetch "/ko/explore/workflow/does-not-exist" "f_ko"
check_eq "F4 unknown id status is 404 (ko)" "404" "$FETCH_CODE"
check_eq "F4 ko title" "워크플로우 | $SITE_NAME" "$(title_of "$FETCH_BODY")"
show_value "en title" "$(title_of "$TMP/f_en.body")"
show_value "zh title" "$(title_of "$TMP/f_zh.body")"
show_value "ja title" "$(title_of "$TMP/f_ja.body")"
show_value "ko title" "$(title_of "$TMP/f_ko.body")"

# ---------------------------------------------------------------------------
section "12. case G: /explore/ untouched (byte-identical to built static file)"
fetch "/explore/" "g"
STATIC_G="$ROOT/dist/explore/index.html"
check_eq "G status" "200" "$FETCH_CODE"
if [ ! -f "$STATIC_G" ]; then
  fail "G static file missing: $STATIC_G"
elif cmp -s "$FETCH_BODY" "$STATIC_G"; then
  pass "G body is byte-identical to dist/explore/index.html ($(wc -c <"$STATIC_G" | tr -d ' ') bytes)"
else
  fail "G body differs from dist/explore/index.html (served $(wc -c <"$FETCH_BODY" | tr -d ' ') bytes, static $(wc -c <"$STATIC_G" | tr -d ' ') bytes)"
  cmp "$FETCH_BODY" "$STATIC_G" 2>/dev/null | head -2 | sed 's/^/  | /' || true
fi
show_value "status" "$FETCH_CODE"

# ---------------------------------------------------------------------------
section "13. case H: per-workflow OG PNG (/og/workflow.png?id=$PUBLIC_ID)"
OG_URL="$(og_image_target "$PUBLIC_ID")"
OG_CODE=$(curl -sS --max-time 120 -D "$TMP/og.hdr" -o "$TMP/og.png" \
  -w '%{http_code}' "$OG_URL" 2>"$TMP/og.err") || OG_CODE="000"
OG_CT=$(grep -iE '^content-type:' "$TMP/og.hdr" 2>/dev/null | head -1 | sed -E 's/^[^:]+: *//; s/\r$//')
OG_INFO=$(png_info "$TMP/og.png")
OG_MAGIC=""; OG_W=""; OG_H=""; OG_BYTES=""
if [ -n "$OG_INFO" ]; then
  # shellcheck disable=SC2086
  set -- $OG_INFO
  OG_MAGIC="$1"; OG_W="$2"; OG_H="$3"; OG_BYTES="$4"
fi
check_eq "H /og/workflow.png?id= status" "200" "$OG_CODE"
check_contains "H content-type is image/png" "image/png" "$OG_CT"
check_eq "H PNG magic bytes" "89504e470d0a1a0a" "$OG_MAGIC"
check_eq "H IHDR width == 1200" "1200" "$OG_W"
check_eq "H IHDR height == 630" "630" "$OG_H"
check_ge "H PNG size sane (> 5 KB)" 5000 "${OG_BYTES:-0}"
show_value "status" "$OG_CODE"
show_value "content-type" "$OG_CT"
show_value "magic (hex)" "$OG_MAGIC"
show_value "IHDR" "${OG_W}x${OG_H}"
show_value "bytes" "$OG_BYTES"
OG_JA_URL="$(og_image_target "$SPECIAL_ID")&lang=$SPECIAL_LOCALE"
OG_JA_CODE=$(curl -sS --max-time 120 -D "$TMP/og_ja.hdr" -o "$TMP/og_ja.png" \
  -w '%{http_code}' "$OG_JA_URL" 2>"$TMP/og_ja.err") || OG_JA_CODE="000"
OG_JA_CT=$(grep -iE '^content-type:' "$TMP/og_ja.hdr" 2>/dev/null | head -1 | sed -E 's/^[^:]+: *//; s/\r$//')
OG_JA_INFO=$(png_info "$TMP/og_ja.png")
OG_JA_MAGIC=""; OG_JA_W=""; OG_JA_H=""
if [ -n "$OG_JA_INFO" ]; then
  # shellcheck disable=SC2086
  set -- $OG_JA_INFO
  OG_JA_MAGIC="$1"; OG_JA_W="$2"; OG_JA_H="$3"
fi
check_eq "H2 locale-hinted OG PNG status (&lang=$SPECIAL_LOCALE)" "200" "$OG_JA_CODE"
check_contains "H2 content-type is image/png" "image/png" "$OG_JA_CT"
check_eq "H2 PNG magic bytes" "89504e470d0a1a0a" "$OG_JA_MAGIC"
check_eq "H2 IHDR is 1200x630" "1200x630" "${OG_JA_W}x${OG_JA_H}"
show_value "H2 status (locale-hinted)" "$OG_JA_CODE"
show_value "H2 content-type" "$OG_JA_CT"
show_value "H2 IHDR" "${OG_JA_W}x${OG_JA_H}"

# ---------------------------------------------------------------------------
section "14. case I: HEAD path page (informational — the frozen tree adds HEAD support)"
HEAD_CODE=$(curl -sS --max-time 60 --head -o /dev/null -w '%{http_code}' \
  "$BASE/explore/workflow/$PUBLIC_ID" 2>/dev/null) || HEAD_CODE="000"
echo "  INFO  HEAD /explore/workflow/$PUBLIC_ID -> $HEAD_CODE (not counted; GET contract is asserted above)"

# ---------------------------------------------------------------------------
section "summary"
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "  failures:"
  printf '   - %s\n' "${FAILURES[@]}"
  echo
  echo "  --- diagnose: functions/_middleware.ts exists: $([ -f "$ROOT/functions/_middleware.ts" ] && echo yes || echo NO)"
  echo "  --- functions/og/ exists: $([ -d "$ROOT/functions/og" ] && echo yes || echo NO)"
  echo
  echo "  --- last 25 lines of wrangler log ($DEV_LOG):"
  tail -25 "$DEV_LOG" | sed 's/^/  | /'
  exit 1
fi
echo "  all workflow SEO assertions passed"
exit 0
