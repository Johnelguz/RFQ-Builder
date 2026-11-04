ALTER TABLE public.material_invoice_items
  DROP CONSTRAINT material_invoice_items_quantity_check,
  ADD CONSTRAINT material_invoice_items_quantity_nonnegative_check CHECK (quantity >= 0),
  ADD COLUMN actual_line_cost numeric(14, 2) CHECK (actual_line_cost IS NULL OR actual_line_cost >= 0),
  DROP COLUMN line_total;

ALTER TABLE public.material_invoice_items
  ADD COLUMN line_total numeric(14, 2)
    GENERATED ALWAYS AS (COALESCE(actual_line_cost, round(quantity * unit_price, 2))) STORED;

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
    invoice_id, source_material_id, item_number, description, quantity, unit, unit_price, actual_line_cost
  )
  SELECT
    new_invoice_id, item.source_material_id, item.item_number, item.description,
    item.quantity, item.unit, item.unit_price, item.actual_line_cost
  FROM jsonb_to_recordset(p_items) AS item(
    source_material_id uuid,
    item_number integer,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    actual_line_cost numeric
  );

  RETURN new_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_material_invoice(uuid, uuid, text, text, date, numeric, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_material_invoice(uuid, uuid, text, text, date, numeric, text, text, text, text, jsonb) TO authenticated;
