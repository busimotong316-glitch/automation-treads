import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
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
 * Initialize Database Connection dengan Connection Pooling
 */
let client: ReturnType<typeof postgres>;

export function initializeDatabase() {
    try {
        client = postgres(config.database.url, {
            max: config.database.maxConnections,
            idle_timeout: 30,
            connect_timeout: 30,
            // Force SSL untuk Supabase (wajib di production)
            ssl: config.database.url.includes("supabase.co") ? "require" : false,
            // Mencegah ENETUNREACH: fallback ke IPv4 eksplisit
            // Node.js kadang mencoba IPv6 dulu di container yang tidak support
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
