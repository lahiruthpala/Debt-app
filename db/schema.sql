-- Fictional, non-binding roleplay ledger. All amounts are imaginary LKR units.
-- Better Auth's default PostgreSQL schema.
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY,
  "expiresAt" timestamp NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_idx ON "session" ("userId");
CREATE TABLE IF NOT EXISTS "account" (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  scope text,
  password text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_idx ON "account" ("userId");
CREATE TABLE IF NOT EXISTS "verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  handle varchar(24) NOT NULL,
  role varchar(3) NOT NULL CHECK (role IN ('dom','sub')),
  bio varchar(280) NOT NULL DEFAULT '',
  discoverable boolean NOT NULL DEFAULT false,
  adult_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_unique ON profiles (lower(handle));

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY,
  pair_key text NOT NULL UNIQUE,
  sender_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state varchar(10) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','active','declined','ended','blocked')),
  blocked_by text REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS connections_sender_idx ON connections(sender_id);
CREATE INDEX IF NOT EXISTS connections_recipient_idx ON connections(recipient_id);

CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  status varchar(10) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','active','paused','ended')),
  start_principal integer NOT NULL CHECK (start_principal BETWEEN 0 AND 1000000),
  principal integer NOT NULL CHECK (principal BETWEEN 0 AND 2000000),
  interest integer NOT NULL DEFAULT 0 CHECK (interest >= 0),
  penalties integer NOT NULL DEFAULT 0 CHECK (penalties >= 0),
  monthly_rate integer NOT NULL CHECK (monthly_rate BETWEEN 0 AND 30),
  weekly_target integer NOT NULL CHECK (weekly_target BETWEEN 0 AND 100000),
  late_fee integer NOT NULL CHECK (late_fee BETWEEN 0 AND 10000),
  last_interest_at timestamptz,
  last_fee_at timestamptz,
  last_roll_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenes_connection_idx ON scenes(connection_id);

CREATE TABLE IF NOT EXISTS ledger_events (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES profiles(id),
  type varchar(20) NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_events_scene_idx ON ledger_events(scene_id,created_at DESC);

CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  title text NOT NULL,
  reward integer NOT NULL CHECK (reward BETWEEN 0 AND 5000),
  state varchar(12) NOT NULL DEFAULT 'open' CHECK (state IN ('open','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS challenges_scene_idx ON challenges(scene_id,created_at DESC);

-- Community-created, text-driven games. No user-supplied executable code or ledger mutations.
CREATE TABLE IF NOT EXISTS community_games (
  id uuid PRIMARY KEY,
  author_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  summary varchar(240) NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 240),
  category varchar(30) NOT NULL CHECK (char_length(category) BETWEEN 3 AND 30),
  rules text NOT NULL CHECK (char_length(rules) BETWEEN 20 AND 4000),
  opening_prompt varchar(1000) NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_games_discover_idx ON community_games (published, published_at DESC);

CREATE TABLE IF NOT EXISTS community_game_sessions (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES community_games(id) ON DELETE RESTRICT,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  started_by text NOT NULL REFERENCES profiles(id),
  title_snapshot varchar(80) NOT NULL,
  rules_snapshot text NOT NULL,
  prompt_snapshot varchar(1000) NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'active' CHECK (state IN ('active','finished')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_game_sessions_scene_idx
  ON community_game_sessions (scene_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS community_game_sessions_one_active_idx
  ON community_game_sessions (scene_id) WHERE state='active';

CREATE TABLE IF NOT EXISTS community_game_turns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES community_game_sessions(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES profiles(id),
  content varchar(1200) NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_game_turns_session_idx ON community_game_turns (session_id,created_at,id);

CREATE TABLE IF NOT EXISTS community_game_reports (
  game_id uuid NOT NULL REFERENCES community_games(id) ON DELETE CASCADE,
  reporter_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason varchar(500) NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, reporter_id)
);

-- Configurable fantasy debt contracts. Templates are publicly discoverable only
-- when explicitly published; immutable snapshots are attached to scenes.
CREATE TABLE IF NOT EXISTS debt_contract_templates (
  id uuid PRIMARY KEY,
  author_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL,
  description varchar(320) NOT NULL,
  category varchar(30) NOT NULL,
  terms jsonb NOT NULL,
  modules jsonb NOT NULL,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS debt_templates_discover_idx
  ON debt_contract_templates(published,published_at DESC);
CREATE INDEX IF NOT EXISTS debt_templates_author_idx
  ON debt_contract_templates(author_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS scene_contracts (
  scene_id uuid PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,
  template_id uuid REFERENCES debt_contract_templates(id) ON DELETE SET NULL,
  author_id text NOT NULL REFERENCES profiles(id),
  title_snapshot varchar(80) NOT NULL,
  description_snapshot varchar(320) NOT NULL,
  modules_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contract_action_log (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scene_contracts(scene_id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  actor_id text NOT NULL REFERENCES profiles(id),
  action varchar(24) NOT NULL,
  delta integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_actions_scene_idx
  ON contract_action_log(scene_id,created_at DESC);
CREATE INDEX IF NOT EXISTS contract_actions_cooldown_idx
  ON contract_action_log(scene_id,module_id,created_at DESC);

CREATE TABLE IF NOT EXISTS contract_task_claims (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scene_contracts(scene_id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  task_id uuid NOT NULL,
  requested_by text NOT NULL REFERENCES profiles(id),
  reviewed_by text REFERENCES profiles(id),
  state varchar(12) NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','approved','rejected')),
  reward integer NOT NULL CHECK(reward BETWEEN 0 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(scene_id,module_id,task_id)
);
CREATE INDEX IF NOT EXISTS contract_claims_scene_idx
  ON contract_task_claims(scene_id,created_at DESC);

-- Consensual, text-only private contract status. No media uploads or hardware control.
CREATE TABLE IF NOT EXISTS contract_boundary_state (
  scene_id uuid NOT NULL REFERENCES scene_contracts(scene_id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  locked_since timestamptz,
  permission_status varchar(12) CHECK (permission_status IN ('restricted','limited','allowed')),
  release_last_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scene_id,module_id)
);
CREATE TABLE IF NOT EXISTS contract_boundary_requests (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scene_contracts(scene_id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  requester_id text NOT NULL REFERENCES profiles(id),
  reviewed_by text REFERENCES profiles(id),
  kind varchar(16) NOT NULL CHECK (kind IN ('unlock','release','inspection')),
  status varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','completed')),
  note varchar(500) NOT NULL DEFAULT '',
  response varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS contract_boundary_requests_scene_idx
  ON contract_boundary_requests(scene_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contract_boundary_one_open_request
  ON contract_boundary_requests(scene_id,module_id,kind,requester_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS contract_private_journal (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scene_contracts(scene_id) ON DELETE CASCADE,
  module_id uuid NOT NULL,
  author_id text NOT NULL REFERENCES profiles(id),
  body varchar(1000) NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  reply varchar(700),
  replied_by text REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz
);
CREATE INDEX IF NOT EXISTS contract_private_journal_scene_idx
  ON contract_private_journal(scene_id,created_at DESC);
