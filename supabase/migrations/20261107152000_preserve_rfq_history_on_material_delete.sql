ALTER TABLE public.rfq_line_items
  ADD COLUMN snapshot_item_number integer,
  ADD COLUMN snapshot_quantity numeric,
  ADD COLUMN snapshot_unit public.material_unit,
  ADD COLUMN snapshot_description text,
  ADD COLUMN snapshot_manufacturer varchar(255),
  ADD COLUMN snapshot_model_number varchar(255),
  ADD COLUMN snapshot_sheet_reference varchar(100),
  ADD COLUMN snapshot_notes text;

UPDATE public.rfq_line_items AS line_item
SET
  snapshot_item_number = material.item_number,
  snapshot_quantity = material.quantity,
  snapshot_unit = material.unit,
  snapshot_description = material.description,
  snapshot_manufacturer = material.manufacturer,
  snapshot_model_number = material.model_number,
  snapshot_sheet_reference = material.sheet_reference,
  snapshot_notes = material.notes
FROM public.materials AS material
WHERE material.id = line_item.material_id;

ALTER TABLE public.rfq_line_items
  ALTER COLUMN material_id DROP NOT NULL;

DO $$
DECLARE
  material_fk_name text;
BEGIN
  SELECT constraint_row.conname
  INTO material_fk_name
  FROM pg_constraint AS constraint_row
  JOIN pg_attribute AS column_row
    ON column_row.attrelid = constraint_row.conrelid
    AND column_row.attnum = constraint_row.conkey[1]
  WHERE constraint_row.conrelid = 'public.rfq_line_items'::regclass
    AND constraint_row.confrelid = 'public.materials'::regclass
    AND constraint_row.contype = 'f'
    AND column_row.attname = 'material_id'
  LIMIT 1;

  IF material_fk_name IS NULL THEN
    RAISE EXCEPTION 'Could not find rfq_line_items.material_id foreign key';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.rfq_line_items DROP CONSTRAINT %I',
    material_fk_name
  );
END;
$$;

ALTER TABLE public.rfq_line_items
  ADD CONSTRAINT rfq_line_items_material_id_fkey
  FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.snapshot_rfq_line_items_before_material_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.rfq_line_items AS line_item
  SET
    snapshot_item_number = COALESCE(line_item.snapshot_item_number, OLD.item_number),
    snapshot_quantity = COALESCE(line_item.snapshot_quantity, OLD.quantity),
    snapshot_unit = COALESCE(line_item.snapshot_unit, OLD.unit),
    snapshot_description = COALESCE(line_item.snapshot_description, OLD.description),
    snapshot_manufacturer = COALESCE(line_item.snapshot_manufacturer, OLD.manufacturer),
    snapshot_model_number = COALESCE(line_item.snapshot_model_number, OLD.model_number),
    snapshot_sheet_reference = COALESCE(line_item.snapshot_sheet_reference, OLD.sheet_reference),
    snapshot_notes = COALESCE(line_item.snapshot_notes, OLD.notes)
  WHERE line_item.material_id = OLD.id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_rfq_line_items_before_material_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER snapshot_rfq_line_items_before_material_delete
  BEFORE DELETE ON public.materials
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_rfq_line_items_before_material_delete();
