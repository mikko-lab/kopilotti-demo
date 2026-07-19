BEGIN;

CREATE TYPE deal_status AS ENUM ('NEGOTIATING', 'PRICE_AGREED', 'AWAITING_PAYMENT', 'PAID', 'HANDED_OVER', 'VOIDED');
CREATE TYPE payment_method AS ENUM ('CASH', 'FINANCING');

CREATE TABLE vehicles (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  registration_number text NOT NULL,
  model text NOT NULL,
  base_price_cents bigint NOT NULL CHECK (base_price_cents > 0),
  inventory_revision bigint NOT NULL CHECK (inventory_revision >= 0),
  is_available boolean NOT NULL DEFAULT true,
  locked_deal_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, registration_number),
  UNIQUE (id, tenant_id)
);
CREATE INDEX vehicles_available_idx ON vehicles (tenant_id, is_available) WHERE is_available = true;

CREATE TABLE deals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  vehicle_id text NOT NULL,
  registration_number text NOT NULL,
  status deal_status NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  agreed_price_cents bigint CHECK (agreed_price_cents > 0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  buyer_id text,
  payment_method payment_method,
  payment_deadline timestamptz,
  provider_reference text,
  handover_policy_version text,
  inventory_revision_at_lock bigint NOT NULL CHECK (inventory_revision_at_lock >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT deals_buyer_required_after_negotiation CHECK (
    (status = 'NEGOTIATING' AND buyer_id IS NULL AND agreed_price_cents IS NULL)
    OR (status <> 'NEGOTIATING' AND buyer_id IS NOT NULL AND agreed_price_cents IS NOT NULL)
  ),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (vehicle_id, tenant_id) REFERENCES vehicles(id, tenant_id)
);
ALTER TABLE vehicles ADD CONSTRAINT vehicles_locked_deal_fk FOREIGN KEY (locked_deal_id, tenant_id) REFERENCES deals(id, tenant_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX deals_tenant_status_idx ON deals (tenant_id, status);
CREATE INDEX deals_payment_timeout_idx ON deals (payment_deadline, id) WHERE status = 'AWAITING_PAYMENT';

CREATE TABLE audit_logs (
  event_id text PRIMARY KEY,
  transaction_id text NOT NULL,
  tenant_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  event text NOT NULL,
  from_status deal_status NOT NULL,
  to_status deal_status NOT NULL,
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (transaction_id, tenant_id) REFERENCES deals(id, tenant_id)
);
CREATE INDEX audit_logs_transaction_time_idx ON audit_logs (transaction_id, occurred_at, event_id);

CREATE FUNCTION reject_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

CREATE TABLE processed_callbacks (
  provider text NOT NULL,
  idempotency_key text NOT NULL,
  transaction_id text NOT NULL REFERENCES deals(id),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, idempotency_key),
  CONSTRAINT processed_callbacks_provider_key_unique UNIQUE (provider, idempotency_key)
);

CREATE TABLE transactional_outbox (
  event_id text PRIMARY KEY,
  transaction_id text NOT NULL REFERENCES deals(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token text,
  published_at timestamptz
);
CREATE INDEX transactional_outbox_pending_idx ON transactional_outbox (created_at, event_id) WHERE published_at IS NULL;
CREATE INDEX transactional_outbox_claim_recovery_idx ON transactional_outbox (claimed_at) WHERE published_at IS NULL;

COMMIT;
