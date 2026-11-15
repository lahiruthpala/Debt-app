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

CREATE OR REPLACE FUNCTION ops_award_completed_events() RETURNS trigger LANGUAGE plpgsql AS $
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
END $$;
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
