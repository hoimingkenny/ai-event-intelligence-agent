CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION cyber;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

ALTER DATABASE vendor_threat_watch SET search_path TO app, public;
ALTER ROLE cyber IN DATABASE vendor_threat_watch SET search_path TO app, public;
