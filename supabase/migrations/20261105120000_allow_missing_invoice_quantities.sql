ALTER TABLE public.material_invoice_items
  ALTER COLUMN quantity DROP NOT NULL,
  DROP CONSTRAINT material_invoice_items_quantity_nonnegative_check,
  ADD CONSTRAINT material_invoice_items_quantity_nonnegative_check
    CHECK (quantity IS NULL OR quantity >= 0);
