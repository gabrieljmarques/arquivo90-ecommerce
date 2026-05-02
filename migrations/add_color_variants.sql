-- Add color column to product_sizes (nullable, optional per product)
ALTER TABLE product_sizes ADD COLUMN IF NOT EXISTS color TEXT;

-- Add color column to order_items
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS color TEXT;

-- Unique constraint: (product_id, size, color) treating NULLs as equal (requires PG 15 - Supabase default)
ALTER TABLE product_sizes DROP CONSTRAINT IF EXISTS product_sizes_product_id_size_key;
ALTER TABLE product_sizes ADD CONSTRAINT product_sizes_product_id_size_color_key
  UNIQUE NULLS NOT DISTINCT (product_id, size, color);

-- Update reserve_stock RPC to accept optional color
CREATE OR REPLACE FUNCTION reserve_stock(
  p_product_id UUID,
  p_size TEXT,
  p_quantity INT,
  p_color TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE v_available INT;
BEGIN
  SELECT (stock - reserved) INTO v_available
  FROM product_sizes
  WHERE product_id = p_product_id AND size = p_size
    AND (color IS NOT DISTINCT FROM p_color)
  FOR UPDATE;
  IF v_available IS NULL OR v_available < p_quantity THEN RETURN FALSE; END IF;
  UPDATE product_sizes SET reserved = reserved + p_quantity
  WHERE product_id = p_product_id AND size = p_size AND (color IS NOT DISTINCT FROM p_color);
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update release_stock RPC
CREATE OR REPLACE FUNCTION release_stock(
  p_product_id UUID,
  p_size TEXT,
  p_quantity INT,
  p_color TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE product_sizes SET reserved = GREATEST(0, reserved - p_quantity)
  WHERE product_id = p_product_id AND size = p_size AND (color IS NOT DISTINCT FROM p_color);
END;
$$ LANGUAGE plpgsql;
