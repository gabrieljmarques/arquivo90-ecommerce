-- ── Coupons table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('percentage','fixed')),
  value       integer     NOT NULL CHECK (value > 0),  -- centavos (fixed) or 1–100 (percentage)
  min_order   integer     NOT NULL DEFAULT 0,          -- minimum subtotal in centavos
  max_uses    integer,                                  -- NULL = unlimited
  uses_count  integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_unique UNIQUE (code),
  CONSTRAINT coupons_percentage_range CHECK (type <> 'percentage' OR (value >= 1 AND value <= 100))
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);

-- ── Orders: add coupon columns ────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_code     text,
  ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;

-- ── Atomic coupon claim (used in payment/create.js) ───────────────────────
-- Returns the coupon row if the claim succeeds, empty if not available.
CREATE OR REPLACE FUNCTION claim_coupon(p_code text, p_order_subtotal integer)
RETURNS TABLE(id uuid, code text, type text, value integer, min_order integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  UPDATE coupons
  SET    uses_count = uses_count + 1
  WHERE  coupons.code    = UPPER(TRIM(p_code))
    AND  coupons.active  = true
    AND  (coupons.expires_at IS NULL OR coupons.expires_at > now())
    AND  (coupons.max_uses  IS NULL OR coupons.uses_count < coupons.max_uses)
    AND  coupons.min_order <= p_order_subtotal
  RETURNING coupons.id, coupons.code, coupons.type, coupons.value, coupons.min_order;
END;
$$;

-- ── Release coupon (rollback if order fails after claim) ──────────────────
CREATE OR REPLACE FUNCTION release_coupon(p_code text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE coupons
  SET    uses_count = GREATEST(0, uses_count - 1)
  WHERE  code = UPPER(TRIM(p_code));
$$;
