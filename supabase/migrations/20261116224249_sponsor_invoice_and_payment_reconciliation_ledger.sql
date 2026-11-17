
CREATE TABLE catho_private.sponsor_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 2 AND 500),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  currency text NOT NULL CHECK (currency IN ('GBP', 'EUR', 'USD')),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_invoices_valid_dates CHECK (due_on >= issued_on)
);
CREATE INDEX sponsor_invoices_sponsor_created_idx
  ON catho_private.sponsor_invoices (sponsor_id, created_at DESC);
CREATE INDEX sponsor_invoices_status_due_idx
  ON catho_private.sponsor_invoices (status, due_on);

CREATE TABLE catho_private.sponsor_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES catho_private.sponsor_invoices(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (transaction_type IN ('payment', 'refund')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000000),
  currency text NOT NULL CHECK (currency IN ('GBP', 'EUR', 'USD')),
  bank_reference text CHECK (bank_reference IS NULL OR char_length(bank_reference) <= 120),
  bank_transaction_date date,
  bank_transaction_key text CHECK (bank_transaction_key IS NULL OR char_length(bank_transaction_key) BETWEEN 1 AND 160),
  refund_of_payment_id uuid REFERENCES catho_private.sponsor_payment_transactions(id) ON DELETE RESTRICT,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT sponsor_payment_transaction_shape CHECK (
    (transaction_type = 'payment' AND refund_of_payment_id IS NULL)
    OR (transaction_type = 'refund' AND refund_of_payment_id IS NOT NULL)
  )
);
CREATE INDEX sponsor_payment_transactions_sponsor_created_idx
  ON catho_private.sponsor_payment_transactions (sponsor_id, received_at DESC);
CREATE INDEX sponsor_payment_transactions_invoice_created_idx
  ON catho_private.sponsor_payment_transactions (invoice_id, received_at DESC);
CREATE INDEX sponsor_payment_transactions_refund_idx
  ON catho_private.sponsor_payment_transactions (refund_of_payment_id)
  WHERE refund_of_payment_id IS NOT NULL;
CREATE UNIQUE INDEX sponsor_payment_transactions_bank_key_idx
  ON catho_private.sponsor_payment_transactions (bank_transaction_key)
  WHERE bank_transaction_key IS NOT NULL;

ALTER TABLE catho_private.sponsor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE catho_private.sponsor_payment_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE catho_private.sponsor_invoices FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE catho_private.sponsor_payment_transactions FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_sponsor_invoice(
  p_actor_user_id uuid, p_sponsor_id uuid, p_description text, p_amount_minor bigint,
  p_currency text, p_issued_on date, p_due_on date, p_issue_now boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_invoice catho_private.sponsor_invoices%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id)
     OR char_length(btrim(coalesce(p_description, ''))) NOT BETWEEN 2 AND 500
     OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 100000000000
     OR p_currency NOT IN ('GBP', 'EUR', 'USD')
     OR p_issued_on IS NULL OR p_due_on IS NULL OR p_due_on < p_issued_on
     OR p_issue_now IS NULL THEN
    RAISE EXCEPTION 'Invalid sponsor invoice details' USING ERRCODE = '22023';
  END IF;
  INSERT INTO catho_private.sponsor_invoices
    (sponsor_id, description, amount_minor, currency, issued_on, due_on, status, created_by)
  VALUES
    (p_sponsor_id, btrim(p_description), p_amount_minor, p_currency, p_issued_on, p_due_on,
     CASE WHEN p_issue_now THEN 'issued' ELSE 'draft' END, p_actor_user_id)
  RETURNING * INTO v_invoice;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.invoice_created', 'sponsor_invoice', v_invoice.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'invoice_number', v_invoice.invoice_number,
      'amount_minor', p_amount_minor, 'currency', p_currency, 'status', v_invoice.status));
  RETURN jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'sponsor_id', v_invoice.sponsor_id, 'amount_minor', v_invoice.amount_minor,
    'currency', v_invoice.currency, 'status', v_invoice.status);
END;
$function$;
ALTER FUNCTION public.admin_create_sponsor_invoice(uuid, uuid, text, bigint, text, date, date, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_create_sponsor_invoice(uuid, uuid, text, bigint, text, date, date, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor_invoice(uuid, uuid, text, bigint, text, date, date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_sponsor_invoice_status(
  p_actor_user_id uuid, p_invoice_id uuid, p_action text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_invoice catho_private.sponsor_invoices%ROWTYPE; v_status text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_invoice_id IS NULL OR p_action IS NULL OR p_action NOT IN ('issue', 'void') THEN
    RAISE EXCEPTION 'Invalid invoice action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM catho_private.sponsor_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'issue' THEN
    IF v_invoice.status <> 'draft' THEN RAISE EXCEPTION 'Only draft invoices can be issued' USING ERRCODE = '23514'; END IF;
    v_status := 'issued';
  ELSE
    IF v_invoice.status NOT IN ('draft', 'issued') OR EXISTS (
      SELECT 1 FROM catho_private.sponsor_payment_transactions AS transaction
      WHERE transaction.invoice_id = p_invoice_id AND transaction.transaction_type = 'payment'
        AND NOT EXISTS (
          SELECT 1 FROM catho_private.sponsor_payment_transactions AS refund
          WHERE refund.refund_of_payment_id = transaction.id
          GROUP BY refund.refund_of_payment_id
          HAVING sum(refund.amount_minor) >= transaction.amount_minor
        )
    ) THEN RAISE EXCEPTION 'An invoice with unreversed payments cannot be voided' USING ERRCODE = '23514'; END IF;
    v_status := 'void';
  END IF;
  UPDATE catho_private.sponsor_invoices
  SET status = v_status, updated_at = statement_timestamp()
  WHERE id = p_invoice_id RETURNING * INTO v_invoice;
  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.invoice_' || p_action, 'sponsor_invoice', v_invoice.id::text,
    jsonb_build_object('sponsor_id', v_invoice.sponsor_id, 'invoice_number', v_invoice.invoice_number,
      'status', v_invoice.status));
  RETURN jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number,
    'status', v_invoice.status);
END;
$function$;
ALTER FUNCTION public.admin_set_sponsor_invoice_status(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_sponsor_invoice_status(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_sponsor_invoice_status(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_record_sponsor_payment(
  p_actor_user_id uuid, p_sponsor_id uuid, p_invoice_id uuid, p_amount_minor bigint,
  p_currency text, p_bank_reference text DEFAULT NULL, p_bank_transaction_date date DEFAULT NULL,
  p_bank_transaction_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_payment catho_private.sponsor_payment_transactions%ROWTYPE;
  v_inserted integer := 0;
  v_paid_minor bigint := 0;
  v_balance_minor bigint := 0;
  v_net_sponsor_paid bigint := 0;
  v_refund_total bigint := 0;
  v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_invoice_id IS NULL OR p_amount_minor IS NULL
     OR p_amount_minor NOT BETWEEN 1 AND 100000000000 OR p_currency NOT IN ('GBP', 'EUR', 'USD')
     OR (p_bank_reference IS NOT NULL AND char_length(p_bank_reference) > 120)
     OR (p_bank_transaction_key IS NOT NULL AND char_length(p_bank_transaction_key) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Invalid bank payment details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_invoice FROM catho_private.sponsor_invoices
  WHERE id = p_invoice_id AND sponsor_id = p_sponsor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found for this sponsor' USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status NOT IN ('issued', 'paid') OR v_invoice.currency <> p_currency THEN
    RAISE EXCEPTION 'Payment must match an issued invoice and its currency' USING ERRCODE = '23514';
  END IF;

  IF p_bank_transaction_key IS NOT NULL THEN
    SELECT * INTO v_payment FROM catho_private.sponsor_payment_transactions
    WHERE bank_transaction_key = p_bank_transaction_key;
    IF FOUND THEN
      IF v_payment.sponsor_id = p_sponsor_id AND v_payment.invoice_id = p_invoice_id
         AND v_payment.transaction_type = 'payment' AND v_payment.amount_minor = p_amount_minor
         AND v_payment.currency = p_currency THEN
        RETURN jsonb_build_object('id', v_payment.id, 'duplicate', true,
          'invoice_id', v_payment.invoice_id, 'amount_minor', v_payment.amount_minor);
      END IF;
      RAISE EXCEPTION 'Bank transaction reference has already been used' USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
    THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0)
  INTO v_paid_minor
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.invoice_id = p_invoice_id;
  v_balance_minor := v_invoice.amount_minor - v_paid_minor;
  IF v_balance_minor <= 0 OR p_amount_minor > v_balance_minor THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding invoice balance' USING ERRCODE = '23514';
  END IF;

  INSERT INTO catho_private.sponsor_payment_transactions
    (sponsor_id, invoice_id, transaction_type, amount_minor, currency, bank_reference,
     bank_transaction_date, bank_transaction_key, recorded_by)
  VALUES
    (p_sponsor_id, p_invoice_id, 'payment', p_amount_minor, p_currency,
     nullif(btrim(p_bank_reference), ''), p_bank_transaction_date,
     nullif(btrim(p_bank_transaction_key), ''), p_actor_user_id)
  ON CONFLICT DO NOTHING RETURNING * INTO v_payment;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    IF p_bank_transaction_key IS NOT NULL THEN
      SELECT * INTO v_payment FROM catho_private.sponsor_payment_transactions
      WHERE bank_transaction_key = p_bank_transaction_key;
      IF FOUND AND v_payment.sponsor_id = p_sponsor_id AND v_payment.invoice_id = p_invoice_id
         AND v_payment.transaction_type = 'payment' AND v_payment.amount_minor = p_amount_minor
         AND v_payment.currency = p_currency THEN
        RETURN jsonb_build_object('id', v_payment.id, 'duplicate', true,
          'invoice_id', v_payment.invoice_id, 'amount_minor', v_payment.amount_minor);
      END IF;
    END IF;
    RAISE EXCEPTION 'Unable to record duplicate bank transaction' USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
    THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0)
  INTO v_paid_minor
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.invoice_id = p_invoice_id;
  IF v_paid_minor >= v_invoice.amount_minor THEN
    UPDATE catho_private.sponsor_invoices SET status = 'paid', updated_at = statement_timestamp()
    WHERE id = p_invoice_id;
  END IF;

  SELECT * INTO v_sponsor FROM public.sponsors WHERE id = p_sponsor_id FOR UPDATE;
  SELECT
    coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
      THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0),
    coalesce(sum(transaction.amount_minor) FILTER (WHERE transaction.transaction_type = 'refund'), 0)
  INTO v_net_sponsor_paid, v_refund_total
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.sponsor_id = p_sponsor_id;

  IF v_sponsor.agreed_amount_minor IS NOT NULL THEN
    UPDATE public.sponsors SET
      payment_status = CASE
        WHEN v_net_sponsor_paid >= v_sponsor.agreed_amount_minor THEN 'received'
        WHEN v_net_sponsor_paid = 0 AND v_refund_total > 0 THEN 'refunded'
        ELSE 'pending'
      END,
      payment_received_at = CASE
        WHEN v_net_sponsor_paid >= v_sponsor.agreed_amount_minor
          THEN coalesce(payment_received_at, statement_timestamp())
        ELSE NULL
      END,
      payment_reference = coalesce(nullif(btrim(p_bank_reference), ''), payment_reference),
      updated_at = statement_timestamp()
    WHERE id = p_sponsor_id;
  END IF;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.payment_recorded', 'sponsor_payment', v_payment.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'invoice_id', p_invoice_id,
      'amount_minor', p_amount_minor, 'currency', p_currency, 'bank_reference', p_bank_reference));
  RETURN jsonb_build_object('id', v_payment.id, 'duplicate', false,
    'invoice_id', p_invoice_id, 'amount_minor', p_amount_minor,
    'invoice_paid_minor', v_paid_minor, 'invoice_balance_minor', greatest(v_invoice.amount_minor - v_paid_minor, 0));
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_payment(uuid, uuid, uuid, bigint, text, text, date, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_payment(uuid, uuid, uuid, bigint, text, text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_sponsor_payment(uuid, uuid, uuid, bigint, text, text, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_record_sponsor_refund(
  p_actor_user_id uuid, p_payment_id uuid, p_amount_minor bigint,
  p_bank_reference text DEFAULT NULL, p_bank_transaction_date date DEFAULT NULL,
  p_bank_transaction_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_payment catho_private.sponsor_payment_transactions%ROWTYPE;
  v_refund catho_private.sponsor_payment_transactions%ROWTYPE;
  v_refunded_minor bigint := 0;
  v_net_sponsor_paid bigint := 0;
  v_refund_total bigint := 0;
  v_sponsor public.sponsors%ROWTYPE;
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_invoice_paid bigint := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_payment_id IS NULL OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 100000000000
     OR (p_bank_reference IS NOT NULL AND char_length(p_bank_reference) > 120)
     OR (p_bank_transaction_key IS NOT NULL AND char_length(p_bank_transaction_key) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'Invalid refund details' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM catho_private.sponsor_payment_transactions
  WHERE id = p_payment_id AND transaction_type = 'payment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original payment not found' USING ERRCODE = 'P0002'; END IF;
  IF p_bank_transaction_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM catho_private.sponsor_payment_transactions
    WHERE bank_transaction_key = p_bank_transaction_key
  ) THEN RAISE EXCEPTION 'Bank transaction reference has already been used' USING ERRCODE = '23505'; END IF;

  SELECT coalesce(sum(refund.amount_minor), 0) INTO v_refunded_minor
  FROM catho_private.sponsor_payment_transactions AS refund
  WHERE refund.refund_of_payment_id = p_payment_id;
  IF p_amount_minor > v_payment.amount_minor - v_refunded_minor THEN
    RAISE EXCEPTION 'Refund exceeds the unrefunded payment amount' USING ERRCODE = '23514';
  END IF;

  INSERT INTO catho_private.sponsor_payment_transactions
    (sponsor_id, invoice_id, transaction_type, amount_minor, currency, bank_reference,
     bank_transaction_date, bank_transaction_key, refund_of_payment_id, recorded_by)
  VALUES
    (v_payment.sponsor_id, v_payment.invoice_id, 'refund', p_amount_minor, v_payment.currency,
     nullif(btrim(p_bank_reference), ''), p_bank_transaction_date,
     nullif(btrim(p_bank_transaction_key), ''), p_payment_id, p_actor_user_id)
  RETURNING * INTO v_refund;

  SELECT * INTO v_invoice FROM catho_private.sponsor_invoices
  WHERE id = v_payment.invoice_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
    THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0)
  INTO v_invoice_paid FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.invoice_id = v_payment.invoice_id;
  IF v_invoice_paid < v_invoice.amount_minor AND v_invoice.status = 'paid' THEN
    UPDATE catho_private.sponsor_invoices SET status = 'issued', updated_at = statement_timestamp()
    WHERE id = v_invoice.id;
  END IF;

  SELECT * INTO v_sponsor FROM public.sponsors WHERE id = v_payment.sponsor_id FOR UPDATE;
  SELECT
    coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
      THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0),
    coalesce(sum(transaction.amount_minor) FILTER (WHERE transaction.transaction_type = 'refund'), 0)
  INTO v_net_sponsor_paid, v_refund_total
  FROM catho_private.sponsor_payment_transactions AS transaction
  WHERE transaction.sponsor_id = v_payment.sponsor_id;
  IF v_sponsor.agreed_amount_minor IS NOT NULL THEN
    UPDATE public.sponsors SET
      payment_status = CASE
        WHEN v_net_sponsor_paid >= v_sponsor.agreed_amount_minor THEN 'received'
        WHEN v_net_sponsor_paid = 0 AND v_refund_total > 0 THEN 'refunded'
        ELSE 'pending'
      END,
      payment_received_at = CASE
        WHEN v_net_sponsor_paid >= v_sponsor.agreed_amount_minor
          THEN coalesce(payment_received_at, statement_timestamp())
        ELSE NULL
      END,
      updated_at = statement_timestamp()
    WHERE id = v_payment.sponsor_id;
  END IF;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.payment_refunded', 'sponsor_payment', v_refund.id::text,
    jsonb_build_object('sponsor_id', v_payment.sponsor_id, 'invoice_id', v_payment.invoice_id,
      'original_payment_id', p_payment_id, 'amount_minor', p_amount_minor, 'currency', v_payment.currency));
  RETURN jsonb_build_object('id', v_refund.id, 'original_payment_id', p_payment_id,
    'amount_minor', p_amount_minor, 'invoice_paid_minor', v_invoice_paid);
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_admin_sponsor_financials(
  p_actor_user_id uuid, p_sponsor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.sponsors WHERE id = p_sponsor_id) THEN
    RAISE EXCEPTION 'Sponsor not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT jsonb_build_object(
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', invoice.id, 'invoice_number', invoice.invoice_number, 'description', invoice.description,
        'amount_minor', invoice.amount_minor, 'currency', invoice.currency,
        'issued_on', invoice.issued_on, 'due_on', invoice.due_on, 'status', invoice.status,
        'paid_minor', invoice.paid_minor, 'balance_minor', greatest(invoice.amount_minor - invoice.paid_minor, 0)
      ) ORDER BY invoice.created_at DESC)
      FROM (
        SELECT inv.*, coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
          THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0) AS paid_minor
        FROM catho_private.sponsor_invoices AS inv
        LEFT JOIN catho_private.sponsor_payment_transactions AS transaction ON transaction.invoice_id = inv.id
        WHERE inv.sponsor_id = p_sponsor_id
        GROUP BY inv.id ORDER BY inv.created_at DESC LIMIT 100
      ) AS invoice
    ), '[]'::jsonb),
    'transactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', transaction.id, 'invoice_id', transaction.invoice_id,
        'transaction_type', transaction.transaction_type, 'amount_minor', transaction.amount_minor,
        'currency', transaction.currency, 'bank_reference', transaction.bank_reference,
        'bank_transaction_date', transaction.bank_transaction_date,
        'received_at', transaction.received_at, 'refund_of_payment_id', transaction.refund_of_payment_id
      ) ORDER BY transaction.received_at DESC)
      FROM (
        SELECT * FROM catho_private.sponsor_payment_transactions
        WHERE sponsor_id = p_sponsor_id ORDER BY received_at DESC LIMIT 200
      ) AS transaction
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_admin_sponsor_financials(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_sponsor_financials(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_sponsor_financials(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_sponsor_financials(
  p_actor_user_id uuid, p_sponsor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sponsor_memberships AS membership
    WHERE membership.sponsor_id = p_sponsor_id AND membership.user_id = p_actor_user_id
      AND membership.status = 'active'
  ) THEN RAISE EXCEPTION 'Sponsor dashboard access required' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', invoice.id, 'invoice_number', invoice.invoice_number, 'description', invoice.description,
        'amount_minor', invoice.amount_minor, 'currency', invoice.currency,
        'issued_on', invoice.issued_on, 'due_on', invoice.due_on, 'status', invoice.status,
        'paid_minor', invoice.paid_minor, 'balance_minor', greatest(invoice.amount_minor - invoice.paid_minor, 0)
      ) ORDER BY invoice.created_at DESC)
      FROM (
        SELECT inv.*, coalesce(sum(CASE WHEN transaction.transaction_type = 'payment'
          THEN transaction.amount_minor ELSE -transaction.amount_minor END), 0) AS paid_minor
        FROM catho_private.sponsor_invoices AS inv
        LEFT JOIN catho_private.sponsor_payment_transactions AS transaction ON transaction.invoice_id = inv.id
        WHERE inv.sponsor_id = p_sponsor_id
        GROUP BY inv.id ORDER BY inv.created_at DESC LIMIT 100
      ) AS invoice
    ), '[]'::jsonb),
    'transactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', transaction.id, 'invoice_id', transaction.invoice_id,
        'transaction_type', transaction.transaction_type, 'amount_minor', transaction.amount_minor,
        'currency', transaction.currency, 'bank_reference', transaction.bank_reference,
        'bank_transaction_date', transaction.bank_transaction_date,
        'received_at', transaction.received_at
      ) ORDER BY transaction.received_at DESC)
      FROM (
        SELECT * FROM catho_private.sponsor_payment_transactions
        WHERE sponsor_id = p_sponsor_id ORDER BY received_at DESC LIMIT 200
      ) AS transaction
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_sponsor_financials(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_sponsor_financials(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sponsor_financials(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
