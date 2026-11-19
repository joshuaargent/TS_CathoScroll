-- CathoScroll authenticated recommendation RPC permissions
-- Apply to existing projects after deploying the matching recommendation function.
--
-- The recommendation RPC reads private, per-user consent and interest tables.
-- It must run with its owner's privileges, while deriving the effective user
-- exclusively from auth.uid() and validating cursor.userId against that value.
-- Its function body uses a fixed empty search_path and static SQL.
--
-- Do not grant authenticated direct SELECT access to catho_private consent or
-- interest tables. The status and consent mutation RPCs remain the only public
-- interface to those records.

ALTER FUNCTION public.get_my_recommendation_page(jsonb, integer) SECURITY DEFINER;
ALTER FUNCTION public.get_my_recommendation_page(jsonb, integer) SET search_path TO '';

REVOKE ALL ON FUNCTION public.get_my_recommendation_page(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_page(jsonb, integer) TO authenticated;
