/**
 * Configuration Management
 * Load dan validate environment variables
 */

interface Config {
    database: {
        url: string;
        maxConnections: number;
    };
    n8n: {
        webhookUrl: string;
        timeout: number;
        retries: number;
    };
    bot: {
        name: string;
        reconnectDelay: number;
        ownerNumber: string;
        botPhoneNumber: string;
    };
    log: {
        level: "info" | "debug" | "error" | "warn";
    };
}

function validateEnv(key: string, defaultValue?: string): string {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`❌ Environment variable ${key} is required!`);
    }
    return value;
}

export const config: Config = {
    database: {
        url: validateEnv("DATABASE_URL"),
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || "10"),
    },
    n8n: {
        webhookUrl: validateEnv(
            "N8N_WEBHOOK_URL",
            "http://localhost:5678/webhook/messages",
        ),
        timeout: parseInt(process.env.N8N_WEBHOOK_TIMEOUT || "10000"),
        retries: parseInt(process.env.N8N_WEBHOOK_RETRIES || "3"),
    },
    bot: {
        name: process.env.BOT_NAME || "Iman Bot",
        reconnectDelay: parseInt(process.env.BOT_RECONNECT_DELAY || "5000"),
        ownerNumber: validateEnv("OWNER_NUMBER", "628000000000@s.whatsapp.net"), // Pastikan di .env diset (tanpa @s.whatsapp.net, atau sekalian tambah @s.whatsapp.net di validasi)
        botPhoneNumber: process.env.BOT_PHONE_NUMBER || "",
    },
    log: {
        level: (process.env.LOG_LEVEL || "info") as
            | "info"
            | "debug"
            | "error"
            | "warn",
    },
};

console.log("✅ Configuration loaded successfully");
