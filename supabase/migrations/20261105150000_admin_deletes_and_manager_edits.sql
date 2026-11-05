DROP POLICY IF EXISTS "suppliers_manager_delete" ON public.suppliers;
CREATE POLICY "suppliers_admin_delete" ON public.suppliers
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN']));

ALTER TABLE public.vendor_quotes
  ADD COLUMN supplier_name text,
  ALTER COLUMN supplier_id DROP NOT NULL,
  DROP CONSTRAINT vendor_quotes_supplier_id_fkey,
  ADD CONSTRAINT vendor_quotes_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;

UPDATE public.vendor_quotes AS quote
SET supplier_name = supplier.company_name
FROM public.suppliers AS supplier
WHERE quote.supplier_id = supplier.id;

CREATE OR REPLACE FUNCTION public.set_vendor_quote_supplier_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT supplier.company_name INTO NEW.supplier_name
    FROM public.suppliers AS supplier
    WHERE supplier.id = NEW.supplier_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_vendor_quote_supplier_name
  BEFORE INSERT OR UPDATE OF supplier_id ON public.vendor_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_vendor_quote_supplier_name();

CREATE OR REPLACE FUNCTION public.protect_material_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'POSTED' THEN
    IF OLD.project_id IS DISTINCT FROM NEW.project_id
      OR OLD.file_path IS DISTINCT FROM NEW.file_path
      OR OLD.file_name IS DISTINCT FROM NEW.file_name
      OR OLD.file_mime_type IS DISTINCT FROM NEW.file_mime_type
      OR OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.created_at IS DISTINCT FROM NEW.created_at
      OR OLD.voided_by IS DISTINCT FROM NEW.voided_by
      OR OLD.voided_at IS DISTINCT FROM NEW.voided_at
      OR OLD.void_reason IS DISTINCT FROM NEW.void_reason THEN
      RAISE EXCEPTION 'Only invoice header details may be edited';
    END IF;

    IF NOT public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']) THEN
      RAISE EXCEPTION 'Only administrators and RFQ managers may edit invoice details';
    END IF;
    RETURN NEW;
  END IF;

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
    RAISE EXCEPTION 'Posted invoices may be edited or voided; voided invoices are immutable';
  END IF;

  IF NOT public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) THEN
    RAISE EXCEPTION 'Only administrators and cost editors may void an invoice';
  END IF;

  NEW.voided_by := (SELECT auth.uid());
  NEW.voided_at := now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "material_invoices_editor_void" ON public.material_invoices;
CREATE POLICY "material_invoices_manager_edit" ON public.material_invoices
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']) AND status = 'POSTED')
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']) AND status = 'POSTED');
CREATE POLICY "material_invoices_editor_void" ON public.material_invoices
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) AND status = 'POSTED')
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'COST_EDITOR']) AND status = 'VOID');

GRANT DELETE ON TABLE public.material_invoices TO authenticated;
CREATE POLICY "material_invoices_admin_delete" ON public.material_invoices
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN']));
