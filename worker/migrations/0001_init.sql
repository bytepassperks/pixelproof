CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  email TEXT,
  dodo_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
