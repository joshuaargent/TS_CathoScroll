
CREATE OR REPLACE FUNCTION public.admin_create_sponsor(
  p_actor_user_id uuid, p_sponsor_name text, p_contact_email text, p_website_url text,
  p_logo_url text, p_description text, p_starts_on date, p_ends_on date, p_status text,
  p_agreed_amount_minor bigint, p_currency text, p_payment_status text,
  p_payment_reference text, p_admin_notes text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_payment_status IS NULL OR p_payment_status NOT IN ('pending', 'not_required') THEN
    RAISE EXCEPTION 'New sponsor payment status must be pending or not required; reconcile payments through an invoice' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sponsors (
    sponsor_name, contact_email, website_url, logo_url, description, starts_on, ends_on,
    status, agreed_amount_minor, currency, payment_status, payment_received_at,
    payment_reference, admin_notes, created_by
  ) VALUES (
    btrim(p_sponsor_name), nullif(btrim(p_contact_email), ''), nullif(btrim(p_website_url), ''),
    nullif(btrim(p_logo_url), ''), coalesce(p_description, ''), p_starts_on, p_ends_on,
    p_status, p_agreed_amount_minor, p_currency, p_payment_status, NULL,
    NULL, coalesce(p_admin_notes, ''), p_actor_user_id
  ) RETURNING * INTO v_sponsor;
  INSERT INTO catho_private.admin_action_audit (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.created', 'sponsor', v_sponsor.id::text,
    jsonb_build_object('sponsor_name', v_sponsor.sponsor_name, 'status', v_sponsor.status,
      'payment_status', v_sponsor.payment_status, 'currency', v_sponsor.currency,
      'agreed_amount_minor', v_sponsor.agreed_amount_minor));
  RETURN jsonb_build_object('id', v_sponsor.id, 'sponsor_name', v_sponsor.sponsor_name,
    'status', v_sponsor.status, 'payment_status', v_sponsor.payment_status,
    'created_at', v_sponsor.created_at);
END;
$function$;
ALTER FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_sponsor(uuid, text, text, text, text, text, date, date, text, bigint, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_mark_sponsor_payment_received(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

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
     OR p_currency IS NULL OR p_currency NOT IN ('GBP', 'EUR', 'USD')
     OR p_issued_on IS NULL OR p_due_on IS NULL OR p_due_on < p_issued_on
     OR p_issue_now IS NULL THEN
    RAISE EXCEPTION 'Invalid sponsor invoice details' USING ERRCODE = '22023';
  END IF;
  INSERT INTO catho_private.sponsor_invoices
    (sponsor_id, description, amount_minor, currency, issued_on, due_on, status, created_by)
  VALUES (p_sponsor_id, btrim(p_description), p_amount_minor, p_currency, p_issued_on, p_due_on,
    CASE WHEN p_issue_now THEN 'issued' ELSE 'draft' END, p_actor_user_id)
  RETURNING * INTO v_invoice;
  IF p_issue_now THEN
    UPDATE public.sponsors
    SET payment_status = 'pending', payment_received_at = NULL, updated_at = statement_timestamp()
    WHERE id = p_sponsor_id;
  END IF;
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
  v_outstanding_invoice_minor bigint := 0;
  v_sponsor public.sponsors%ROWTYPE;
  v_fully_reconciled boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  IF p_sponsor_id IS NULL OR p_invoice_id IS NULL OR p_amount_minor IS NULL
     OR p_amount_minor NOT BETWEEN 1 AND 100000000000 OR p_currency IS NULL
     OR p_currency NOT IN ('GBP', 'EUR', 'USD')
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
  VALUES (p_sponsor_id, p_invoice_id, 'payment', p_amount_minor, p_currency,
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
  SELECT coalesce(sum(greatest(invoice.amount_minor - coalesce(paid.paid_minor, 0), 0)), 0)
  INTO v_outstanding_invoice_minor
  FROM catho_private.sponsor_invoices AS invoice
  LEFT JOIN (
    SELECT invoice_id,
      sum(CASE WHEN transaction_type = 'payment' THEN amount_minor ELSE -amount_minor END) AS paid_minor
    FROM catho_private.sponsor_payment_transactions
    GROUP BY invoice_id
  ) AS paid ON paid.invoice_id = invoice.id
  WHERE invoice.sponsor_id = p_sponsor_id AND invoice.status = 'issued';
  v_fully_reconciled := v_outstanding_invoice_minor = 0
    AND (v_sponsor.agreed_amount_minor IS NULL OR v_net_sponsor_paid >= v_sponsor.agreed_amount_minor);
  UPDATE public.sponsors SET
    payment_status = CASE
      WHEN v_fully_reconciled THEN 'received'
      WHEN v_net_sponsor_paid = 0 AND v_refund_total > 0 THEN 'refunded'
      ELSE 'pending'
    END,
    payment_received_at = CASE
      WHEN v_fully_reconciled THEN coalesce(payment_received_at, statement_timestamp())
      ELSE NULL
    END,
    payment_reference = coalesce(nullif(btrim(p_bank_reference), ''), payment_reference),
    updated_at = statement_timestamp()
  WHERE id = p_sponsor_id;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.payment_recorded', 'sponsor_payment', v_payment.id::text,
    jsonb_build_object('sponsor_id', p_sponsor_id, 'invoice_id', p_invoice_id,
      'amount_minor', p_amount_minor, 'currency', p_currency, 'bank_reference', p_bank_reference));
  RETURN jsonb_build_object('id', v_payment.id, 'duplicate', false,
    'invoice_id', p_invoice_id, 'amount_minor', p_amount_minor,
    'invoice_paid_minor', v_paid_minor, 'invoice_balance_minor', greatest(v_invoice.amount_minor - v_paid_minor, 0),
    'sponsor_payment_status', CASE WHEN v_fully_reconciled THEN 'received' ELSE 'pending' END);
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
  v_outstanding_invoice_minor bigint := 0;
  v_sponsor public.sponsors%ROWTYPE;
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_invoice_paid bigint := 0;
  v_fully_reconciled boolean := false;
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
  VALUES (v_payment.sponsor_id, v_payment.invoice_id, 'refund', p_amount_minor, v_payment.currency,
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
  SELECT coalesce(sum(greatest(invoice.amount_minor - coalesce(paid.paid_minor, 0), 0)), 0)
  INTO v_outstanding_invoice_minor
  FROM catho_private.sponsor_invoices AS invoice
  LEFT JOIN (
    SELECT invoice_id,
      sum(CASE WHEN transaction_type = 'payment' THEN amount_minor ELSE -amount_minor END) AS paid_minor
    FROM catho_private.sponsor_payment_transactions
    GROUP BY invoice_id
  ) AS paid ON paid.invoice_id = invoice.id
  WHERE invoice.sponsor_id = v_payment.sponsor_id AND invoice.status = 'issued';
  v_fully_reconciled := v_outstanding_invoice_minor = 0
    AND (v_sponsor.agreed_amount_minor IS NULL OR v_net_sponsor_paid >= v_sponsor.agreed_amount_minor);
  UPDATE public.sponsors SET
    payment_status = CASE
      WHEN v_fully_reconciled THEN 'received'
      WHEN v_net_sponsor_paid = 0 AND v_refund_total > 0 THEN 'refunded'
      ELSE 'pending'
    END,
    payment_received_at = CASE
      WHEN v_fully_reconciled THEN coalesce(payment_received_at, statement_timestamp())
      ELSE NULL
    END,
    updated_at = statement_timestamp()
  WHERE id = v_payment.sponsor_id;

  INSERT INTO catho_private.admin_action_audit
    (actor_user_id, action, target_type, target_id, details)
  VALUES (p_actor_user_id, 'sponsor.payment_refunded', 'sponsor_payment', v_refund.id::text,
    jsonb_build_object('sponsor_id', v_payment.sponsor_id, 'invoice_id', v_payment.invoice_id,
      'original_payment_id', p_payment_id, 'amount_minor', p_amount_minor, 'currency', v_payment.currency));
  RETURN jsonb_build_object('id', v_refund.id, 'original_payment_id', p_payment_id,
    'amount_minor', p_amount_minor, 'invoice_paid_minor', v_invoice_paid,
    'sponsor_payment_status', CASE WHEN v_fully_reconciled THEN 'received' ELSE 'pending' END);
END;
$function$;
ALTER FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_sponsor_refund(uuid, uuid, bigint, text, date, text) TO service_role;
