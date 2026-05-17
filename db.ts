import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Database");


/**
 * Define Messages Table
 */
export const messages = pgTable("messages", {
    id: serial("id").primaryKey(),
    remoteJid: text("remote_jid").notNull(),
    pushName: text("push_name"),
    content: text("content"),
    createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Define Users Table (Auth)
 */
export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    storeName: text("store_name"),
    createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Define Showcase Configs Table (per user)
 */
export const showcaseConfigs = pgTable("showcase_configs", {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id),
    showcaseUrl: text("showcase_url").notNull(),
    label: text("label"),
    isActive: boolean("is_active").default(true),
    lastScrapedAt: timestamp("last_scraped_at"),
    createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Define Products Table (Shopee Affiliate Showcase)
 */
export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    affiliateLink: text("affiliate_link").notNull().unique(),
    imageUrl: text("image_url"),
    price: text("price"),
    isPosted: boolean("is_posted").default(false),
    postedAt: timestamp("posted_at"),
    userId: integer("user_id").references(() => users.id),
    showcaseConfigId: integer("showcase_config_id").references(() => showcaseConfigs.id),
    createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Initialize Database Connection dengan Connection Pooling
 */
let client: ReturnType<typeof postgres>;

export function initializeDatabase() {
    try {
        client = postgres(config.database.url, {
            max: config.database.maxConnections,
            idle_timeout: 30,
            connect_timeout: 30,
            // SSL wajib untuk Supabase (direct maupun pooler)
            ssl: (
                config.database.url.includes("supabase.co") ||
                config.database.url.includes("pooler.supabase.com")
            ) ? "require" : false,
            // prepare: false diperlukan saat menggunakan connection pooler Supabase
            prepare: false,
            connection: {
                application_name: "iman-wa-bot",
            },
        });


        logger.info("✅ Database connection initialized");
        return client;
    } catch (error) {
        logger.error("❌ Failed to initialize database", error);
        throw error;
    }
}

export const db = {
    instance: () => {
        if (!client) {
            initializeDatabase();
        }
        return drizzle(client);
    },
};

/**
 * Graceful shutdown untuk database connection
 */
export async function closeDatabaseConnection() {
    try {
        if (client) {
            await client.end();
            logger.info("✅ Database connection closed");
        }
    } catch (error) {
        logger.error("❌ Error closing database connection", error);
    }
}

// Initialize on first import
initializeDatabase();
