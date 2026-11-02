-- signalarc:statement
-- One fixed row bounds state growth. No IPs, cookies, wallet identities or secrets are retained.
CREATE TABLE api_request_budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  minute_start INTEGER NOT NULL CHECK (minute_start >= 0),
  minute_hits INTEGER NOT NULL CHECK (minute_hits > 0),
  day_start INTEGER NOT NULL CHECK (day_start >= 0),
  day_hits INTEGER NOT NULL CHECK (day_hits > 0)
);
