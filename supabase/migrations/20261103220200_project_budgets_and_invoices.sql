ALTER TABLE public.projects
  ADD COLUMN material_budget numeric(14, 2) CHECK (material_budget IS NULL OR material_budget >= 0);

CREATE OR REPLACE FUNCTION public.protect_project_material_budget()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.material_budget IS DISTINCT FROM NEW.material_budget
    AND NOT public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) THEN
    RAISE EXCEPTION 'Only administrators and cost editors may change a project material budget';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_project_material_budget
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_project_material_budget();

CREATE TABLE public.material_invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  vendor_name varchar(255) NOT NULL,
  invoice_number varchar(255),
  invoice_date date NOT NULL,
  invoice_total numeric(14, 2) NOT NULL CHECK (invoice_total >= 0),
  notes text,
  file_path text NOT NULL,
  file_name varchar(255) NOT NULL,
  file_mime_type varchar(100) NOT NULL,
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOID')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  CHECK (
    (status = 'POSTED' AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL)
    OR
    (status = 'VOID' AND voided_by IS NOT NULL AND voided_at IS NOT NULL AND nullif(btrim(void_reason), '') IS NOT NULL)
  )
);

CREATE INDEX idx_material_invoices_project_date ON public.material_invoices(project_id, invoice_date DESC);
CREATE INDEX idx_material_invoices_supplier ON public.material_invoices(supplier_id);
CREATE INDEX idx_material_invoices_status ON public.material_invoices(project_id, status);

CREATE TABLE public.material_invoice_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id uuid NOT NULL REFERENCES public.material_invoices(id) ON DELETE CASCADE,
  source_material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  item_number integer,
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'EA',
  unit_price numeric(14, 4) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14, 2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_material_invoice_items_invoice ON public.material_invoice_items(invoice_id);

CREATE OR REPLACE FUNCTION public.protect_material_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status <> 'POSTED'
    OR NEW.status <> 'VOID'
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.supplier_id IS DISTINCT FROM NEW.supplier_id
    OR OLD.vendor_name IS DISTINCT FROM NEW.vendor_name
    OR OLD.invoice_number IS DISTINCT FROM NEW.invoice_number
    OR OLD.invoice_date IS DISTINCT FROM NEW.invoice_date
    OR OLD.invoice_total IS DISTINCT FROM NEW.invoice_total
    OR OLD.notes IS DISTINCT FROM NEW.notes
    OR OLD.file_path IS DISTINCT FROM NEW.file_path
    OR OLD.file_name IS DISTINCT FROM NEW.file_name
    OR OLD.file_mime_type IS DISTINCT FROM NEW.file_mime_type
    OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.void_reason IS NULL
    OR nullif(btrim(NEW.void_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Invoices are immutable; only posting an invoice as void with a reason is allowed';
  END IF;

  IF NOT public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) THEN
    RAISE EXCEPTION 'Only administrators and cost editors may void an invoice';
  END IF;

  NEW.voided_by := (SELECT auth.uid());
  NEW.voided_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_material_invoice
  BEFORE UPDATE ON public.material_invoices
  FOR EACH ROW EXECUTE FUNCTION public.protect_material_invoice();

ALTER TABLE public.material_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_invoice_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.material_invoices, public.material_invoice_items FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.material_invoices TO authenticated;
GRANT SELECT ON TABLE public.material_invoice_items TO authenticated;

CREATE POLICY "material_invoices_member_read" ON public.material_invoices
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "material_invoices_editor_void" ON public.material_invoices
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) AND status = 'POSTED')
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) AND status = 'VOID');

CREATE POLICY "material_invoice_items_member_read" ON public.material_invoice_items
  FOR SELECT TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1 FROM public.material_invoices AS invoice
      WHERE invoice.id = invoice_id
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-invoices',
  'project-invoices',
  false,
  20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

CREATE POLICY "project_invoice_files_member_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-invoices'
    AND public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "project_invoice_files_editor_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-invoices'
    AND public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR'])
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "project_invoice_files_editor_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-invoices'
    AND public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR'])
    AND NOT EXISTS (
      SELECT 1 FROM public.material_invoices AS invoice
      WHERE invoice.file_path = name
    )
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id::text = (storage.foldername(name))[1]
    )
  );

CREATE OR REPLACE FUNCTION public.set_project_material_budget(
  p_project_id uuid,
  p_material_budget numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF NOT public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) THEN
    RAISE EXCEPTION 'Only administrators and cost editors may change a project material budget';
  END IF;

  UPDATE public.projects
  SET material_budget = p_material_budget
  WHERE id = p_project_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count = 0 THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_material_budget(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_material_budget(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_material_invoice(
  p_project_id uuid,
  p_supplier_id uuid,
  p_vendor_name text,
  p_invoice_number text,
  p_invoice_date date,
  p_invoice_total numeric,
  p_notes text,
  p_file_path text,
  p_file_name text,
  p_file_mime_type text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_invoice_id uuid;
BEGIN
  IF NOT public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) THEN
    RAISE EXCEPTION 'Only administrators and cost editors may record invoices';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one invoice line item is required';
  END IF;
  IF p_project_id IS NULL OR p_file_path IS NULL OR split_part(p_file_path, '/', 1) <> p_project_id::text
    OR nullif(btrim(p_file_name), '') IS NULL
    OR p_file_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    OR nullif(btrim(p_vendor_name), '') IS NULL THEN
    RAISE EXCEPTION 'Invoice file path, file name, and vendor name are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'project-invoices' AND object.name = p_file_path
  ) THEN
    RAISE EXCEPTION 'Uploaded invoice file was not found in private storage';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(source_material_id uuid)
    LEFT JOIN public.materials AS material ON material.id = item.source_material_id
    WHERE item.source_material_id IS NOT NULL AND material.project_id IS DISTINCT FROM p_project_id
  ) THEN
    RAISE EXCEPTION 'Invoice line items must reference materials from this project';
  END IF;

  INSERT INTO public.material_invoices (
    project_id, supplier_id, vendor_name, invoice_number, invoice_date, invoice_total,
    notes, file_path, file_name, file_mime_type, created_by
  )
  VALUES (
    p_project_id, p_supplier_id, btrim(p_vendor_name), NULLIF(btrim(p_invoice_number), ''),
    p_invoice_date, p_invoice_total, NULLIF(btrim(p_notes), ''), p_file_path, p_file_name,
    p_file_mime_type, (SELECT auth.uid())
  )
  RETURNING id INTO new_invoice_id;

  INSERT INTO public.material_invoice_items (
    invoice_id, source_material_id, item_number, description, quantity, unit, unit_price
  )
  SELECT
    new_invoice_id, item.source_material_id, item.item_number, item.description,
    item.quantity, item.unit, item.unit_price
  FROM jsonb_to_recordset(p_items) AS item(
    source_material_id uuid,
    item_number integer,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric
  );

  RETURN new_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_material_invoice(uuid, uuid, text, text, date, numeric, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_material_invoice(uuid, uuid, text, text, date, numeric, text, text, text, text, jsonb) TO authenticated;
