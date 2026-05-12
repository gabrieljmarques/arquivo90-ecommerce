-- Add Melhor Envio shipping fields to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_service_id   integer,
  ADD COLUMN IF NOT EXISTS shipping_service_name text,
  ADD COLUMN IF NOT EXISTS shipping_deadline      integer,
  ADD COLUMN IF NOT EXISTS me_order_id           text;

-- Index for ME order lookups
CREATE INDEX IF NOT EXISTS idx_orders_me_order_id ON orders (me_order_id) WHERE me_order_id IS NOT NULL;
