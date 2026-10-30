CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  rate numeric(12,2) CHECK (rate >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  rate numeric(12,2) CHECK (rate >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_customer_idx ON projects(customer_id);
CREATE TABLE billing_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  external_invoice_reference text CHECK (length(external_invoice_reference) <= 200),
  total_minutes integer NOT NULL CHECK (total_minutes > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_batches_customer_idx ON billing_batches(customer_id);
CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  date date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billed', 'void')),
  billing_batch_id uuid REFERENCES billing_batches(id),
  created_by text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'billed') = (billing_batch_id IS NOT NULL))
);
CREATE INDEX time_entries_project_idx ON time_entries(project_id);
CREATE INDEX time_entries_date_idx ON time_entries(date DESC);
CREATE INDEX time_entries_unbilled_idx ON time_entries(project_id, date) WHERE status = 'unbilled';
CREATE INDEX time_entries_batch_idx ON time_entries(billing_batch_id);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  customer_id uuid REFERENCES customers(id),
  project_id uuid REFERENCES projects(id),
  before_data jsonb,
  after_data jsonb
);
CREATE INDEX audit_log_at_idx ON audit_log(at DESC);
CREATE INDEX audit_log_customer_idx ON audit_log(customer_id);
CREATE INDEX audit_log_project_idx ON audit_log(project_id);
CREATE FUNCTION reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only';
END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION reject_audit_change();
CREATE FUNCTION protect_time_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_customer uuid; entry_customer uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Time entries must be voided, not deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'unbilled' THEN
    RAISE EXCEPTION 'Historical time entries are read-only';
  END IF;
  IF NEW.billing_batch_id IS NOT NULL THEN
    SELECT customer_id INTO batch_customer FROM billing_batches WHERE id = NEW.billing_batch_id;
    SELECT customer_id INTO entry_customer FROM projects WHERE id = NEW.project_id;
    IF batch_customer IS DISTINCT FROM entry_customer THEN
      RAISE EXCEPTION 'Billing batch customer must match entry customer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER time_entry_integrity BEFORE INSERT OR UPDATE OR DELETE ON time_entries
FOR EACH ROW EXECUTE FUNCTION protect_time_entry();
