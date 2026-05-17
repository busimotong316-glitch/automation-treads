-- ============================================
-- Migration V2: Traffic Harvester Auth System
-- Jalankan di Supabase SQL Editor
-- ============================================

-- Tabel users untuk auth
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    store_name TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Tabel konfigurasi showcase per user
CREATE TABLE IF NOT EXISTS showcase_configs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    showcase_url TEXT NOT NULL,
    label TEXT,
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, showcase_url)
);

-- Update tabel products: tambah relasi ke user dan showcase
ALTER TABLE products 
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS showcase_config_id INTEGER REFERENCES showcase_configs(id);

-- Index untuk performa query
CREATE INDEX IF NOT EXISTS idx_showcase_configs_user_id ON showcase_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Verifikasi
SELECT 'users' as table_name, COUNT(*) as rows FROM users
UNION ALL
SELECT 'showcase_configs', COUNT(*) FROM showcase_configs
UNION ALL
SELECT 'products', COUNT(*) FROM products;
