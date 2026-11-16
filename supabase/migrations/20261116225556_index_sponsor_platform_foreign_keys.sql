
CREATE INDEX sponsor_invoices_created_by_idx
  ON catho_private.sponsor_invoices (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX sponsor_member_audit_actor_created_idx
  ON catho_private.sponsor_member_audit (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX sponsor_member_audit_campaign_idx
  ON catho_private.sponsor_member_audit (campaign_id)
  WHERE campaign_id IS NOT NULL;
CREATE INDEX sponsor_member_audit_target_user_idx
  ON catho_private.sponsor_member_audit (target_user_id)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX sponsor_payment_transactions_recorded_by_idx
  ON catho_private.sponsor_payment_transactions (recorded_by, received_at DESC)
  WHERE recorded_by IS NOT NULL;
CREATE INDEX sponsor_memberships_added_by_idx
  ON public.sponsor_memberships (added_by)
  WHERE added_by IS NOT NULL;
