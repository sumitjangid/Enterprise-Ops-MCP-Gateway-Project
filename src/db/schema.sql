CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('standard', 'vip')),
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('refund', 'status_change')),
  payload jsonb NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL,
  token_label text NOT NULL,
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  reason text NOT NULL,
  result_summary text NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_counters (
  token_label text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (token_label, window_start)
);
