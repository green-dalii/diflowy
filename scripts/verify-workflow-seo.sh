#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/verify-workflow-seo.sh
#
# Reproducible local verification harness for GitHub issue #13:
# per-workflow <title>/canonical/og:url/h1/hreflang for
# /explore/workflow/?id=<workflow-id>, rewritten by the Cloudflare Pages
# Functions middleware (functions/_middleware.ts) from D1.
#
# It is idempotent:
#   1. installs npm deps (npm ci, local cache) if node_modules is missing
#   2. builds the site (astro check + astro build) if dist is missing/stale
#   3. reseeds the local D1 database (scripts/seed.sql: drop + create + 3 rows)
#   4. starts `wrangler pages dev dist` on a free port (default 8788)
#   5. asserts the issue #13 contract, prints observed values:
#        A  /explore/workflow/?id=public   -> 200, exact canonical/og:url/h1/title,
#           12/12 hreflang alternates in the served slash form
#        B  /explore/workflow/ (no id)     -> 302 -> /explore
#        C  /ja/explore/workflow/?id=hostile -> escaped text AND attribute contexts
#        D  private workflow id            -> 200 + noindex, name/description absent
#        E  /explore/                      -> byte-identical to dist/explore/index.html
#        F  slashless /explore/workflow?id= -> Pages' own 308 to the slash form
#        G  unknown workflow id            -> 404 + noindex
#       plus: sitemap has zero /explore/workflow URLs, public//dist//root
#       _routes.json are valid and identical, D1 seeding and API preflight.
#   6. always tears the dev server down (trap), exits non-zero on failure
#
# Usage:
#   scripts/verify-workflow-seo.sh [--build] [--port N] [--keep-server]
#                                  [--no-ci] [--verbose]
#
#   --build        force `npm run build` even if dist looks fresh
#   --port N       use a specific port (default 8788, auto-increments if busy)
#   --keep-server  leave `wrangler pages dev` running on exit (debugging)
#   --no-ci        do not run `npm ci` even if node_modules is missing
#   --verbose      also print the full HTML head of every fetched page
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
SITE_ORIGIN="https://diflowy.greenerai.top"

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
KEEP_SERVER=0
RUN_CI=1
VERBOSE=0
PORT_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) FORCE_BUILD=1 ;;
    --keep-server) KEEP_SERVER=1 ;;
    --no-ci) RUN_CI=0 ;;
    --verbose|-v) VERBOSE=1 ;;
    --port) shift; PORT_ARG="${1:-}" ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
check_matches() { if [[ "$3" =~ $2 ]]; then pass "$1 matches /$2/ (value: '$3')"; else fail "$1 (value '$3' does not match /$2/)"; fi; }
# The middleware derives the canonical origin from the incoming request, so locally
# it is http://127.0.0.1:<port> and in production https://diflowy.greenerai.top.
check_origin() { if [[ "$2" == "$BASE"* || "$2" == "$SITE_ORIGIN"* ]]; then pass "$1 (value: '$2')"; else fail "$1 (expected origin $BASE or $SITE_ORIGIN, got '$2')"; fi; }
section() { printf '\n== %s\n' "$*"; }

# --- HTTP helpers -----------------------------------------------------------
FETCH_CODE=""; FETCH_BODY=""; FETCH_HDR=""
fetch() { # fetch <path> <label>
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

# extractors (HTML is escaped by the server; these operate on raw markup)
first_match() { grep -oE "$1" "$2" 2>/dev/null | head -1 || true; }
canonical_of() { first_match 'rel="canonical" href="[^"]*"' "$1" | sed -E 's/.*href="//; s/"$//'; }
canonical_count() { grep -oE 'rel="canonical"' "$1" 2>/dev/null | wc -l | tr -d ' '; }
ogurl_of() { first_match 'property="og:url" content="[^"]*"' "$1" | sed -E 's/.*content="//; s/"$//'; }
ogtitle_of() { first_match 'property="og:title" content="[^"]*"' "$1" | sed -E 's/.*content="//; s/"$//'; }
title_of() { first_match '<title>[^<]*</title>' "$1" | sed -E 's/^<title>//; s/<\/title>$//'; }
h1_count() { grep -oE '<h1[ >]' "$1" 2>/dev/null | wc -l | tr -d ' '; }
h1_text() {
  grep -qE '<h1[ >]' "$1" 2>/dev/null || return 0
  tr -d '\r\n' <"$1" | sed -E 's/.*<h1[^>]*>//; s/<\/h1>.*//'
}
hreflang_tags() { grep -oE '<link rel="alternate"[^>]*>' "$1" 2>/dev/null; }
hreflang_total() { hreflang_tags "$1" | wc -l | tr -d ' '; }
hreflang_with_id() { hreflang_tags "$1" | grep -c "id=$2" || true; }
# Non-default locales, in the order src/pages advertises them (plus `en`, unprefixed).
NON_DEFAULT_LOCALES="zh zh-Hant ja ko fr pt es de it ru ar"
expected_hreflangs() { # <workflow id> -> the 12 canonical alternate URLs
  local id="$1" loc
  echo "$BASE/explore/workflow/?id=$id"
  for loc in $NON_DEFAULT_LOCALES; do echo "$BASE/$loc/explore/workflow/?id=$id"; done
}
actual_hreflangs() { hreflang_tags "$1" | sed -E 's/.*href="([^"]*)".*/\1/'; }
compare_hreflangs() { # <label> <html file> <workflow id>
  local label="$1" f="$2" id="$3" expected actual
  expected=$(expected_hreflangs "$id" | sort)
  actual=$(actual_hreflangs "$f" | sort)
  if [ -n "$actual" ] && [ "$expected" = "$actual" ]; then
    pass "$label hreflang set == exactly the 12 locale canonical URLs (slash form + ?id=)"
  else
    fail "$label hreflang set mismatch — expected the 12 locale slash-form URLs; got: $(actual_hreflangs "$f" | tr '\n' ' ')"
  fi
}
robots_of() { first_match 'name="robots" content="[^"]*"' "$1" | sed -E 's/.*content="//; s/"$//'; }

show_head() { # show_head <file>
  local f="$1" pat
  echo "  --- observed head ($(basename "$f")):"
  for pat in '<title>[^<]*</title>' 'rel="canonical" href="[^"]*"' 'property="og:url" content="[^"]*"' 'property="og:title" content="[^"]*"' '<meta name="robots"[^>]*>'; do
    grep -oE "$pat" "$f" 2>/dev/null | head -2 | sed 's/^/  | /'
  done
  hreflang_tags "$f" | head -4 | sed 's/^/  | /'
}
show_value() { echo "  | $1: $2"; }

# --- teardown ---------------------------------------------------------------
SERVER_PID=""
kill_listener_on_port() {
  [ -n "${PORT:-}" ] || return 0
  command -v lsof >/dev/null 2>&1 || return 0
  local pids
  pids=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$pids" ] || return 0
  local p
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
  # stop `npm ci`/`npm run build` leaving the tree dirty never happens here; we
  # only ever write inside dist/ (gitignored), .wrangler/ and .npm-cache/.
  exit "${1:-$rc}"
}
trap cleanup EXIT INT TERM

die_harness() { echo; echo "HARNESS ERROR: $*" >&2; exit 2; }

# ---------------------------------------------------------------------------
section "0. environment"
echo "  repo:   $ROOT"
echo "  node:   $(node -v 2>/dev/null || echo missing)  npm: $(npm -v 2>/dev/null || echo missing)"
echo "  git:    $(git rev-parse --short HEAD 2>/dev/null || echo "no-git") ($(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') changed paths — tree is in flux while the fix lands)"
echo "  time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 0a. npm dependencies (reproducible install, never touch package-lock.json)
if [ ! -x "$ROOT/node_modules/.bin/astro" ]; then
  [ "$RUN_CI" = "1" ] || die_harness "node_modules missing and --no-ci was given"
  echo "  installing dependencies: npm ci --cache .npm-cache --no-audit --no-fund"
  if ! npm ci --cache "$NPM_CACHE" --no-audit --no-fund >"$LOG_DIR/npm-ci.log" 2>&1; then
    tail -30 "$LOG_DIR/npm-ci.log" >&2
    die_harness "npm ci failed (log: $LOG_DIR/npm-ci.log)"
  fi
fi

# 0b. wrangler (installed isolated in .wrangler/tool so package.json/lock stay clean)
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
  echo "  installing wrangler into .wrangler/tool (isolated, --no-save semantics)"
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
    tail -40 "$BUILD_LOG" >&2
    die_harness "npm run build failed — the tree is probably broken by an in-flight edit; fix and re-run"
  fi
  echo "  build ok: $(grep -E 'Complete!|page\(s\) built' "$BUILD_LOG" | tail -1 | sed 's/^ *//')"
  echo "  astro check: $(grep -A2 'Result (' "$BUILD_LOG" | tr '\n' ' ' | sed $'s/\\x1b\\[[0-9;]*m//g' | sed 's/  */ /g')"
else
  echo "  dist looks fresh — skipping build (use --build to force)"
fi
echo "  built h1 count in dist/explore/workflow/index.html: $(h1_count "$MARKER")"

# Pages Functions routing contract.
# dist/_routes.json is copied from public/_routes.json, and the repo-root
# _routes.json is the tracked twin that must agree with it.  wrangler pages dev
# requires the `exclude` array (Cloudflare treats it as optional, `exclude: []`
# is semantically identical), and every locale's workflow detail path must be
# included or the middleware never runs there.  Source of truth is the repo:
# this harness does NOT patch or synthesize the file — a missing/invalid file
# fails the run loudly.
ROUTES_F="$ROOT/dist/_routes.json"
ROUTES_PUBLIC="$ROOT/public/_routes.json"
ROUTES_ROOT="$ROOT/_routes.json"
EXPECTED_INCLUDES="/api/* /explore/workflow* /zh/explore/workflow* /zh-Hant/explore/workflow* /ja/explore/workflow* /ko/explore/workflow* /fr/explore/workflow* /pt/explore/workflow* /es/explore/workflow* /de/explore/workflow* /it/explore/workflow* /ru/explore/workflow* /ar/explore/workflow*"

validate_routes_file() { # validate_routes_file <path> <label>
  local f="$1" label="$2" diag rc
  [ -f "$f" ] || die_harness "$label _routes.json missing at $f (expected from public/_routes.json; refusing to patch it)"
  diag=$(node -e '
const fs = require("fs");
const f = process.argv[1];
const expected = process.argv[2].split(" ").filter(Boolean);
let j;
try { j = JSON.parse(fs.readFileSync(f, "utf8")); }
catch (e) { console.error("not valid JSON: " + e.message); process.exit(3); }
if (typeof j !== "object" || j === null || Array.isArray(j)) { console.error("not a JSON object"); process.exit(3); }
if (j.version !== 1) { console.error("version must be the number 1"); process.exit(3); }
if (!Array.isArray(j.include) || j.include.length === 0) { console.error("include must be a non-empty array"); process.exit(3); }
if (!Array.isArray(j.exclude)) { console.error("missing \"exclude\" array (wrangler pages dev rejects the file; add \"exclude\": [])"); process.exit(3); }
const missing = expected.filter((p) => !j.include.includes(p));
if (missing.length > 0) { console.error("include is missing required workflow/api routes: " + missing.join(" ")); process.exit(3); }
console.log(`${j.include.length} include, ${j.exclude.length} exclude`);
' "$f" "$3" 2>&1)
  rc=$?
  [ "$rc" = "0" ] || die_harness "$label _routes.json invalid ($f): $diag"
  echo "  $label _routes.json: $diag"
  echo "    include: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).include.join(" "))' "$f")"
}
validate_routes_file "$ROUTES_PUBLIC" "public/" "$EXPECTED_INCLUDES"
validate_routes_file "$ROUTES_F" "dist/" "$EXPECTED_INCLUDES"
validate_routes_file "$ROUTES_ROOT" "repo-root" "$EXPECTED_INCLUDES"
routes_equal() { node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const b=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));console.log(JSON.stringify(a)===JSON.stringify(b)?"same":"different")' "$1" "$2"; }
[ "$(routes_equal "$ROUTES_PUBLIC" "$ROUTES_F")" = "same" ] || die_harness "public/_routes.json and dist/_routes.json disagree (stale build? run with --build)"
[ "$(routes_equal "$ROUTES_PUBLIC" "$ROUTES_ROOT")" = "same" ] || die_harness "public/_routes.json and repo-root _routes.json disagree — they must carry the same include/exclude rules"
echo "  routes files agree (public/ == dist/ == repo-root): yes"

# 1b. the build-time sitemap must not advertise the id-less detail pages.
SM_FILES=$(ls "$ROOT"/dist/sitemap*.xml 2>/dev/null || true)
if [ -z "$SM_FILES" ]; then
  fail "sitemap: no dist/sitemap*.xml found after build"
else
  # shellcheck disable=SC2086
  SM_HITS=$(grep -ho "explore/workflow" $SM_FILES 2>/dev/null | wc -l | tr -d ' ')
  check_eq "sitemap: zero /explore/workflow URLs in $(basename "$(echo "$SM_FILES" | head -1)")…" "0" "$SM_HITS"
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
echo "  yaml_files rows: ${ROWS:-unparsed} (expected 3)"

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

# preflight: proves D1 + Functions are wired, so later failures are page bugs
section "4. preflight: /api/workflow?workflowId=$PUBLIC_ID (D1 + Functions)"
fetch "/api/workflow?workflowId=$PUBLIC_ID" "api"
check_eq "preflight API status" "200" "$FETCH_CODE"
API_BODY=$(body)
check_contains "preflight API body carries the workflow id" "\"id\":\"$PUBLIC_ID\"" "$API_BODY"

# ---------------------------------------------------------------------------
section "5. case A: /explore/workflow/?id=$PUBLIC_ID (canonical/title/h1/hreflang)"
fetch "/explore/workflow/?id=$PUBLIC_ID" "a"
if [ "$VERBOSE" = "1" ]; then show_head "$FETCH_BODY" 20; fi
BODY_A=$(body)
CANON_A=$(canonical_of "$FETCH_BODY")
OGURL_A=$(ogurl_of "$FETCH_BODY")
TITLE_A=$(title_of "$FETCH_BODY")
H1N_A=$(h1_count "$FETCH_BODY")
H1_A=$(h1_text "$FETCH_BODY")
HL_TOTAL_A=$(hreflang_total "$FETCH_BODY")
HL_ID_A=$(hreflang_with_id "$FETCH_BODY" "$PUBLIC_ID")
check_eq "A status" "200" "$FETCH_CODE"
check_eq "A exactly one canonical tag" "1" "$(canonical_count "$FETCH_BODY")"
check_origin "A canonical origin is request origin or site origin" "$CANON_A"
# exact served shape: /<locale?>/explore/workflow/?id=<id> (trailing slash, exactly one / before ?id=)
check_eq "A canonical exact served slash form" "$BASE/explore/workflow/?id=$PUBLIC_ID" "$CANON_A"
check_eq "A og:url === canonical" "$CANON_A" "$OGURL_A"
check_eq "A og:site_name is Diflowy" "Diflowy" "$(first_match 'property="og:site_name" content="[^"]*"' "$FETCH_BODY" | sed -E 's/.*content="//; s/"$//')"
check_contains "A <title> has workflow name" "$PUBLIC_NAME" "$TITLE_A"
check_eq "A exactly one <h1>" "1" "$H1N_A"
check_contains "A <h1> has workflow name" "$PUBLIC_NAME" "$H1_A"
check_eq "A hreflang count == 12 (one per locale)" "12" "$HL_TOTAL_A"
check_eq "A all hreflang hrefs carry ?id=" "12" "$HL_ID_A"
compare_hreflangs "A" "$FETCH_BODY" "$PUBLIC_ID"
show_value "title" "$TITLE_A"
show_value "canonical" "$CANON_A"
show_value "og:url" "$OGURL_A"
show_value "h1" "$H1_A"
show_value "hreflang with id" "$HL_ID_A/$HL_TOTAL_A"

# ---------------------------------------------------------------------------
section "6. case B: /explore/workflow/ without id (301/302 -> /explore)"
fetch "/explore/workflow/" "b"
LOCATION_B=$(header_first 'location')
check_eq "B status is 302" "302" "$FETCH_CODE"
if [[ "$LOCATION_B" =~ ^/explore/?$ || "$LOCATION_B" =~ ^https?://[^/]+/explore/?$ ]]; then
  pass "B Location points at /explore (value: '$LOCATION_B')"
else
  fail "B Location (expected /explore or absolute /explore, got '$LOCATION_B')"
fi
show_value "status" "$FETCH_CODE"
show_value "location" "$LOCATION_B"

# ---------------------------------------------------------------------------
section "7. case C: /$SPECIAL_LOCALE/explore/workflow/?id=$SPECIAL_ID (escaping + locale)"
fetch "/$SPECIAL_LOCALE/explore/workflow/?id=$SPECIAL_ID" "c"
if [ "$VERBOSE" = "1" ]; then show_head "$FETCH_BODY" 20; fi
BODY_C=$(body)
CANON_C=$(canonical_of "$FETCH_BODY")
OGURL_C=$(ogurl_of "$FETCH_BODY")
TITLE_C=$(title_of "$FETCH_BODY")
H1N_C=$(h1_count "$FETCH_BODY")
H1_C=$(h1_text "$FETCH_BODY")
HL_TOTAL_C=$(hreflang_total "$FETCH_BODY")
HL_ID_C=$(hreflang_with_id "$FETCH_BODY" "$SPECIAL_ID")
check_eq "C status" "200" "$FETCH_CODE"
check_origin "C canonical origin is request origin or site origin" "$CANON_C"
check_eq "C canonical exact served slash form (locale-prefixed)" "$BASE/$SPECIAL_LOCALE/explore/workflow/?id=$SPECIAL_ID" "$CANON_C"
check_eq "C og:url === canonical" "$CANON_C" "$OGURL_C"
check_eq "C exactly one <h1>" "1" "$H1N_C"
# escaping: '&' must be escaped in text/attribute contexts
check_contains "C title has escaped ampersand" "Tom &amp; Jerry" "$TITLE_C$H1_C"
# injection: the raw name/description must never appear unescaped
check_not_contains "C no raw '</script> Workflow' injection" "</script> Workflow" "$BODY_C"
check_not_contains "C raw special-chars name absent" "$SPECIAL_RAW_NAME" "$BODY_C"
check_not_contains "C no raw '<script>alert(\"xss\")' injection" '<script>alert("xss")' "$BODY_C"
check_not_contains "C no raw alert(\"xss\") text" 'alert("xss")' "$BODY_C"
check_not_contains "C no unescaped raw name in any attribute" "\"Quote\" </script>" "$BODY_C"
# Attribute context: the page's static og:/twitter:/description meta tags are
# rewritten through HTMLRewriter.setAttribute.  Everything inside content="..."
# must be HTML-escaped too, otherwise scrapers with non-spec parsers can mangle
# titles/descriptions that contain '&' or '<'.
OGTITLE_C=$(first_match 'property="og:title" content="[^"]*"' "$FETCH_BODY" | sed -E 's/.*content="//; s/"$//')
OGDESC_C=$(first_match 'property="og:description" content="[^"]*"' "$FETCH_BODY" | sed -E 's/.*content="//; s/"$//')
check_contains "C og:title attr escapes '&'" "&amp;" "$OGTITLE_C"
check_not_contains "C og:title attr has no raw '<'" "</script>" "$OGTITLE_C"
check_contains "C og:description attr escapes '&'" "&amp;" "$OGDESC_C"
check_not_contains "C og:description attr has no raw '<'" "</script>" "$OGDESC_C"
check_eq "C hreflang count == 12 (one per locale)" "12" "$HL_TOTAL_C"
check_eq "C all hreflang hrefs carry ?id=" "12" "$HL_ID_C"
compare_hreflangs "C" "$FETCH_BODY" "$SPECIAL_ID"
show_value "title" "$TITLE_C"
show_value "canonical" "$CANON_C"
show_value "og:url" "$OGURL_C"
show_value "h1" "$H1_C"
show_value "og:title (raw attr source)" "$OGTITLE_C"
show_value "og:description (raw attr source)" "$OGDESC_C"
show_value "hreflang with id" "$HL_ID_C/$HL_TOTAL_C"

# ---------------------------------------------------------------------------
section "8. case D: private workflow ?id=$PRIVATE_ID (noindex, no name leak)"
fetch "/explore/workflow/?id=$PRIVATE_ID" "d"
BODY_D=$(body)
ROBOTS_D=$(robots_of "$FETCH_BODY")
check_eq "D status" "200" "$FETCH_CODE"
check_contains "D robots meta is noindex" "noindex" "$ROBOTS_D"
check_not_contains "D private name absent" "$PRIVATE_NAME" "$BODY_D"
check_not_contains "D private description absent" "$PRIVATE_DESCRIPTION" "$BODY_D"
show_value "status" "$FETCH_CODE"
show_value "robots" "$ROBOTS_D"
show_value "title" "$(title_of "$FETCH_BODY")"

# ---------------------------------------------------------------------------
section "9. case E: /explore/ untouched (byte-identical to built static file)"
fetch "/explore/" "e"
STATIC_E="$ROOT/dist/explore/index.html"
check_eq "E status" "200" "$FETCH_CODE"
if [ ! -f "$STATIC_E" ]; then
  fail "E static file missing: $STATIC_E"
elif cmp -s "$FETCH_BODY" "$STATIC_E"; then
  pass "E body is byte-identical to dist/explore/index.html ($(wc -c <"$STATIC_E" | tr -d ' ') bytes)"
else
  fail "E body differs from dist/explore/index.html (served $(wc -c <"$FETCH_BODY" | tr -d ' ') bytes, static $(wc -c <"$STATIC_E" | tr -d ' ') bytes)"
  cmp "$FETCH_BODY" "$STATIC_E" 2>/dev/null | head -2 | sed 's/^/  | /' || true
fi
show_value "status" "$FETCH_CODE"

# ---------------------------------------------------------------------------
section "10. case F: slashless /explore/workflow?id= keeps Pages' own 308 (middleware adds none)"
SLASH_CODE=$(curl -sS --head --max-time 30 -D "$TMP/slash.hdr" -o /dev/null \
  -w '%{http_code}' "$BASE/explore/workflow?id=$PUBLIC_ID" 2>"$TMP/slash.err") || SLASH_CODE="000"
LOC_SLASH=$(grep -iE '^location:' "$TMP/slash.hdr" 2>/dev/null | head -1 | sed -E 's/^[^:]+: *//; s/\r$//')
check_eq "F status is 308" "308" "$SLASH_CODE"
case "$LOC_SLASH" in
  "$BASE/explore/workflow/?id=$PUBLIC_ID"|"/explore/workflow/?id=$PUBLIC_ID")
    pass "F Location is the served slash form (value: '$LOC_SLASH')" ;;
  *)
    fail "F Location (expected /explore/workflow/?id=$PUBLIC_ID, got '$LOC_SLASH')" ;;
esac
show_value "status" "$SLASH_CODE"
show_value "location" "$LOC_SLASH"

# ---------------------------------------------------------------------------
section "11. case G: unknown workflow id -> 404 + noindex"
fetch "/explore/workflow/?id=unknownworkflowid0001" "g"
check_eq "G status" "404" "$FETCH_CODE"
check_contains "G robots meta is noindex" "noindex" "$(robots_of "$FETCH_BODY")"
show_value "status" "$FETCH_CODE"
show_value "robots" "$(robots_of "$FETCH_BODY")"
show_value "title" "$(title_of "$FETCH_BODY")"

# ---------------------------------------------------------------------------
section "summary"
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "  failures:"
  printf '   - %s\n' "${FAILURES[@]}"
  echo
  echo "  --- diagnose: functions/_middleware.ts exists: $([ -f "$ROOT/functions/_middleware.ts" ] && echo yes || echo NO)"
  if [ -f "$ROUTES_F" ]; then
    echo "  --- dist/_routes.json: $(tr -d '\n' <"$ROUTES_F")"
  fi
  echo
  echo "  --- last 25 lines of wrangler log ($DEV_LOG):"
  tail -25 "$DEV_LOG" | sed 's/^/  | /'
  exit 1
fi
echo "  all workflow SEO assertions passed"
exit 0
