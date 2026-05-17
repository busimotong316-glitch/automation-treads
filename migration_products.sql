-- ============================================
-- SQL Migration: Buat tabel products di Supabase
-- Jalankan ini di Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    affiliate_link TEXT NOT NULL UNIQUE,
    image_url TEXT,
    price TEXT,
    is_posted BOOLEAN DEFAULT false,
    posted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_products_is_posted ON products(is_posted);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);

-- Verifikasi tabel berhasil dibuat
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'products'
ORDER BY ordinal_position;
