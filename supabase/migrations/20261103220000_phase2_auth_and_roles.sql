CREATE TABLE IF NOT EXISTS public.app_members (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER')),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

ALTER TABLE public.app_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_app_members_role ON public.app_members(role);
REVOKE ALL ON TABLE public.app_members FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.app_members TO authenticated;

CREATE OR REPLACE FUNCTION public.has_any_app_role(required_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_members AS member
    WHERE member.user_id = (SELECT auth.uid())
      AND member.role = ANY(required_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_any_app_role(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_app_role(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_app_member_roles(
  target_user_id uuid,
  new_roles text[],
  actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_roles text[] := COALESCE(new_roles, ARRAY[]::text[]);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app_member_role_updates'));

  IF EXISTS (
    SELECT 1
    FROM unnest(normalized_roles) AS requested(role)
    WHERE requested.role NOT IN ('ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER')
  ) THEN
    RAISE EXCEPTION 'One or more roles are invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.app_members
    WHERE user_id = target_user_id AND role = 'ADMIN'
  )
  AND NOT ('ADMIN' = ANY(normalized_roles))
  AND (
    SELECT count(*) FROM public.app_members WHERE role = 'ADMIN'
  ) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last administrator';
  END IF;

  DELETE FROM public.app_members WHERE user_id = target_user_id;

  INSERT INTO public.app_members (user_id, role, assigned_by)
  SELECT target_user_id, requested.role, actor_user_id
  FROM (
    SELECT DISTINCT unnest(normalized_roles) AS role
  ) AS requested;
END;
$$;

REVOKE ALL ON FUNCTION public.set_app_member_roles(uuid, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_app_member_roles(uuid, text[], uuid) TO service_role;

DROP POLICY IF EXISTS "Allow public access on material_catalog" ON public.material_catalog;
DROP POLICY IF EXISTS "Allow public access on materials" ON public.materials;
DROP POLICY IF EXISTS "Allow public access on projects" ON public.projects;
DROP POLICY IF EXISTS "Allow public access on rfq_batches" ON public.rfq_batches;
DROP POLICY IF EXISTS "Allow public access on rfq_line_items" ON public.rfq_line_items;
DROP POLICY IF EXISTS "Allow public access on suppliers" ON public.suppliers;

DROP POLICY IF EXISTS "app_members_select" ON public.app_members;
DROP POLICY IF EXISTS "app_members_admin_manage" ON public.app_members;
CREATE POLICY "app_members_select" ON public.app_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_any_app_role(ARRAY['ADMIN']));
CREATE POLICY "app_members_admin_manage" ON public.app_members
  FOR ALL TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN']));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'projects', 'materials', 'suppliers', 'material_catalog', 'rfq_batches', 'rfq_line_items'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
  END LOOP;
END;
$$;

CREATE POLICY "projects_member_read" ON public.projects
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "projects_manager_insert" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "projects_manager_update" ON public.projects
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "projects_admin_delete" ON public.projects
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN']));

CREATE POLICY "materials_member_read" ON public.materials
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "materials_manager_insert" ON public.materials
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "materials_manager_update" ON public.materials
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "materials_manager_delete" ON public.materials
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));

CREATE POLICY "suppliers_member_read" ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "suppliers_manager_insert" ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "suppliers_manager_update" ON public.suppliers
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "suppliers_manager_delete" ON public.suppliers
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));

CREATE POLICY "catalog_member_read" ON public.material_catalog
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "catalog_manager_insert" ON public.material_catalog
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "catalog_manager_update" ON public.material_catalog
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "catalog_manager_delete" ON public.material_catalog
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));

CREATE POLICY "rfq_batches_member_read" ON public.rfq_batches
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "rfq_batches_manager_insert" ON public.rfq_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "rfq_batches_manager_update" ON public.rfq_batches
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "rfq_batches_manager_delete" ON public.rfq_batches
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));

CREATE POLICY "rfq_line_items_member_read" ON public.rfq_line_items
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "rfq_line_items_manager_insert" ON public.rfq_line_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "rfq_line_items_manager_update" ON public.rfq_line_items
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "rfq_line_items_manager_delete" ON public.rfq_line_items
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
