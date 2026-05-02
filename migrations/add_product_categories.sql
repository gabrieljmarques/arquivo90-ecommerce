-- Migration: add all product fields
-- Run in Supabase SQL Editor

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tipo            TEXT,
  ADD COLUMN IF NOT EXISTS modelagem       TEXT,
  ADD COLUMN IF NOT EXISTS esporte         TEXT,
  ADD COLUMN IF NOT EXISTS subcategoria    TEXT,
  ADD COLUMN IF NOT EXISTS cor             TEXT,
  ADD COLUMN IF NOT EXISTS genero          TEXT,
  ADD COLUMN IF NOT EXISTS sku             TEXT,
  ADD COLUMN IF NOT EXISTS peso_g          INTEGER,
  ADD COLUMN IF NOT EXISTS time_ref        TEXT,
  ADD COLUMN IF NOT EXISTS ano_ref         INTEGER,
  ADD COLUMN IF NOT EXISTS tags            TEXT[],
  ADD COLUMN IF NOT EXISTS meta_title      TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT;
