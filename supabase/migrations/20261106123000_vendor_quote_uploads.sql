ALTER TABLE public.vendor_quotes
  ADD COLUMN material_category text NOT NULL DEFAULT 'General',
  ADD COLUMN quoted_total numeric(14, 2) CHECK (quoted_total IS NULL OR quoted_total >= 0),
  ADD COLUMN file_path text,
  ADD COLUMN file_name text,
  ADD COLUMN file_mime_type text,
  ADD CONSTRAINT vendor_quotes_file_details_check CHECK (
    (file_path IS NULL AND file_name IS NULL AND file_mime_type IS NULL)
    OR (file_path IS NOT NULL AND file_name IS NOT NULL AND file_mime_type IS NOT NULL
      AND file_mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
  ),
  ADD CONSTRAINT vendor_quotes_file_path_project_check CHECK (
    file_path IS NULL OR file_path LIKE project_id::text || '/%'
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-vendor-quotes',
  'project-vendor-quotes',
  false,
  20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

CREATE POLICY "project_vendor_quote_files_member_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-vendor-quotes'
    AND public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1 FROM public.vendor_quotes AS quote
      WHERE quote.file_path = name
        AND quote.project_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "project_vendor_quote_files_manager_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-vendor-quotes'
    AND public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "project_vendor_quote_files_manager_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-vendor-quotes'
    AND public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_quotes AS quote
      WHERE quote.file_path = name
    )
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id::text = (storage.foldername(name))[1]
    )
  );

CREATE OR REPLACE FUNCTION public.create_vendor_quote(
  p_project_id uuid,
  p_supplier_id uuid,
  p_quote_reference text,
  p_quoted_date date,
  p_notes text,
  p_freight numeric,
  p_tax numeric,
  p_other_charges numeric,
  p_material_category text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  new_quote_id uuid;
BEGIN
  new_quote_id := public.create_vendor_quote(
    p_project_id, p_supplier_id, p_quote_reference, p_quoted_date, p_notes,
    p_freight, p_tax, p_other_charges, p_items
  );

  UPDATE public.vendor_quotes
  SET material_category = COALESCE(NULLIF(btrim(p_material_category), ''), 'General')
  WHERE id = new_quote_id;

  RETURN new_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_vendor_quote(uuid, uuid, text, date, text, numeric, numeric, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vendor_quote(uuid, uuid, text, date, text, numeric, numeric, numeric, text, jsonb) TO authenticated;
