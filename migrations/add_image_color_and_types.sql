-- Add color column to product_images (links image to a specific color variant)
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;

-- Expand the type check constraint to include new image types
ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_type_check;

ALTER TABLE product_images
  ADD CONSTRAINT product_images_type_check
    CHECK (type IN ('front','back','detail','lifestyle','size_chart','gallery','preview_offwhite'));

-- Add site_settings table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
