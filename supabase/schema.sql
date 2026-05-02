-- Arquivo 90 — Schema completo
-- Executar no Supabase SQL Editor

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────
-- TABELAS
-- ─────────────────────────────────────────────────

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  subtitle      text,
  description   text,
  price         numeric(10,2) NOT NULL CHECK (price > 0),
  display_order int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  featured      boolean NOT NULL DEFAULT false,
  deleted_at    timestamp with time zone,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE product_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url           text NOT NULL,
  type          text NOT NULL CHECK (type IN ('front','back','detail','preview_offwhite')),
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE product_sizes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size          text NOT NULL CHECK (size IN ('P','M','G','GG')),
  stock         int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  UNIQUE(product_id, size)
);

CREATE TABLE stock_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES products(id),
  size        text NOT NULL,
  quantity    int NOT NULL CHECK (quantity > 0),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','confirmed','expired','released')),
  expires_at  timestamp with time zone NOT NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE stock_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_size_id  uuid NOT NULL REFERENCES product_sizes(id),
  delta            int NOT NULL,
  reason           text NOT NULL CHECK (reason IN ('sale','restock','adjustment','expired_reservation','refund')),
  order_id         uuid,
  created_by       text NOT NULL DEFAULT 'system',
  created_at       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   text UNIQUE NOT NULL,
  mp_preference_id  text,
  mp_payment_id     text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','preparing','shipped','delivered','cancelled','refunded')),
  customer_name     text NOT NULL,
  customer_email    text NOT NULL,
  customer_phone    text,
  shipping_address  jsonb NOT NULL,
  total             numeric(10,2) NOT NULL CHECK (total > 0),
  shipping_cost     numeric(10,2) NOT NULL DEFAULT 0,
  tracking_code     text,
  carrier           text,
  notes             text,
  paid_at           timestamp with time zone,
  shipped_at        timestamp with time zone,
  created_at        timestamp with time zone NOT NULL DEFAULT now(),
  updated_at        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id),
  product_name  text NOT NULL,
  size          text NOT NULL,
  quantity      int NOT NULL CHECK (quantity > 0),
  unit_price    numeric(10,2) NOT NULL CHECK (unit_price > 0),
  created_at    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mp_notification_id   text UNIQUE NOT NULL,
  payload              jsonb NOT NULL,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
  attempts             int NOT NULL DEFAULT 0,
  last_attempt_at      timestamp with time zone,
  error_message        text,
  created_at           timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamp with time zone NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────────

CREATE INDEX idx_products_active_order    ON products(active, display_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_slug            ON products(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_product_images_product   ON product_images(product_id, display_order);
CREATE INDEX idx_product_sizes_product    ON product_sizes(product_id);
CREATE INDEX idx_stock_reservations_order ON stock_reservations(order_id);
CREATE INDEX idx_stock_reservations_expiry ON stock_reservations(expires_at) WHERE status = 'active';
CREATE INDEX idx_orders_status_created    ON orders(status, created_at DESC);
CREATE INDEX idx_orders_email             ON orders(customer_email);
CREATE INDEX idx_orders_mp_payment        ON orders(mp_payment_id);
CREATE INDEX idx_order_items_order        ON order_items(order_id);
CREATE INDEX idx_webhook_events_pending   ON webhook_events(status, attempts, created_at) WHERE status = 'pending';
CREATE INDEX idx_audit_log_entity         ON audit_log(entity, entity_id, created_at DESC);

-- ─────────────────────────────────────────────────
-- TRIGGER: updated_at automático
-- ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────
-- FUNÇÕES DE ESTOQUE (operações atômicas)
-- ─────────────────────────────────────────────────

-- Reservar estoque: retorna true se sucesso, false se sem estoque
CREATE OR REPLACE FUNCTION reserve_stock(
  p_product_id uuid,
  p_size       text,
  p_quantity   int
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE product_sizes
  SET reserved = reserved + p_quantity
  WHERE product_id = p_product_id
    AND size = p_size
    AND (stock - reserved) >= p_quantity;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

-- Liberar reserva (cancelamento / expiração)
CREATE OR REPLACE FUNCTION release_stock(
  p_product_id uuid,
  p_size       text,
  p_quantity   int
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE product_sizes
  SET reserved = GREATEST(0, reserved - p_quantity)
  WHERE product_id = p_product_id AND size = p_size;
END;
$$;

-- Liberar todas as reservas de um pedido
CREATE OR REPLACE FUNCTION release_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Só processa se ainda há reservas ativas (idempotente)
  IF NOT EXISTS (
    SELECT 1 FROM stock_reservations
    WHERE order_id = p_order_id AND status = 'active'
  ) THEN RETURN; END IF;

  UPDATE product_sizes ps
  SET reserved = GREATEST(0, ps.reserved - sr.quantity)
  FROM stock_reservations sr
  WHERE sr.order_id  = p_order_id
    AND sr.status    = 'active'
    AND ps.product_id = sr.product_id
    AND ps.size       = sr.size;

  UPDATE stock_reservations
  SET status = 'released'
  WHERE order_id = p_order_id AND status = 'active';
END;
$$;

-- Confirmar venda após pagamento aprovado
CREATE OR REPLACE FUNCTION confirm_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Idempotente: não processa duas vezes
  IF NOT EXISTS (
    SELECT 1 FROM stock_reservations
    WHERE order_id = p_order_id AND status = 'active'
  ) THEN RETURN; END IF;

  UPDATE product_sizes ps
  SET
    stock    = ps.stock    - sr.quantity,
    reserved = GREATEST(0, ps.reserved - sr.quantity)
  FROM stock_reservations sr
  WHERE sr.order_id  = p_order_id
    AND sr.status    = 'active'
    AND ps.product_id = sr.product_id
    AND ps.size       = sr.size;

  UPDATE stock_reservations
  SET status = 'confirmed'
  WHERE order_id = p_order_id AND status = 'active';
END;
$$;

-- ─────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────

ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images    ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sizes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;

-- Anon: só lê produtos ativos
CREATE POLICY "anon_read_products" ON products
  FOR SELECT TO anon
  USING (active = true AND deleted_at IS NULL);

CREATE POLICY "anon_read_product_images" ON product_images
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_product_sizes" ON product_sizes
  FOR SELECT TO anon USING (true);

-- Service role (backend): acesso total via service key
-- (service key bypassa RLS por padrão no Supabase)

-- ─────────────────────────────────────────────────
-- DADOS INICIAIS
-- ─────────────────────────────────────────────────

-- Produto exemplo: La Cavadinha
INSERT INTO products (slug, name, subtitle, description, price, display_order, active, featured)
VALUES (
  'la-cavadinha',
  'La Cavadinha',
  'Alguns momentos ficam para sempre',
  'Corinthians 2-0 Chelsea • Mundial de Clubes FIFA 2012 • Yokohama, Japão • 69''',
  109.99,
  1,
  false,  -- desativar até ter imagens reais
  true
);

-- Tamanhos iniciais (ajustar estoque depois)
INSERT INTO product_sizes (product_id, size, stock)
SELECT id, size, 0
FROM products CROSS JOIN (VALUES ('P'),('M'),('G'),('GG')) AS s(size)
WHERE slug = 'la-cavadinha';
