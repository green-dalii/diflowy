-- Local D1 seed for the workflow SEO verification harness (issue #13).
-- Schema mirrors the columns used by functions/api/workflow/*.ts and
-- functions/api/workflow/filter.ts.  Idempotent: safe to run repeatedly.
--
-- Rows:
--   ve2dnziba57foh3e   public    "YouTube Transcript Search by Arcmira"
--   specialchars000001 public    name/description containing & " ' </script>
--   privatesecret00001 private   must never be exposed by the edge middleware
--
-- Bindings: D1 (see wrangler.toml).  Run with:
--   npx wrangler d1 execute D1 --local \
--     --persist-to .wrangler/state/v3 --file scripts/seed.sql

DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS yaml_versions;
DROP TABLE IF EXISTS yaml_files;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE yaml_files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    description TEXT,
    tags TEXT DEFAULT '[]',
    icon TEXT,
    is_private INTEGER DEFAULT 0,
    author_data TEXT DEFAULT '{}',
    workspace_id TEXT,
    latest_version TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE yaml_versions (
    id TEXT PRIMARY KEY,
    yaml_file_id TEXT NOT NULL,
    version TEXT NOT NULL,
    file_content BLOB,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT
);

CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);

-- Users referenced by the rows below (private workflow decryption key is
-- derived from users.created_at, so the row must exist even though the
-- middleware is not expected to decrypt).
INSERT INTO users (id, created_at) VALUES
    ('user_public_0001', '2024-01-01T00:00:00Z'),
    ('user_private_001', '2024-01-01T00:00:00Z');

-- ---------------------------------------------------------------------------
-- 1. The regression case from issue #13: public workflow shared as ?id=...
-- ---------------------------------------------------------------------------
INSERT INTO yaml_files
    (id, filename, description, tags, icon, is_private, author_data, workspace_id, latest_version, user_id)
VALUES (
    've2dnziba57foh3e',
    'YouTube Transcript Search by Arcmira',
    'Search YouTube transcripts with this Dify workflow.',
    '["youtube","search","transcript"]',
    '🎥',
    0,
    '{"authorName":"zealous1"}',
    NULL,
    '1.0',
    'user_public_0001'
);

INSERT INTO yaml_versions (id, yaml_file_id, version, file_content, created_at, user_id)
VALUES (
    'ver_public_0001',
    've2dnziba57foh3e',
    '1.0',
    CAST('app:\n  description: "YouTube Transcript Search by Arcmira"\n  icon: video\n  mode: workflow\n  name: YouTube Transcript Search by Arcmira\nkind: app\nversion: 0.1.5\nworkflow:\n  edges: []\n  graph:\n    nodes: []\n  features: {}\n' AS BLOB),
    '2024-06-01T10:00:00Z',
    'user_public_0001'
);

-- ---------------------------------------------------------------------------
-- 2. Public workflow whose name/description need HTML escaping.
--    Contains: &  "  '  and </script>
-- ---------------------------------------------------------------------------
INSERT INTO yaml_files
    (id, filename, description, tags, icon, is_private, author_data, workspace_id, latest_version, user_id)
VALUES (
    'specialchars000001',
    'Tom & Jerry''s "Quote" </script> Workflow',
    'A description with & ampersand, "double quotes", ''single quotes'' and </script><script>alert("xss")</script>.',
    '["test","special&chars"]',
    '⚠️',
    0,
    '{"authorName":"tester&co"}',
    NULL,
    '1.0',
    'user_public_0001'
);

INSERT INTO yaml_versions (id, yaml_file_id, version, file_content, created_at, user_id)
VALUES (
    'ver_special_00001',
    'specialchars000001',
    '1.0',
    CAST('app:\n  description: "Tom & Jerry"\n  icon: warning\n  mode: workflow\n  name: Tom & Jerry''s "Quote" </script> Workflow\nkind: app\nversion: 0.1.5\nworkflow:\n  edges: []\n  graph:\n    nodes: []\n  features: {}\n' AS BLOB),
    '2024-06-02T10:00:00Z',
    'user_public_0001'
);

-- ---------------------------------------------------------------------------
-- 3. Private workflow: must be noindex and its name must not appear in HTML.
-- ---------------------------------------------------------------------------
INSERT INTO yaml_files
    (id, filename, description, tags, icon, is_private, author_data, workspace_id, latest_version, user_id)
VALUES (
    'privatesecret00001',
    'TOP SECRET Private Workflow Name',
    'Private description that must not leak.',
    '["private"]',
    '🔒',
    1,
    '{"authorName":"secretowner"}',
    NULL,
    '1.0',
    'user_private_001'
);

INSERT INTO yaml_versions (id, yaml_file_id, version, file_content, created_at, user_id)
VALUES (
    'ver_private_00001',
    'privatesecret00001',
    '1.0',
    CAST('encrypted-private-blob-placeholder' AS BLOB),
    '2024-06-03T10:00:00Z',
    'user_private_001'
);
