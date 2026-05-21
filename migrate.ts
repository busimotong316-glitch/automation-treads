/**
 * Database Migration Runner
 * Jalankan: npm run migrate
 *
 * Pakai Supabase Transaction Pooler agar bisa diakses dari lokal
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import postgres from "postgres";
import { createLogger } from "./logger.js";

const logger = createLogger("Migrator");

// Pakai pooler URL dari .env
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is required! Set it in .env file.");
  process.exit(1);
}

async function runMigration() {
  logger.info("🎬 Starting database migration...");
  logger.info(`📡 Connecting to database...`);

  const sql = postgres(DATABASE_URL!, {
    ssl: "require",
    prepare: false,
    connect_timeout: 30,
  });

  try {
    // Test koneksi
    const testResult = await sql`SELECT NOW() as current_time`;
    logger.info(`✅ Connected! Server time: ${testResult[0]?.current_time}`);

    // ─── Migration 1: products table ───
    logger.info("📦 [1/2] Creating products table...");

    await sql`CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            affiliate_link TEXT NOT NULL UNIQUE,
            image_url TEXT,
            price TEXT,
            is_posted BOOLEAN DEFAULT false,
            posted_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_products_is_posted ON products(is_posted)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at)`;
    logger.info("✅ products table ready!");

    // ─── Migration 2: users table ───
    logger.info("👤 [2/2] Creating auth tables...");

    await sql`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            store_name TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )`;
    logger.info("  ✅ users table ready!");

    await sql`CREATE TABLE IF NOT EXISTS showcase_configs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            showcase_url TEXT NOT NULL,
            label TEXT,
            is_active BOOLEAN DEFAULT true,
            last_scraped_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, showcase_url)
        )`;
    logger.info("  ✅ showcase_configs table ready!");

    // Tambah kolom baru di products (jika belum ada)
    try {
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`;
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS showcase_config_id INTEGER REFERENCES showcase_configs(id)`;
      logger.info("  ✅ products columns updated!");
    } catch (e: any) {
      logger.warn("  ⚠️ Columns mungkin sudah ada: " + e.message);
    }

    // Index tambahan
    await sql`CREATE INDEX IF NOT EXISTS idx_showcase_configs_user_id ON showcase_configs(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;

    // ─── Verifikasi ───
    logger.info("📊 Verifying tables...");
    const tables = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('products', 'users', 'showcase_configs')
            ORDER BY table_name
        `;
    for (const t of tables) {
      logger.info(`  ✅ Table found: ${t.table_name}`);
    }

    logger.info("🎉 All migrations completed successfully!");
  } catch (error: any) {
    logger.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    await sql.end();
    process.exit(0);
  }
}

runMigration();
