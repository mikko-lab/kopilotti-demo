BEGIN;

CREATE TABLE processed_events (
  event_id uuid PRIMARY KEY,
  processed_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMIT;
