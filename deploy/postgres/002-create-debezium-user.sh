#!/bin/sh
set -eu

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set debezium_user="$DEBEZIUM_DATABASE_USER" \
  --set debezium_password="$DEBEZIUM_DATABASE_PASSWORD" <<-'SQL'
SELECT format('CREATE ROLE %I WITH LOGIN REPLICATION PASSWORD %L', :'debezium_user', :'debezium_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'debezium_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'debezium_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'debezium_user') \gexec
SELECT format('GRANT SELECT ON TABLE public.transactional_outbox TO %I', :'debezium_user') \gexec
CREATE PUBLICATION kopilotti_outbox_publication FOR TABLE public.transactional_outbox;
SQL
