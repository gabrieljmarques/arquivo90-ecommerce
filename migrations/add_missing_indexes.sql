-- Missing indexes identified in checkup
-- Run once in Supabase SQL Editor

CREATE INDEX IF NOT EXISTS idx_cart_leads_email
  ON cart_leads(email);

CREATE INDEX IF NOT EXISTS idx_orders_customer_email
  ON orders(customer_email);

CREATE INDEX IF NOT EXISTS idx_stock_transactions_reason
  ON stock_transactions(reason);
