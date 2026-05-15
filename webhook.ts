/**
 * n8n Webhook Handler
 * Dengan retry logic dan error handling yang robust
 */

import { createLogger } from "./logger.js";
import { config } from "./config.js";

const logger = createLogger("Webhook");

interface WebhookPayload {
    remoteJid: string;
    pushName: string;
    content: string;
    timestamp: string;
    hasImage?: boolean;
    base64Image?: string;
    mimeType?: string;
}

/**
 * Send message ke n8n webhook dengan retry logic
 */
export async function sendToN8n(
    payload: WebhookPayload,
    retryCount = 0,
): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            config.n8n.timeout,
        );

        const response = await fetch(config.n8n.webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        logger.info(`✅ Pesan berhasil dikirim ke n8n`, {
            jid: payload.remoteJid,
            content: payload.content.substring(0, 50),
        });
        return true;
    } catch (error: any) {
        const isTimeout = error.name === "AbortError";
        const errorMsg = isTimeout
            ? "Timeout connecting to n8n"
            : error.message;

        logger.warn(
            `⚠️  Gagal kirim ke n8n (attempt ${retryCount + 1}/${config.n8n.retries})`,
            {
                error: errorMsg,
                jid: payload.remoteJid,
            },
        );

        // Retry logic
        if (retryCount < config.n8n.retries - 1) {
            const delayMs = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff
            logger.debug(`Retry dalam ${delayMs}ms...`);

            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return sendToN8n(payload, retryCount + 1);
        }

        // Kalau gagal total, log tapi jangan crash
        logger.error(
            `❌ Gagal kirim ke n8n setelah ${config.n8n.retries} attempt`,
            {
                jid: payload.remoteJid,
                errorMsg,
            },
        );
        return false;
    }
}

/**
 * Health check n8n webhook
 */
export async function checkN8nHealth(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(config.n8n.webhookUrl, {
            method: "OPTIONS",
            signal: controller.signal,
        }).catch(() => null);

        clearTimeout(timeoutId);

        if (response?.ok) {
            logger.info("✅ n8n webhook is healthy");
            return true;
        }

        logger.warn("⚠️  n8n webhook might be unavailable");
        return false;
    } catch (error) {
        logger.warn("⚠️  Cannot reach n8n webhook", {
            url: config.n8n.webhookUrl,
        });
        return false;
    }
}
