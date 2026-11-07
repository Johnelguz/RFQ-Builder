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
    snapshot_notes = COALESCE(line_item.snapshot_notes, OLD.notes),
    material_id = NULL
  WHERE line_item.material_id = OLD.id;

  RETURN OLD;
END;
$$;
