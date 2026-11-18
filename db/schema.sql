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

-- Opt-in adult member showcase. All fields and activity/stat visibility default private.
CREATE TABLE IF NOT EXISTS profile_showcases (
  user_id text PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  display_name varchar(40) NOT NULL DEFAULT '',
  tagline varchar(120) NOT NULL DEFAULT '',
  likes jsonb NOT NULL DEFAULT '[]'::jsonb,
  dislikes jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedication varchar(400) NOT NULL DEFAULT '',
  boundaries varchar(400) NOT NULL DEFAULT '',
  showcase_enabled boolean NOT NULL DEFAULT false,
  show_stats boolean NOT NULL DEFAULT false,
  show_achievements boolean NOT NULL DEFAULT false,
  show_activity boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showcase_likes_array CHECK(jsonb_typeof(likes)='array'),
  CONSTRAINT showcase_dislikes_array CHECK(jsonb_typeof(dislikes)='array')
);
-- Existing installs gain private, member-selected featured achievement IDs.
ALTER TABLE profile_showcases ADD COLUMN IF NOT EXISTS featured_badges jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE profile_showcases DROP CONSTRAINT IF EXISTS profile_showcases_featured_badges_check;
ALTER TABLE profile_showcases ADD CONSTRAINT profile_showcases_featured_badges_check
  CHECK (jsonb_typeof(featured_badges)='array' AND jsonb_array_length(featured_badges)<=3);

-- Immutable initial award dates. Profiles and notifications are automatically
-- removed on user deletion. Only server-calculated badge IDs may be inserted.
CREATE TABLE IF NOT EXISTS profile_badge_unlocks (
  user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id varchar(64) NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,badge_id)
);
-- Index preselected likes without ever exposing an unpublished showcase.
CREATE INDEX IF NOT EXISTS profile_showcases_likes_gin ON profile_showcases USING gin(likes);


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
  game_id uuid REFERENCES community_games(id) ON DELETE RESTRICT,
  official_key varchar(60),
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
  official_node_id varchar(48),
  official_choice_id varchar(48),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_game_turns_session_idx ON community_game_turns (session_id,created_at,id);

-- Add curated story support to previously deployed databases without changing old sessions.
ALTER TABLE community_game_sessions ALTER COLUMN game_id DROP NOT NULL;
ALTER TABLE community_game_sessions ADD COLUMN IF NOT EXISTS official_key varchar(60);
ALTER TABLE community_game_turns ADD COLUMN IF NOT EXISTS official_node_id varchar(48);
ALTER TABLE community_game_turns ADD COLUMN IF NOT EXISTS official_choice_id varchar(48);

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
  category_snapshot varchar(30) NOT NULL DEFAULT 'Custom',
  modules_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve a contract's category when the source template is later edited or deleted.
ALTER TABLE scene_contracts ADD COLUMN IF NOT EXISTS category_snapshot varchar(30) NOT NULL DEFAULT 'Custom';

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

-- Consensual private contract status. Images are private and no hardware is controlled.
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
  kind varchar(16) NOT NULL CHECK (kind IN ('lock','unlock','release','inspection')),
  status varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','completed')),
  note varchar(500) NOT NULL DEFAULT '',
  response varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
-- Upgrade the original request constraint for existing installations.
ALTER TABLE contract_boundary_requests DROP CONSTRAINT IF EXISTS contract_boundary_requests_kind_check;
ALTER TABLE contract_boundary_requests ADD CONSTRAINT contract_boundary_requests_kind_check
  CHECK (kind IN ('lock','unlock','release','inspection'));
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

-- Once-per-day, server-resolved, opt-in mini games in an active fictional scene.
-- The full outcome history is also recorded in ledger_events.
CREATE TABLE IF NOT EXISTS quick_game_plays (
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  game_key varchar(16) NOT NULL CHECK (game_key IN ('coin','highlow','cards','vault')),
  actor_id text NOT NULL REFERENCES profiles(id),
  played_at timestamptz NOT NULL DEFAULT now(),
  outcome_label varchar(160) NOT NULL,
  delta integer NOT NULL,
  PRIMARY KEY (scene_id,game_key)
);
CREATE INDEX IF NOT EXISTS quick_game_plays_actor_idx ON quick_game_plays(actor_id,played_at DESC);

-- Explicitly optional photographic evidence. All evidence is non-public, never
-- an authentication mechanism or a prerequisite for stopping roleplay.
CREATE TABLE IF NOT EXISTS proof_submissions (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  submitter_id text NOT NULL REFERENCES profiles(id),
  kind varchar(12) NOT NULL CHECK (kind IN ('lock','task','challenge','payment')),
  module_id uuid,
  claim_id uuid REFERENCES contract_task_claims(id),
  challenge_id uuid REFERENCES challenges(id),
  amount integer CHECK (amount BETWEEN 1 AND 100000),
  note varchar(500) NOT NULL DEFAULT '',
  blob_path text,
  content_type varchar(32) NOT NULL DEFAULT 'image/webp',
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 3000000),
  status varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewer_id text REFERENCES profiles(id),
  review_note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  deleted_at timestamptz,
  CHECK (
    (kind='lock' AND module_id IS NOT NULL AND claim_id IS NULL AND challenge_id IS NULL AND amount IS NULL)
    OR (kind='task' AND claim_id IS NOT NULL AND module_id IS NULL AND challenge_id IS NULL AND amount IS NULL)
    OR (kind='payment' AND amount IS NOT NULL AND module_id IS NULL AND claim_id IS NULL AND challenge_id IS NULL)
    OR (kind='challenge' AND challenge_id IS NOT NULL AND module_id IS NULL AND claim_id IS NULL AND amount IS NULL)
  )
);
-- Lock images are uploaded first, then linked to an explicit pending request.
ALTER TABLE proof_submissions ADD COLUMN IF NOT EXISTS lock_request_id uuid
  REFERENCES contract_boundary_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS proof_one_lock_request_idx
  ON proof_submissions(lock_request_id) WHERE lock_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS proof_scene_queue_idx ON proof_submissions(scene_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS proof_submitter_idx ON proof_submissions(submitter_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS proof_one_pending_per_claim_idx
  ON proof_submissions(claim_id) WHERE kind='task' AND status='pending' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS proof_one_pending_per_challenge_idx
  ON proof_submissions(challenge_id) WHERE kind='challenge' AND status='pending' AND deleted_at IS NULL;


-- Integrated engagement and operations. Never creates real-money obligations.
CREATE TABLE IF NOT EXISTS activity_notifications (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scene_id uuid REFERENCES scenes(id) ON DELETE CASCADE,
  event_key varchar(160) NOT NULL,
  kind varchar(32) NOT NULL,
  title varchar(140) NOT NULL,
  detail varchar(300) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (user_id,event_key)
);
CREATE INDEX IF NOT EXISTS activity_notifications_user_idx ON activity_notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS activity_notifications_unread_idx ON activity_notifications(user_id,created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS scene_rituals (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES profiles(id),
  title varchar(100) NOT NULL,
  description varchar(600) NOT NULL DEFAULT '',
  repeat_days smallint[] NOT NULL,
  local_hour smallint NOT NULL CHECK(local_hour BETWEEN 0 AND 23),
  timezone varchar(64) NOT NULL,
  requires_proof boolean NOT NULL DEFAULT false,
  points smallint NOT NULL DEFAULT 20 CHECK(points BETWEEN 0 AND 100),
  status varchar(12) NOT NULL DEFAULT 'proposed' CHECK(status IN('proposed','active','paused','declined')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scene_ritual_days CHECK (array_length(repeat_days,1) BETWEEN 1 AND 7 AND repeat_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
CREATE INDEX IF NOT EXISTS scene_rituals_scene_idx ON scene_rituals(scene_id,status);

CREATE TABLE IF NOT EXISTS scene_ritual_occurrences (
  id uuid PRIMARY KEY,
  ritual_id uuid NOT NULL REFERENCES scene_rituals(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','submitted','approved','rejected')),
  note varchar(500) NOT NULL DEFAULT '',
  submitted_by text REFERENCES profiles(id),
  reviewed_by text REFERENCES profiles(id),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ritual_id,local_date)
);
CREATE INDEX IF NOT EXISTS scene_ritual_occurrences_scene_idx ON scene_ritual_occurrences(scene_id,local_date DESC,status);

-- Ritual evidence follows the same private upload, review and erasure rules as other proofs.
ALTER TABLE proof_submissions ADD COLUMN IF NOT EXISTS ritual_occurrence_id uuid REFERENCES scene_ritual_occurrences(id) ON DELETE SET NULL;
ALTER TABLE proof_submissions DROP CONSTRAINT IF EXISTS proof_submissions_kind_check;
ALTER TABLE proof_submissions ADD CONSTRAINT proof_submissions_kind_check
  CHECK(kind IN ('lock','task','challenge','payment','ritual'));
ALTER TABLE proof_submissions DROP CONSTRAINT IF EXISTS proof_submissions_check;
-- Explicitly named rule permits live upgrades even when the original anonymous CHECK
-- has a generated name: use the catalog to drop only the exact legacy target constraint.
DO $$
DECLARE legacy_name text;
BEGIN
  FOR legacy_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='proof_submissions'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%kind%lock%module_id%claim_id%challenge_id%'
    AND conname <> 'proof_submissions_kind_check'
    AND conname <> 'proof_submissions_target_check'
  LOOP
    EXECUTE format('ALTER TABLE proof_submissions DROP CONSTRAINT %I',legacy_name);
  END LOOP;
END $$;
ALTER TABLE proof_submissions DROP CONSTRAINT IF EXISTS proof_submissions_target_check;
ALTER TABLE proof_submissions ADD CONSTRAINT proof_submissions_target_check CHECK(
  (kind='lock' AND module_id IS NOT NULL AND claim_id IS NULL AND challenge_id IS NULL AND amount IS NULL AND ritual_occurrence_id IS NULL)
  OR (kind='task' AND claim_id IS NOT NULL AND module_id IS NULL AND challenge_id IS NULL AND amount IS NULL AND ritual_occurrence_id IS NULL)
  OR (kind='challenge' AND challenge_id IS NOT NULL AND module_id IS NULL AND claim_id IS NULL AND amount IS NULL AND ritual_occurrence_id IS NULL)
  OR (kind='payment' AND amount IS NOT NULL AND module_id IS NULL AND claim_id IS NULL AND challenge_id IS NULL AND ritual_occurrence_id IS NULL)
  OR (kind='ritual' AND ritual_occurrence_id IS NOT NULL AND module_id IS NULL AND claim_id IS NULL AND challenge_id IS NULL AND amount IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS proof_ritual_pending_idx ON proof_submissions(ritual_occurrence_id)
  WHERE kind='ritual' AND status='pending' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS scene_point_events (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK(points BETWEEN -5000 AND 5000 AND points<>0),
  source varchar(32) NOT NULL,
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,source,source_id)
);
CREATE INDEX IF NOT EXISTS scene_points_scene_user_idx ON scene_point_events(scene_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS scene_reward_options (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES profiles(id),
  title varchar(100) NOT NULL,
  description varchar(400) NOT NULL DEFAULT '',
  cost_points integer NOT NULL CHECK(cost_points BETWEEN 1 AND 5000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scene_rewards_scene_idx ON scene_reward_options(scene_id,active);

CREATE TABLE IF NOT EXISTS scene_reward_redemptions (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES scene_reward_options(id),
  requested_by text NOT NULL REFERENCES profiles(id),
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','fulfilled','declined')),
  reviewed_by text REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS scene_redemptions_scene_idx ON scene_reward_redemptions(scene_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS scene_signatures (
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(id),
  typed_name varchar(80) NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scene_id,user_id)
);

CREATE TABLE IF NOT EXISTS operations_audit (
  id uuid PRIMARY KEY,
  actor_id text REFERENCES profiles(id) ON DELETE SET NULL,
  action varchar(48) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operations_audit_created_idx ON operations_audit(created_at DESC);

-- All events are generated from committed database changes, not client-supplied messages.
CREATE OR REPLACE FUNCTION ops_scene_notify(p_scene uuid,p_role text,p_event text,p_kind text,p_title text,p_detail text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO activity_notifications(id,user_id,scene_id,event_key,kind,title,detail)
  SELECT gen_random_uuid(),p.id,p_scene,p_event,p_kind,p_title,p_detail
  FROM scenes s JOIN connections c ON c.id=s.connection_id
  JOIN profiles p ON p.id IN(c.sender_id,c.recipient_id)
  WHERE s.id=p_scene AND c.state='active' AND (p_role='both' OR p.role=p_role)
  ON CONFLICT(user_id,event_key) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION ops_notify_existing_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='connections' THEN
   IF TG_OP='INSERT' AND NEW.state='pending' THEN
     INSERT INTO activity_notifications(id,user_id,event_key,kind,title,detail)
     VALUES(gen_random_uuid(),NEW.recipient_id,'invite:'||NEW.id,'invitation','New invitation','A member invited you to connect.')
     ON CONFLICT(user_id,event_key) DO NOTHING;
   ELSIF TG_OP='UPDATE' AND NEW.state='active' AND OLD.state IS DISTINCT FROM NEW.state THEN
     INSERT INTO activity_notifications(id,user_id,event_key,kind,title,detail)
     VALUES(gen_random_uuid(),NEW.sender_id,'connected:'||NEW.id,'connection','Invitation accepted','Your connection is now active.')
     ON CONFLICT(user_id,event_key) DO NOTHING;
   END IF;
 ELSIF TG_TABLE_NAME='scenes' THEN
   IF TG_OP='INSERT' THEN
     PERFORM ops_scene_notify(NEW.id,'sub','proposal:'||NEW.id,'contract','New scene proposal','Review the fictional terms before accepting.');
   ELSIF NEW.status='active' AND OLD.status IS DISTINCT FROM NEW.status THEN
     PERFORM ops_scene_notify(NEW.id,'dom','accepted:'||NEW.id,'contract','Scene accepted','Your partner accepted the fictional scene.');
   END IF;
 ELSIF TG_TABLE_NAME='proof_submissions' THEN
   IF TG_OP='INSERT' THEN
     PERFORM ops_scene_notify(NEW.scene_id,'dom','proof:'||NEW.id,'proof','Evidence submitted','Private evidence is awaiting review.');
   ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('approved','rejected') THEN
     INSERT INTO activity_notifications(id,user_id,scene_id,event_key,kind,title,detail)
     VALUES(gen_random_uuid(),NEW.submitter_id,NEW.scene_id,'proof-result:'||NEW.id,'proof','Evidence reviewed',NEW.status)
     ON CONFLICT(user_id,event_key) DO NOTHING;
   END IF;
 ELSIF TG_TABLE_NAME='contract_task_claims' THEN
   IF TG_OP='INSERT' THEN
     PERFORM ops_scene_notify(NEW.scene_id,'dom','claim:'||NEW.id,'task','Task claimed','An agreed contract task is awaiting review.');
   ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN('approved','rejected') THEN
     INSERT INTO activity_notifications(id,user_id,scene_id,event_key,kind,title,detail)
     VALUES(gen_random_uuid(),NEW.requested_by,NEW.scene_id,'claim-result:'||NEW.id,'task','Task reviewed',NEW.state)
     ON CONFLICT(user_id,event_key) DO NOTHING;
   END IF;
 ELSIF TG_TABLE_NAME='community_game_turns' THEN
   PERFORM ops_scene_notify((SELECT gs.scene_id FROM community_game_sessions gs WHERE gs.id=NEW.session_id),
     'both','story-turn:'||NEW.id,'story','New story move','Your shared story has a new turn.');
 ELSIF TG_TABLE_NAME='community_game_sessions' THEN
   IF TG_OP='UPDATE' AND NEW.state='finished' AND OLD.state IS DISTINCT FROM NEW.state THEN
     PERFORM ops_scene_notify(NEW.scene_id,'both','story-end:'||NEW.id,'story','Story finished',NEW.title_snapshot);
   END IF;
 ELSIF TG_TABLE_NAME='scene_rituals' THEN
   IF TG_OP='INSERT' THEN
     PERFORM ops_scene_notify(NEW.scene_id,'sub','ritual-proposal:'||NEW.id,'ritual','New ritual proposal',NEW.title);
   ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
     PERFORM ops_scene_notify(NEW.scene_id,'dom','ritual-decision:'||NEW.id||':'||NEW.status,'ritual','Ritual decision',NEW.title||' · '||NEW.status);
   END IF;
 ELSIF TG_TABLE_NAME='scene_ritual_occurrences' THEN
   IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
     IF NEW.status='submitted' THEN
       PERFORM ops_scene_notify(NEW.scene_id,'dom','ritual-submit:'||NEW.id,'ritual','Ritual awaiting review',NEW.local_date::text);
     ELSIF NEW.status IN('approved','rejected') THEN
       PERFORM ops_scene_notify(NEW.scene_id,'sub','ritual-result:'||NEW.id,'ritual','Ritual reviewed',NEW.status);
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='scene_reward_redemptions' THEN
   IF TG_OP='INSERT' THEN
     PERFORM ops_scene_notify(NEW.scene_id,'dom','redeem:'||NEW.id,'reward','Reward requested','A points redemption needs review.');
   ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
     PERFORM ops_scene_notify(NEW.scene_id,'sub','redeem-result:'||NEW.id,'reward','Reward request reviewed',NEW.status);
   END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ops_notify_connections ON connections;
CREATE TRIGGER ops_notify_connections AFTER INSERT OR UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_scenes ON scenes;
CREATE TRIGGER ops_notify_scenes AFTER INSERT OR UPDATE ON scenes FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_proofs ON proof_submissions;
CREATE TRIGGER ops_notify_proofs AFTER INSERT OR UPDATE ON proof_submissions FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_claims ON contract_task_claims;
CREATE TRIGGER ops_notify_claims AFTER INSERT OR UPDATE ON contract_task_claims FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_turns ON community_game_turns;
CREATE TRIGGER ops_notify_turns AFTER INSERT ON community_game_turns FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_sessions ON community_game_sessions;
CREATE TRIGGER ops_notify_sessions AFTER UPDATE ON community_game_sessions FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_rituals ON scene_rituals;
CREATE TRIGGER ops_notify_rituals AFTER INSERT OR UPDATE ON scene_rituals FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_occurrences ON scene_ritual_occurrences;
CREATE TRIGGER ops_notify_occurrences AFTER UPDATE ON scene_ritual_occurrences FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();
DROP TRIGGER IF EXISTS ops_notify_redemptions ON scene_reward_redemptions;
CREATE TRIGGER ops_notify_redemptions AFTER INSERT OR UPDATE ON scene_reward_redemptions FOR EACH ROW EXECUTE FUNCTION ops_notify_existing_events();

CREATE OR REPLACE FUNCTION ops_award_completed_events() RETURNS trigger LANGUAGE plpgsql AS $ops_points$
DECLARE turn_count integer;
BEGIN
 -- Use distinct table branches: record fields differ and SQL boolean expressions
 -- do not guarantee short-circuit evaluation on PostgreSQL record variables.
 IF TG_TABLE_NAME='proof_submissions' THEN
   IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
     IF NEW.kind IN('task','challenge','ritual','lock') THEN
       INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id)
       VALUES(gen_random_uuid(),NEW.scene_id,NEW.submitter_id,10,'verified-proof',NEW.id::text)
       ON CONFLICT(user_id,source,source_id) DO NOTHING;
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='contract_task_claims' THEN
   IF NEW.state='approved' AND OLD.state IS DISTINCT FROM NEW.state THEN
     INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id)
     VALUES(gen_random_uuid(),NEW.scene_id,NEW.requested_by,40,'verified-task',NEW.id::text)
     ON CONFLICT(user_id,source,source_id) DO NOTHING;
   END IF;
 ELSIF TG_TABLE_NAME='challenges' THEN
   IF NEW.state='completed' AND OLD.state IS DISTINCT FROM NEW.state THEN
     INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id)
     SELECT gen_random_uuid(),NEW.scene_id,p.id,30,'challenge',NEW.id::text
     FROM scenes s JOIN connections c ON c.id=s.connection_id
     JOIN profiles p ON p.id IN(c.sender_id,c.recipient_id)
     WHERE s.id=NEW.scene_id AND p.role='sub'
     ON CONFLICT(user_id,source,source_id) DO NOTHING;
   END IF;
 ELSIF TG_TABLE_NAME='community_game_sessions' THEN
   IF NEW.state='finished' AND OLD.state IS DISTINCT FROM NEW.state THEN
     -- A zero-turn story is not a completed activity. Cap awardable stories
     -- at two per participant and scene per UTC day to prevent points farming.
     SELECT count(*)::int INTO turn_count FROM community_game_turns WHERE session_id=NEW.id;
     IF turn_count >= (CASE WHEN NEW.official_key IS NOT NULL THEN 3 ELSE 2 END) THEN
       INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id)
       SELECT gen_random_uuid(),NEW.scene_id,p.id,25,'story',NEW.id::text
       FROM scenes s JOIN connections c ON c.id=s.connection_id
       JOIN profiles p ON p.id IN(c.sender_id,c.recipient_id)
       WHERE s.id=NEW.scene_id AND c.state='active'
         AND (SELECT count(*) FROM scene_point_events e
           WHERE e.scene_id=NEW.scene_id AND e.user_id=p.id AND e.source='story'
             AND e.created_at>=date_trunc('day',now()))<2
       ON CONFLICT(user_id,source,source_id) DO NOTHING;
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='scene_ritual_occurrences' THEN
   IF NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
     INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id)
     SELECT gen_random_uuid(),NEW.scene_id,NEW.submitted_by,r.points,'ritual',NEW.id::text
     FROM scene_rituals r WHERE r.id=NEW.ritual_id AND r.points>0 AND NEW.submitted_by IS NOT NULL
     ON CONFLICT(user_id,source,source_id) DO NOTHING;
   END IF;
 END IF;
 RETURN NEW;
END $ops_points$;
DROP TRIGGER IF EXISTS ops_points_proofs ON proof_submissions;
CREATE TRIGGER ops_points_proofs AFTER UPDATE ON proof_submissions FOR EACH ROW EXECUTE FUNCTION ops_award_completed_events();
DROP TRIGGER IF EXISTS ops_points_claims ON contract_task_claims;
CREATE TRIGGER ops_points_claims AFTER UPDATE ON contract_task_claims FOR EACH ROW EXECUTE FUNCTION ops_award_completed_events();
DROP TRIGGER IF EXISTS ops_points_challenges ON challenges;
CREATE TRIGGER ops_points_challenges AFTER UPDATE ON challenges FOR EACH ROW EXECUTE FUNCTION ops_award_completed_events();
DROP TRIGGER IF EXISTS ops_points_stories ON community_game_sessions;
CREATE TRIGGER ops_points_stories AFTER UPDATE ON community_game_sessions FOR EACH ROW EXECUTE FUNCTION ops_award_completed_events();
DROP TRIGGER IF EXISTS ops_points_rituals ON scene_ritual_occurrences;
CREATE TRIGGER ops_points_rituals AFTER UPDATE ON scene_ritual_occurrences FOR EACH ROW EXECUTE FUNCTION ops_award_completed_events();



-- Scene Platform v3: immutable narrative snapshots, shared activity, consent-aware
-- tasks and private chat. New tables are additive to existing contracts and games.
CREATE TABLE IF NOT EXISTS scene_events (
  id bigserial PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  actor_id text REFERENCES profiles(id) ON DELETE SET NULL,
  event_type varchar(60) NOT NULL,
  ref_id text NOT NULL,
  summary varchar(240) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scene_id,event_type,ref_id)
);
CREATE INDEX IF NOT EXISTS scene_events_scene_idx ON scene_events(scene_id,id DESC);

CREATE TABLE IF NOT EXISTS narrative_templates (
  id uuid PRIMARY KEY,
  author_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  definition jsonb NOT NULL,
  title varchar(80) NOT NULL,
  summary varchar(240) NOT NULL,
  category varchar(30) NOT NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS narrative_library_idx ON narrative_templates(published,updated_at DESC);

CREATE TABLE IF NOT EXISTS narrative_sessions (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  template_id uuid REFERENCES narrative_templates(id) ON DELETE SET NULL,
  proposed_by text NOT NULL REFERENCES profiles(id),
  approved_by text REFERENCES profiles(id),
  definition_snapshot jsonb NOT NULL,
  state jsonb NOT NULL DEFAULT '{"nodeId":"start","flags":[],"decisions":0}'::jsonb,
  status varchar(12) NOT NULL DEFAULT 'proposed'
    CHECK(status IN('proposed','active','finished','declined','stopped')),
  last_actor_id text REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  finished_at timestamptz,
  CHECK(jsonb_typeof(definition_snapshot)='object' AND jsonb_typeof(state)='object')
);
CREATE INDEX IF NOT EXISTS narrative_scene_idx ON narrative_sessions(scene_id,created_at DESC);

CREATE TABLE IF NOT EXISTS narrative_turns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES narrative_sessions(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES profiles(id),
  chapter_id varchar(32) NOT NULL,
  choice_id varchar(32) NOT NULL,
  label varchar(140) NOT NULL,
  points_awarded smallint NOT NULL DEFAULT 0 CHECK(points_awarded BETWEEN 0 AND 10),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS narrative_turns_session_idx ON narrative_turns(session_id,created_at,id);

CREATE TABLE IF NOT EXISTS scene_assignments (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  proposed_by text NOT NULL REFERENCES profiles(id),
  accepted_by text REFERENCES profiles(id),
  title varchar(100) NOT NULL,
  description varchar(600) NOT NULL DEFAULT '',
  steps jsonb NOT NULL,
  next_step smallint NOT NULL DEFAULT 0 CHECK(next_step BETWEEN 0 AND 8),
  status varchar(12) NOT NULL DEFAULT 'proposed'
    CHECK(status IN('proposed','active','submitted','completed','declined','cancelled')),
  points smallint NOT NULL CHECK(points BETWEEN 0 AND 60),
  story_session_id uuid REFERENCES narrative_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  completed_at timestamptz,
  CHECK(jsonb_typeof(steps)='array' AND jsonb_array_length(steps) BETWEEN 1 AND 8)
);
ALTER TABLE scene_assignments ADD COLUMN IF NOT EXISTS step_started_at timestamptz;
CREATE INDEX IF NOT EXISTS scene_assignments_idx ON scene_assignments(scene_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS assignment_step_submissions (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES scene_assignments(id) ON DELETE CASCADE,
  step_number smallint NOT NULL CHECK(step_number BETWEEN 0 AND 7),
  note varchar(1000) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','approved','rejected')),
  submitted_by text NOT NULL REFERENCES profiles(id),
  reviewed_by text REFERENCES profiles(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  review_note varchar(500) NOT NULL DEFAULT '',
  UNIQUE(assignment_id,step_number)
);

CREATE TABLE IF NOT EXISTS scene_messages (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES profiles(id),
  body varchar(2000) NOT NULL CHECK(char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS scene_messages_idx ON scene_messages(scene_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS scene_chat_receipts (
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scene_id,user_id)
);

CREATE TABLE IF NOT EXISTS scene_safety_prefs (
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  limits jsonb NOT NULL DEFAULT '[]'::jsonb,
  share_limits boolean NOT NULL DEFAULT false,
  ai_opt_in boolean NOT NULL DEFAULT false,
  aftercare varchar(500) NOT NULL DEFAULT '',
  last_checkin timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(scene_id,user_id),
  CHECK(jsonb_typeof(limits)='array')
);
CREATE TABLE IF NOT EXISTS scene_safety_events (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES profiles(id),
  action varchar(20) NOT NULL CHECK(action IN('stop','consent-check','resume-request')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scene_safety_events_idx ON scene_safety_events(scene_id,created_at DESC);

CREATE TABLE IF NOT EXISTS scene_time_sessions (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(id),
  label varchar(90) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  accumulated_seconds integer NOT NULL DEFAULT 0 CHECK(accumulated_seconds>=0),
  active_since timestamptz,
  status varchar(12) NOT NULL DEFAULT 'running' CHECK(status IN('running','paused','finished')),
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS scene_time_running_idx ON scene_time_sessions(scene_id,user_id) WHERE status IN('running','paused');
CREATE INDEX IF NOT EXISTS scene_time_history_idx ON scene_time_sessions(scene_id,user_id,started_at DESC);

CREATE TABLE IF NOT EXISTS profile_interest_levels (
  user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  interest varchar(100) NOT NULL,
  level smallint NOT NULL CHECK(level BETWEEN 0 AND 4),
  public boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,interest)
);
CREATE INDEX IF NOT EXISTS profile_interest_public_idx ON profile_interest_levels(interest,level) WHERE public;

-- Transactionally mirror existing systems into one ordered scene stream.
-- Individual consumer actions cannot forge these events from a browser.
CREATE OR REPLACE FUNCTION scene_platform_mirror() RETURNS trigger LANGUAGE plpgsql AS $scene_platform$
DECLARE sid uuid; actor text; event_key text; ref text; summary text;
BEGIN
  IF TG_TABLE_NAME='ledger_events' THEN
    IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
    sid:=NEW.scene_id; actor:=NEW.actor_id; event_key:='ledger.'||NEW.type;
    ref:=NEW.id::text;summary:='Fictional ledger action recorded';
  ELSIF TG_TABLE_NAME='community_game_turns' THEN
    IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
    SELECT scene_id INTO sid FROM community_game_sessions WHERE id=NEW.session_id;
    actor:=NEW.actor_id;event_key:='story.turn';ref:=NEW.id::text;summary:='Shared story move';
  ELSIF TG_TABLE_NAME='proof_submissions' THEN
    sid:=NEW.scene_id;
    IF TG_OP='INSERT' THEN
      actor:=NEW.submitter_id;event_key:='proof.submitted';
      ref:=NEW.id::text;summary:='Private proof submitted';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      actor:=NEW.reviewer_id;event_key:='proof.'||NEW.status;
      ref:=NEW.id::text;summary:='Private proof reviewed';
    ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='contract_task_claims' THEN
    sid:=NEW.scene_id;
    IF TG_OP='INSERT' THEN
      actor:=NEW.requested_by;event_key:='contract-task.claimed';
      ref:=NEW.id::text;summary:='Contract task claimed';
    ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
      actor:=NEW.reviewed_by;event_key:='contract-task.'||NEW.state;
      ref:=NEW.id::text;summary:='Contract task reviewed';
    ELSE RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='scene_ritual_occurrences' THEN
    IF TG_OP<>'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
    sid:=NEW.scene_id;actor:=COALESCE(NEW.reviewed_by,NEW.submitted_by);
    event_key:='ritual.'||NEW.status;ref:=NEW.id::text;summary:='Ritual activity updated';
  ELSIF TG_TABLE_NAME='scene_point_events' THEN
    IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
    sid:=NEW.scene_id;actor:=NEW.user_id;event_key:='points.'||NEW.source;
    ref:=NEW.id::text;summary:='Game points updated';
  ELSE RETURN NEW; END IF;
  INSERT INTO scene_events(scene_id,actor_id,event_type,ref_id,summary)
  VALUES(sid,actor,event_key,ref,summary)
  ON CONFLICT(scene_id,event_type,ref_id) DO NOTHING;
  RETURN NEW;
END $scene_platform$;
DROP TRIGGER IF EXISTS scene_mirror_ledger ON ledger_events;
CREATE TRIGGER scene_mirror_ledger AFTER INSERT ON ledger_events FOR EACH ROW EXECUTE FUNCTION scene_platform_mirror();
DROP TRIGGER IF EXISTS scene_mirror_game_turns ON community_game_turns;
CREATE TRIGGER scene_mirror_game_turns AFTER INSERT ON community_game_turns FOR EACH ROW EXECUTE FUNCTION scene_platform_mirror();
DROP TRIGGER IF EXISTS scene_mirror_proofs ON proof_submissions;
CREATE TRIGGER scene_mirror_proofs AFTER INSERT OR UPDATE ON proof_submissions FOR EACH ROW EXECUTE FUNCTION scene_platform_mirror();
DROP TRIGGER IF EXISTS scene_mirror_contract_tasks ON contract_task_claims;
CREATE TRIGGER scene_mirror_contract_tasks AFTER INSERT OR UPDATE ON contract_task_claims FOR EACH ROW EXECUTE FUNCTION scene_platform_mirror();
DROP TRIGGER IF EXISTS scene_mirror_rituals ON scene_ritual_occurrences;
CREATE TRIGGER scene_mirror_rituals AFTER UPDATE ON scene_ritual_occurrences FOR EACH ROW EXECUTE FUNCTION scene_platform_mirror();
DROP TRIGGER IF EXISTS scene_mirror_points ON scene_point_events;
CREATE TRIGGER scene_mirror_points AFTER INSERT ON scene_point_events FOR EACH ROW EXECUTE FUNCTION scene_platform_mirror();

-- New API operations use these triggers for notifications while retaining
-- scene-level authorization checks in application code.
CREATE OR REPLACE FUNCTION scene_platform_alert() RETURNS trigger LANGUAGE plpgsql AS $scene_alert$
BEGIN
  IF TG_TABLE_NAME='scene_messages' THEN
    IF TG_OP='INSERT' THEN
      INSERT INTO activity_notifications(id,user_id,scene_id,event_key,kind,title,detail)
      SELECT gen_random_uuid(),p.id,NEW.scene_id,'message:'||NEW.id,'message',
        'New private message','A partner sent you a new message.'
      FROM scenes s JOIN connections c ON c.id=s.connection_id
      JOIN profiles p ON p.id IN(c.sender_id,c.recipient_id)
      WHERE s.id=NEW.scene_id AND c.state='active' AND p.id<>NEW.sender_id
      ON CONFLICT(user_id,event_key) DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME='scene_assignments' THEN
    IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
      PERFORM ops_scene_notify(NEW.scene_id,'both','assignment:'||NEW.id||':'||NEW.status,
        'task','Shared task updated',NEW.title);
    END IF;
  ELSIF TG_TABLE_NAME='narrative_sessions' THEN
    IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
      PERFORM ops_scene_notify(NEW.scene_id,'both','narrative:'||NEW.id||':'||NEW.status,
        'story','Interactive story updated',
        LEFT(NEW.definition_snapshot->>'title',100));
    END IF;
  END IF;
  RETURN NEW;
END $scene_alert$;
DROP TRIGGER IF EXISTS scene_platform_messages_alert ON scene_messages;
CREATE TRIGGER scene_platform_messages_alert AFTER INSERT ON scene_messages FOR EACH ROW EXECUTE FUNCTION scene_platform_alert();
DROP TRIGGER IF EXISTS scene_platform_task_alert ON scene_assignments;
CREATE TRIGGER scene_platform_task_alert AFTER INSERT OR UPDATE ON scene_assignments FOR EACH ROW EXECUTE FUNCTION scene_platform_alert();
DROP TRIGGER IF EXISTS scene_platform_story_alert ON narrative_sessions;
CREATE TRIGGER scene_platform_story_alert AFTER INSERT OR UPDATE ON narrative_sessions FOR EACH ROW EXECUTE FUNCTION scene_platform_alert();


-- Optional AI assistance is read-only; store request counts, never prompts/responses.
CREATE TABLE IF NOT EXISTS scene_ai_usage (
  id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scene_ai_usage_cap_idx ON scene_ai_usage(user_id,created_at DESC);


-- Multiple independently reviewed, private images per consented assignment step.
CREATE TABLE IF NOT EXISTS assignment_step_evidence (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES scene_assignments(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  step_number smallint NOT NULL CHECK(step_number BETWEEN 0 AND 7),
  uploader_id text NOT NULL REFERENCES profiles(id),
  blob_path text,
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 3000000),
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  reviewer_id text REFERENCES profiles(id),
  review_note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS assignment_evidence_step_idx ON assignment_step_evidence(assignment_id,step_number,status);
CREATE INDEX IF NOT EXISTS assignment_evidence_uploader_idx ON assignment_step_evidence(uploader_id,created_at DESC);
CREATE OR REPLACE FUNCTION scene_assignment_evidence_event() RETURNS trigger LANGUAGE plpgsql AS $assignment_event$
DECLARE actor text;
BEGIN
  IF TG_OP='INSERT' THEN
    actor:=NEW.uploader_id;
    INSERT INTO scene_events(scene_id,actor_id,event_type,ref_id,summary)
    VALUES(NEW.scene_id,actor,'task.evidence-uploaded',NEW.id::text,'Private task-step evidence uploaded')
    ON CONFLICT(scene_id,event_type,ref_id) DO NOTHING;
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    actor:=NEW.reviewer_id;
    INSERT INTO scene_events(scene_id,actor_id,event_type,ref_id,summary)
    VALUES(NEW.scene_id,actor,'task.evidence-'||NEW.status,NEW.id::text,'Task-step evidence reviewed')
    ON CONFLICT(scene_id,event_type,ref_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $assignment_event$;
DROP TRIGGER IF EXISTS scene_assignment_evidence_events ON assignment_step_evidence;
CREATE TRIGGER scene_assignment_evidence_events AFTER INSERT OR UPDATE ON assignment_step_evidence
  FOR EACH ROW EXECUTE FUNCTION scene_assignment_evidence_event();


-- Campaigns: independent one-to-many fictional, consent-first community spaces.
-- Deliberately separate from connections/scenes and their private debt ledger.
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY,
  creator_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title varchar(100) NOT NULL,
  description varchar(2000) NOT NULL,
  rules varchar(5000) NOT NULL,
  kind varchar(20) NOT NULL CHECK(kind IN ('tribute','goal','challenge','competition','event')),
  category varchar(40) NOT NULL,
  visibility varchar(12) NOT NULL CHECK(visibility IN ('public','unlisted','restricted')),
  join_policy varchar(12) NOT NULL CHECK(join_policy IN ('open','approval','invite')),
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused','closed')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(tags)='array'),
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(milestones)='array'),
  starts_at timestamptz,
  ends_at timestamptz,
  goal bigint NOT NULL DEFAULT 0 CHECK(goal BETWEEN 0 AND 100000000),
  min_contribution integer NOT NULL DEFAULT 1 CHECK(min_contribution BETWEEN 1 AND 1000000),
  max_contribution integer NOT NULL DEFAULT 10000 CHECK(max_contribution BETWEEN 1 AND 1000000),
  max_per_member bigint NOT NULL DEFAULT 1000000 CHECK(max_per_member BETWEEN 1 AND 100000000),
  member_limit integer NOT NULL DEFAULT 1000 CHECK(member_limit BETWEEN 1 AND 10000),
  require_contribution_proof boolean NOT NULL DEFAULT false,
  allow_anonymous boolean NOT NULL DEFAULT true,
  leaderboard_enabled boolean NOT NULL DEFAULT false,
  allow_comments boolean NOT NULL DEFAULT true,
  terms_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  closed_at timestamptz,
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at),
  CHECK(max_contribution >= min_contribution),
  CHECK(max_per_member >= min_contribution)
);
CREATE INDEX IF NOT EXISTS campaigns_discover_idx ON campaigns(status,visibility,published_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_creator_idx ON campaigns(creator_id,created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_tags_idx ON campaigns USING gin(tags);

CREATE TABLE IF NOT EXISTS campaign_memberships (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status varchar(12) NOT NULL CHECK(status IN ('invited','pending','active','left','removed')),
  accepted_version integer NOT NULL,
  anonymous boolean NOT NULL DEFAULT false,
  leaderboard_opt_in boolean NOT NULL DEFAULT false,
  personal_cap bigint NOT NULL DEFAULT 1000000 CHECK(personal_cap BETWEEN 1 AND 100000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  left_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,member_id)
);
CREATE INDEX IF NOT EXISTS campaign_memberships_member_idx ON campaign_memberships(member_id,status);
CREATE INDEX IF NOT EXISTS campaign_memberships_queue_idx ON campaign_memberships(campaign_id,status,created_at);

CREATE TABLE IF NOT EXISTS campaign_contributions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
  note varchar(400) NOT NULL DEFAULT '',
  status varchar(12) NOT NULL CHECK(status IN ('pending','approved','rejected')),
  reviewed_by text REFERENCES profiles(id),
  review_note varchar(500) NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id,request_id)
);
CREATE INDEX IF NOT EXISTS campaign_contributions_campaign_idx ON campaign_contributions(campaign_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_contributions_member_idx ON campaign_contributions(member_id,campaign_id,status);

CREATE TABLE IF NOT EXISTS campaign_activities (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL CHECK(kind IN ('task','game','poll')),
  config jsonb NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'active' CHECK(state IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_activities_idx ON campaign_activities(campaign_id,state);

CREATE TABLE IF NOT EXISTS campaign_task_claims (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES campaign_activities(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note varchar(1000) NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  points integer NOT NULL CHECK(points BETWEEN 0 AND 1000),
  reviewer_id text REFERENCES profiles(id),
  review_note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS campaign_tasks_queue_idx ON campaign_task_claims(campaign_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_tasks_member_idx ON campaign_task_claims(activity_id,member_id,status);

CREATE TABLE IF NOT EXISTS campaign_game_plays (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES campaign_activities(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outcome jsonb NOT NULL,
  points integer NOT NULL CHECK(points BETWEEN 0 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_game_cooldown_idx ON campaign_game_plays(activity_id,member_id,created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_votes (
  activity_id uuid NOT NULL REFERENCES campaign_activities(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  choice_index smallint NOT NULL CHECK(choice_index BETWEEN 0 AND 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(activity_id,member_id)
);

CREATE TABLE IF NOT EXISTS campaign_point_events (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK(points BETWEEN 0 AND 1000),
  source_type varchar(20) NOT NULL,
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type,source_id)
);
CREATE INDEX IF NOT EXISTS campaign_points_member_idx ON campaign_point_events(campaign_id,member_id);

CREATE TABLE IF NOT EXISTS campaign_posts (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL CHECK(kind IN ('update','comment')),
  parent_id uuid REFERENCES campaign_posts(id) ON DELETE CASCADE,
  content varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS campaign_posts_feed_idx ON campaign_posts(campaign_id,created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_reactions (
  post_id uuid NOT NULL REFERENCES campaign_posts(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji varchar(12) NOT NULL CHECK(emoji IN ('heart','clap','star')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(post_id,member_id)
);

CREATE TABLE IF NOT EXISTS campaign_follows (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  follower_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,follower_id)
);

CREATE TABLE IF NOT EXISTS campaign_evidence (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  uploader_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contribution_id uuid REFERENCES campaign_contributions(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES campaign_task_claims(id) ON DELETE CASCADE,
  blob_path text,
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 4000000),
  content_type varchar(24) NOT NULL CHECK(content_type IN ('image/webp','application/pdf')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((contribution_id IS NOT NULL)::integer+(claim_id IS NOT NULL)::integer=1)
);
CREATE INDEX IF NOT EXISTS campaign_evidence_contrib_idx ON campaign_evidence(contribution_id,deleted_at);
CREATE INDEX IF NOT EXISTS campaign_evidence_claim_idx ON campaign_evidence(claim_id,deleted_at);

CREATE TABLE IF NOT EXISTS campaign_events (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type varchar(40) NOT NULL,
  subject_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_events_campaign_idx ON campaign_events(campaign_id,created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_notifications (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL,
  title varchar(140) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS campaign_notifications_recipient_idx ON campaign_notifications(recipient_id,read_at,created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_reports (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  reporter_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason varchar(500) NOT NULL CHECK(char_length(reason)>=10),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,reporter_id)
);

-- Optional image is delivered through an authenticated private Blob proxy.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cover_blob_path text;


-- Following a creator never establishes a private connection or membership.
CREATE TABLE IF NOT EXISTS campaign_creator_follows (
  creator_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  follower_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(creator_id,follower_id),
  CHECK(creator_id<>follower_id)
);
CREATE INDEX IF NOT EXISTS campaign_creator_follows_follower_idx ON campaign_creator_follows(follower_id);
