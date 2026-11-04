CREATE TABLE public.vendor_quotes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  quote_reference varchar(255),
  quoted_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  freight numeric(12, 2) NOT NULL DEFAULT 0 CHECK (freight >= 0),
  tax numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  other_charges numeric(12, 2) NOT NULL DEFAULT 0 CHECK (other_charges >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.vendor_quotes IS 'Vendor quote header, including non-material charges; line-item details are snapshotted separately.';

CREATE INDEX idx_vendor_quotes_project_id ON public.vendor_quotes(project_id);
CREATE INDEX idx_vendor_quotes_supplier_id ON public.vendor_quotes(supplier_id);
CREATE INDEX idx_vendor_quotes_quoted_date ON public.vendor_quotes(quoted_date);

CREATE TABLE public.vendor_quote_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_quote_id uuid NOT NULL REFERENCES public.vendor_quotes(id) ON DELETE CASCADE,
  source_material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  item_number integer,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit public.material_unit NOT NULL DEFAULT 'EA',
  description text NOT NULL,
  manufacturer varchar(255),
  model_number varchar(255),
  sheet_reference varchar(100),
  notes text,
  quoted_unit_price numeric(14, 4) CHECK (quoted_unit_price IS NULL OR quoted_unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_quote_items_quote_id ON public.vendor_quote_items(vendor_quote_id);
CREATE INDEX idx_vendor_quote_items_source_material_id ON public.vendor_quote_items(source_material_id);

CREATE TRIGGER update_vendor_quotes_modtime
  BEFORE UPDATE ON public.vendor_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

ALTER TABLE public.vendor_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_quote_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendor_quotes, public.vendor_quote_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vendor_quotes, public.vendor_quote_items TO authenticated;

CREATE POLICY "vendor_quotes_member_read" ON public.vendor_quotes
  FOR SELECT TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER']));
CREATE POLICY "vendor_quotes_manager_insert" ON public.vendor_quotes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "vendor_quotes_manager_update" ON public.vendor_quotes
  FOR UPDATE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']))
  WITH CHECK (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));
CREATE POLICY "vendor_quotes_manager_delete" ON public.vendor_quotes
  FOR DELETE TO authenticated
  USING (public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER']));

CREATE POLICY "vendor_quote_items_member_read" ON public.vendor_quote_items
  FOR SELECT TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER', 'REVIEWER', 'COST_EDITOR', 'VIEWER'])
    AND EXISTS (
      SELECT 1
      FROM public.vendor_quotes AS quote
      WHERE quote.id = vendor_quote_id
    )
  );
CREATE POLICY "vendor_quote_items_manager_insert" ON public.vendor_quote_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1
      FROM public.vendor_quotes AS quote
      WHERE quote.id = vendor_quote_id
    )
  );
CREATE POLICY "vendor_quote_items_manager_update" ON public.vendor_quote_items
  FOR UPDATE TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1
      FROM public.vendor_quotes AS quote
      WHERE quote.id = vendor_quote_id
    )
  )
  WITH CHECK (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1
      FROM public.vendor_quotes AS quote
      WHERE quote.id = vendor_quote_id
    )
  );
CREATE POLICY "vendor_quote_items_manager_delete" ON public.vendor_quote_items
  FOR DELETE TO authenticated
  USING (
    public.has_any_app_role(ARRAY['ADMIN', 'RFQ_MANAGER'])
    AND EXISTS (
      SELECT 1
      FROM public.vendor_quotes AS quote
      WHERE quote.id = vendor_quote_id
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
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one quote line item is required';
  END IF;

  INSERT INTO public.vendor_quotes (
    project_id, supplier_id, quote_reference, quoted_date, notes, freight, tax, other_charges, created_by
  )
  VALUES (
    p_project_id, p_supplier_id, NULLIF(btrim(p_quote_reference), ''), p_quoted_date,
    NULLIF(btrim(p_notes), ''), COALESCE(p_freight, 0), COALESCE(p_tax, 0),
    COALESCE(p_other_charges, 0), (SELECT auth.uid())
  )
  RETURNING id INTO new_quote_id;

  INSERT INTO public.vendor_quote_items (
    vendor_quote_id, source_material_id, item_number, quantity, unit, description,
    manufacturer, model_number, sheet_reference, notes, quoted_unit_price
  )
  SELECT
    new_quote_id, item.source_material_id, item.item_number, item.quantity, item.unit, item.description,
    item.manufacturer, item.model_number, item.sheet_reference, item.notes, item.quoted_unit_price
  FROM jsonb_to_recordset(p_items) AS item(
    source_material_id uuid,
    item_number integer,
    quantity numeric,
    unit public.material_unit,
    description text,
    manufacturer varchar(255),
    model_number varchar(255),
    sheet_reference varchar(100),
    notes text,
    quoted_unit_price numeric
  );

  RETURN new_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_vendor_quote(uuid, uuid, text, date, text, numeric, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_vendor_quote(uuid, uuid, text, date, text, numeric, numeric, numeric, jsonb) TO authenticated;
