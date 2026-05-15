-- Migration: fix stock RPCs
-- 1. reserve_stock / release_stock — add p_color param (color-variant support)
-- 2. refund_stock_for_order — new RPC for post-payment refunds
-- Run once in Supabase SQL Editor

-- ─────────────────────────────────────────────────
-- 1a. reserve_stock — now accepts optional p_color
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reserve_stock(
  p_product_id uuid,
  p_size       text,
  p_quantity   int,
  p_color      text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE product_sizes
  SET reserved = reserved + p_quantity
  WHERE product_id = p_product_id
    AND size        = p_size
    AND (
      (p_color IS NULL     AND color IS NULL) OR
      (p_color IS NOT NULL AND color = p_color)
    )
    AND (stock - reserved) >= p_quantity;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- ─────────────────────────────────────────────────
-- 1b. release_stock — now accepts optional p_color
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_stock(
  p_product_id uuid,
  p_size       text,
  p_quantity   int,
  p_color      text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_sizes
  SET reserved = GREATEST(0, reserved - p_quantity)
  WHERE product_id = p_product_id
    AND size        = p_size
    AND (
      (p_color IS NULL     AND color IS NULL) OR
      (p_color IS NOT NULL AND color = p_color)
    );
END;
$$;

-- ─────────────────────────────────────────────────
-- 2. refund_stock_for_order — restore stock after refund
--    Called only when an already-paid order is refunded.
--    confirm_stock_for_order decremented stock and zeroed reserved,
--    so this increments stock back without touching reserved.
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refund_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Restore physical stock for each order item
  UPDATE product_sizes ps
  SET stock = ps.stock + oi.quantity
  FROM order_items oi
  WHERE oi.order_id     = p_order_id
    AND ps.product_id   = oi.product_id
    AND ps.size         = oi.size
    AND (
      (oi.color IS NULL     AND ps.color IS NULL) OR
      (oi.color IS NOT NULL AND ps.color = oi.color)
    );

  -- Record stock transactions for auditability
  INSERT INTO stock_transactions (product_size_id, delta, reason, order_id, created_by)
  SELECT
    ps.id,
    oi.quantity,
    'refund',
    p_order_id,
    'system'
  FROM order_items oi
  JOIN product_sizes ps
    ON  ps.product_id = oi.product_id
    AND ps.size       = oi.size
    AND (
      (oi.color IS NULL     AND ps.color IS NULL) OR
      (oi.color IS NOT NULL AND ps.color = oi.color)
    )
  WHERE oi.order_id = p_order_id;
END;
$$;
