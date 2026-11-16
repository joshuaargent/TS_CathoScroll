
CREATE OR REPLACE FUNCTION public.admin_create_sponsor_invoice(
  p_actor_user_id uuid, p_sponsor_id uuid, p_description text, p_amount_minor bigint,
  p_currency text, p_issued_on date, p_due_on date, p_issue_now boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_invoice catho_private.sponsor_invoices%ROWTYPE;
  v_sponsor public.sponsors%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_users AS admins WHERE admins.user_id = p_actor_user_id
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_sponsor FROM public.sponsors WHERE id = p_sponsor_id;
  IF NOT FOUND OR char_length(btrim(coalesce(p_description, ''))) NOT BETWEEN 2 AND 500
     OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 100000000000
     OR p_currency IS NULL OR p_currency NOT IN ('GBP', 'EUR', 'USD')
     OR p_currency <> v_sponsor.currency
     OR p_issued_on IS NULL OR p_due_on IS NULL OR p_due_on < p_issued_on
     OR p_issue_now IS NULL THEN
    RAISE EXCEPTION 'Invoice details must match the sponsor agreement and use valid dates and amounts' USING ERRCODE = '22023';
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
