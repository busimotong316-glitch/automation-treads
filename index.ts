// ⚠️ MUST BE FIRST LINE — Force IPv4 DNS resolution before any network import
// Prevents ENETUNREACH when Railway container does not support IPv6
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    delay,
    Browsers,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { db, messages, products, closeDatabaseConnection } from "./db.js";
import { createLogger } from "./logger.js";
import { config } from "./config.js";
import { sendToN8n, checkN8nHealth } from "./webhook.js";
import { scrapeShowcase } from "./scraper.js";
import { register, login, requireAuth, getMe, upsertShowcase, deleteShowcase } from "./auth.js";
import type { AuthRequest } from "./auth.js";
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const logger = createLogger("Bot");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Auth Routes ──────────────────────────────────
app.post("/auth/register", register);
app.post("/auth/login", login);
app.get("/api/me", requireAuth as express.RequestHandler, (req, res) => getMe(req as AuthRequest, res));
app.post("/api/showcase", requireAuth as express.RequestHandler, (req, res) => upsertShowcase(req as AuthRequest, res));
app.delete("/api/showcase/:id", requireAuth as express.RequestHandler, (req, res) => deleteShowcase(req as AuthRequest, res));

// ── Bot Status Endpoint ───────────────────────────
app.get("/api/status", (_req, res) => {
    res.json({
        connected: botState.isRunning && !!botState.sock,
        bot_number: config.bot.ownerNumber || null,
    });
});

// ── QR Code Endpoint (SSE) ────────────────────────
let latestQR: string | null = null;

app.get("/api/qr", (_req, res) => {
    res.json({ qr: latestQR, connected: botState.isRunning && !!botState.sock });
});

/**
 * Type definitions
 */
interface MessageEvent {
    remoteJid: string;
    pushName?: string;
    content: string;
    hasImage?: boolean;
    base64Image?: string;
    mimeType?: string;
}

/**
 * Global state untuk prevent memory leak dan race conditions
 */
const botState = {
    isConnecting: false,
    isRunning: false,
    sock: null as any,
    reconnectTimeout: null as NodeJS.Timeout | null,
};

/**
 * Hapus semua file session WA biar bisa login fresh
 * Hapus file satu-satu (bukan rmdir) biar nggak EBUSY
 */
function clearAuthFolder(): void {
    const authDir = "auth_info_baileys";
    try {
        if (!fs.existsSync(authDir)) return;
        // Hapus isi folder file per file, skip kalau locked
        const files = fs.readdirSync(authDir);
        let cleared = 0;
        for (const file of files) {
            try {
                fs.unlinkSync(`${authDir}/${file}`);
                cleared++;
            } catch (_) {
                // skip file yang masih locked
            }
        }
        logger.info(`🗑️ Cleared ${cleared}/${files.length} auth files. Bot akan restart...`);
    } catch (err) {
        logger.error("❌ Failed to clear auth folder", err);
    }
}

/**
 * Send message to database dan n8n webhook
 */
async function processMessage(msg: MessageEvent): Promise<void> {
    try {
        const timestamp = new Date().toISOString();

        // Parallel processing: DB insert + Webhook send
        // Gunakan Promise.allSettled agar kalau salah satu gagal, tetap lanjut
        const [dbResult, webhookResult] = await Promise.allSettled([
            // Insert ke database
            (async () => {
                const result = await db
                    .instance()
                    .insert(messages)
                    .values({
                        remoteJid: msg.remoteJid,
                        pushName: msg.pushName || "Anonim",
                        content: msg.content,
                    });
                logger.info("✅ Message saved to database", {
                    jid: msg.remoteJid,
                });
                return result;
            })(),

            // Send ke n8n webhook
            (async () => {
                const webhookPayload = {
                    remoteJid: msg.remoteJid,
                    pushName: msg.pushName || "Anonim",
                    content: msg.content,
                    timestamp,
                    hasImage: msg.hasImage,
                    base64Image: msg.base64Image,
                    mimeType: msg.mimeType,
                };
                const success = await sendToN8n(webhookPayload);
                return success;
            })(),
        ]);

        // Log results
        if (dbResult.status === "rejected") {
            logger.error(
                "❌ Failed to save message to database",
                dbResult.reason,
            );
        }

        if (webhookResult.status === "rejected") {
            logger.error("❌ Failed to send webhook", webhookResult.reason);
        }
    } catch (error) {
        logger.error("❌ Unexpected error in processMessage", error);
    }
}

/**
 * Cleanup event listeners untuk prevent memory leak
 */
function removeAllListeners(sock: any): void {
    try {
        sock.ev.removeAllListeners("creds.update");
        sock.ev.removeAllListeners("connection.update");
        sock.ev.removeAllListeners("messages.upsert");
        logger.debug("Event listeners removed");
    } catch (error) {
        logger.warn("Error removing listeners", error);
    }
}

/**
 * Main bot function dengan proper lifecycle management
 */
async function startBot(): Promise<void> {
    // Prevent multiple simultaneous connection attempts
    if (botState.isConnecting) {
        logger.warn("⚠️  Bot already connecting, skipping...");
        return;
    }

    botState.isConnecting = true;

    try {
        const { state, saveCreds } =
            await useMultiFileAuthState("auth_info_baileys");

        // HACK: Force registered to true if we have a session identity
        // Ini buat nembus masalah 'registered: false' pas pindahan ke Railway
        if (state.creds && (state.creds as any).me?.id && !state.creds.registered) {
            logger.info("🛠️  Session found but unregistered. Forcing 'registered' to true...");
            state.creds.registered = true;
            // Save immediately so it sticks
            await saveCreds();
        }

        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: !config.bot.botPhoneNumber,
            browser: Browsers.ubuntu("Chrome"),
        });

        botState.sock = sock;

        /**
         * Handle credentials update
         */
        sock.ev.on("creds.update", saveCreds);

        let pairingCodeRequested = false;
        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && !pairingCodeRequested) {
                // Simpan QR terbaru untuk dashboard API
                latestQR = qr;

                // Skip pairing request if we already have a valid auth folder and session is registered
                if (fs.existsSync('auth_info_baileys') && state.creds && state.creds.registered) {
                    logger.debug('Auth folder exists with registered session; skipping pairing code request.');
                } else if (config.bot.botPhoneNumber) {
                    pairingCodeRequested = true;
                    // Jika ada nomor bot, kita request Pairing Code (bukan QR)
                    logger.info('🔐 REQUESTING PAIRING CODE...');
                    setTimeout(async () => {
                        try {
                            const code = await sock.requestPairingCode(config.bot.botPhoneNumber);
                            logger.info('======================================================');
                            logger.info(`🔑 KODE PAIRING WA : ${code}`);
                            logger.info('Langkah-langkah:');
                            logger.info('1. Buka WA di HP yang mau dijadiin bot.');
                            logger.info('2. Pilih Perangkat Tertaut > Tautkan Perangkat.');
                            logger.info("3. Pilih 'Tautkan dengan Nomor Telepon Saja' (di bawah).");
                            logger.info('4. Masukkan kode 8 digit di atas.');
                            logger.info('======================================================');
                        } catch (err) {
                            logger.error('❌ Gagal request pairing code', err);
                            pairingCodeRequested = false;
                        }
                    }, 5000);
                } else {
                    // Jika nggak ada nomor, baru nampilin QR
                    logger.info('🔐 SCAN QR BELOW / SCAN QR DI BAWAH');
                    qrcode.generate(qr, { small: true });
                }
            }

            // Reset QR saat sudah connected
            if (connection === "open") {
                latestQR = null;
            }

            if (connection === "close") {
                const errorCode = (lastDisconnect?.error as Boom)?.output
                    ?.statusCode;
                logger.error(`Connection closed. Error code: ${errorCode}`);

                // Handle specific error codes
                if (errorCode === 440) {
                    logger.error(
                        "❌ ERROR 440: Session already logged in elsewhere!",
                    );
                    logger.info(
                        "Clearing 'auth_info_baileys' folder and restarting...",
                    );
                    clearAuthFolder();
                    process.exit(1);
                }

                if (errorCode === 401) {
                    logger.error("❌ ERROR 401: Session invalid/removed.");
                    logger.info("Clearing auth_info_baileys and restarting...");
                    clearAuthFolder();
                    process.exit(1);
                }

                const shouldReconnect =
                    errorCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    logger.info(
                        `🔄 Reconnecting dalam ${config.bot.reconnectDelay}ms...`,
                    );

                    // Clear previous timeout
                    if (botState.reconnectTimeout) {
                        clearTimeout(botState.reconnectTimeout);
                    }

                    botState.isConnecting = false;
                    botState.reconnectTimeout = setTimeout(() => {
                        startBot().catch((error) =>
                            logger.error("Reconnect failed", error),
                        );
                    }, config.bot.reconnectDelay);
                } else {
                    logger.warn(
                        "🚪 Bot logged out. Please run again to scan QR.",
                    );
                    botState.isConnecting = false;
                }
            } else if (connection === "open") {
                botState.isRunning = true;
                botState.isConnecting = false;
                logger.info("✅ WhatsApp bot successfully connected!");
                checkN8nHealth().catch(() =>
                    logger.warn("Could not verify n8n health"),
                );
            } else if (connection === "connecting") {
                logger.debug("[...] Connecting to WhatsApp...");
            }
        });

        /**
         * Handle incoming messages
         * Optimized dengan proper type checking dan error handling
         */
        const processedMessages = new Set<string>();

        sock.ev.on("messages.upsert", async (m: any) => {
            try {
                // Validate message structure
                if (!m?.messages || !Array.isArray(m.messages)) {
                    logger.debug("Invalid message structure");
                    return;
                }

                const msg = m.messages[0];

                // Check message validity
                if (!msg || msg.key?.fromMe || m.type !== "notify") {
                    return; // Skip own messages dan non-notify events
                }

                // Cegah pesan diproses berkali-kali (Duplicate Filter)
                const msgId = msg.key?.id;
                if (msgId) {
                    if (processedMessages.has(msgId)) return; // Skip kalau udah pernah diproses
                    processedMessages.add(msgId);
                    
                    // Jaga biar memori nggak penuh (maksimal simpan 1000 ID pesan terakhir)
                    if (processedMessages.size > 1000) {
                        const firstItem = processedMessages.values().next().value;
                        if (firstItem) processedMessages.delete(firstItem);
                    }
                }

                // Whitelist check
                const senderJid = msg.key?.remoteJid || "";
                const senderJidAlt = msg.key?.remoteJidAlt || "";
                const ownerJid = config.bot.ownerNumber.includes("@s.whatsapp.net") 
                    ? config.bot.ownerNumber 
                    : `${config.bot.ownerNumber}@s.whatsapp.net`;
                
                if (senderJid !== ownerJid && senderJidAlt !== ownerJid) {
                    logger.warn(`⚠️ Ignored message from non-owner: ${senderJid} (Alt: ${senderJidAlt})`);
                    return;
                }

                // Gunakan JID asli (bukan LID) untuk reply
                const targetJid = senderJidAlt || senderJid;

                // Extract message content
                const content =
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption ||
                    "";

                // Image handling
                let hasImage = false;
                let base64Image = undefined;
                let mimeType = undefined;

                if (msg.message?.imageMessage) {
                    hasImage = true;
                    mimeType = msg.message.imageMessage.mimetype;
                    logger.info("🖼️ Downloading image from message...");
                    try {
                        const buffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            { 
                                logger: logger as any,
                                reuploadRequest: sock.updateMediaMessage 
                            }
                        ) as Buffer;
                        base64Image = buffer.toString('base64');
                        logger.info("✅ Image downloaded and encoded");
                    } catch (err) {
                        logger.error("❌ Failed to download image", err);
                    }
                }

                // Skip empty messages unless there's an image
                if (!content && !hasImage) {
                    return;
                }

                logger.info(
                    `📨 Message received: "${content.substring(0, 50)}..."`,
                );

                // Humanize: Send Typing presence
                await sock.sendPresenceUpdate('composing', targetJid);
                await delay(1500); // Wait 1.5 seconds to look natural
                await sock.sendPresenceUpdate('paused', targetJid);

                // Process message asynchronously tanpa blocking
                await processMessage({
                    remoteJid: targetJid,
                    pushName: msg.pushName,
                    content: content,
                    hasImage,
                    base64Image,
                    mimeType
                });

                // Send confirmation reply
                const replyText = hasImage 
                    ? "✅ Siap bro, gambar dan konten lagi diproses ke n8n!" 
                    : "✅ Siap bro, pesan lagi diproses ke n8n!";
                await sock.sendMessage(targetJid, { text: replyText }, { quoted: msg });

            } catch (error) {
                logger.error("Error processing message", error);
            }
        });

    } catch (error) {
        logger.error("❌ Failed to start bot", error);
        botState.isConnecting = false;
        throw error;
    }
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
    logger.info(`\n📛 Shutdown signal received: ${signal}`);

    // Clear any pending reconnect
    if (botState.reconnectTimeout) {
        clearTimeout(botState.reconnectTimeout);
    }

    // Cleanup socket
    if (botState.sock) {
        try {
            removeAllListeners(botState.sock);
            await botState.sock.end();
            logger.info("✅ Socket closed");
        } catch (error) {
            logger.warn("Error closing socket", error);
        }
    }

    // Close database connection
    await closeDatabaseConnection();

    botState.isRunning = false;
    logger.info("✅ Shutdown complete");
    process.exit(0);
}

/**
 * n8n Report Endpoint
 * Digunakan n8n untuk lapor balik (callback) dengan built-in reconnect queue
 */
app.post("/report", async (req, res) => {
    try {
        const { jid, remoteJid, message } = req.body;
        const targetJid = jid || remoteJid;
        
        if (!targetJid || !message) {
            return res.status(400).json({ error: "Missing jid or message" });
        }

        // Jeda waktu maksimal untuk menunggu koneksi siap (15 detik)
        let attempts = 0;
        while (!botState.isRunning || !botState.sock) {
            if (attempts >= 15) {
                logger.error("❌ Cannot send report: Bot connection is offline");
                return res.status(503).json({ error: "WhatsApp bot is currently offline. Please wait for reconnection." });
            }
            logger.warn(`⏳ WhatsApp bot connection is not ready. Waiting to send report... (Attempt ${attempts + 1}/15)`);
            await delay(1000);
            attempts++;
        }

        logger.info(`📨 Sending report from n8n to ${targetJid}: ${message}`);
        await botState.sock.sendMessage(targetJid, { text: message });
        
        return res.json({ success: true });
    } catch (error: any) {
        logger.error("Error sending n8n report", error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/products — Daftar semua produk (untuk dashboard)
 */
app.get("/api/products", async (_req, res) => {
    try {
        const result = await db.instance().execute(
            // @ts-ignore
            `SELECT * FROM products ORDER BY created_at DESC LIMIT 200`
        );
        return res.json({ success: true, products: result });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /scrape
 * Trigger scraping Shopee showcase dan upsert ke database
 * Dipanggil oleh n8n Cron Workflow 1 (tiap jam 2 pagi)
 */
app.post("/scrape", async (req, res) => {
    const { showcase_url } = req.body || {};
    logger.info(`🔍 Scrape request received. URL: ${showcase_url || 'default'}`);
    try {
        const scrapedProducts = await scrapeShowcase(showcase_url || undefined);
        
        let inserted = 0;

        for (const product of scrapedProducts) {
            try {
                await db.instance()
                    .insert(products)
                    .values({
                        title: product.title,
                        affiliateLink: product.affiliateLink,
                        imageUrl: product.imageUrl || null,
                        price: product.price || null,
                        isPosted: false,
                    })
                    .onConflictDoUpdate({
                        target: products.affiliateLink,
                        set: {
                            title: product.title,
                            imageUrl: product.imageUrl || null,
                            price: product.price || null,
                        },
                    });
                inserted++;
            } catch (err) {
                logger.warn(`⚠️ Failed to upsert product: ${product.title}`, err);
            }
        }

        logger.info(`✅ Scrape complete: ${inserted} products upserted`);
        return res.json({
            success: true,
            total_scraped: scrapedProducts.length,
            total_upserted: inserted,
        });
    } catch (error: any) {
        logger.error("❌ Scrape endpoint error", error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /products/next
 * Ambil 1 produk yang belum diposting (RANDOM) untuk Workflow 2 Engine Posting
 */
app.get("/products/next", async (_req, res) => {
    try {
        // Raw query: ambil 1 produk random yang belum diposting
        const rawResult = await db.instance().execute(
            // @ts-ignore
            `SELECT * FROM products WHERE is_posted = false ORDER BY RANDOM() LIMIT 1`
        );

        const product = (rawResult as any[])[0] || null;

        if (!product) {
            return res.json({ success: true, product: null, message: "No unposted products found" });
        }

        logger.info(`📦 Next product for posting: ${product.title}`);
        return res.json({ success: true, product });
    } catch (error: any) {
        logger.error("❌ Failed to get next product", error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /products/:id/mark-posted
 * Update status is_posted = true setelah berhasil posting ke Threads
 */
app.post("/products/:id/mark-posted", async (req, res) => {
    const { id } = req.params;
    try {
        await db.instance().execute(
            // @ts-ignore
            `UPDATE products SET is_posted = true, posted_at = NOW() WHERE id = ${parseInt(id)}`
        );
        logger.info(`✅ Product #${id} marked as posted`);
        return res.json({ success: true, id });
    } catch (error: any) {
        logger.error(`❌ Failed to mark product #${id} as posted`, error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /products/:id/update-image
 * Update image_url produk setelah gambar di-upload ke Google Drive
 * Dipanggil oleh n8n setelah node "Make File Public"
 */
app.post("/products/:id/update-image", async (req, res) => {
    const { id } = req.params;
    const { image_url } = req.body;
    if (!image_url) {
        return res.status(400).json({ error: "image_url is required" });
    }
    try {
        await db.instance().execute(
            // @ts-ignore
            `UPDATE products SET image_url = '${image_url.replace(/'/g, "''")}' WHERE id = ${parseInt(id)}`
        );
        logger.info(`🖼️ Product #${id} image updated to GDrive link`);
        return res.json({ success: true, id, image_url });
    } catch (error: any) {
        logger.error(`❌ Failed to update product #${id} image`, error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /products/stats
 * Statistik produk untuk monitoring
 */
app.get("/products/stats", async (_req, res) => {
    try {
        const stats = await db.instance().execute(
            // @ts-ignore
            `SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_posted = false) as unposted,
                COUNT(*) FILTER (WHERE is_posted = true) as posted
            FROM products`
        );
        return res.json({ success: true, stats: (stats as any[])[0] });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});


async function main(): Promise<void> {
    try {
        logger.info("🚀 Starting Iman WhatsApp Bot...");
        logger.info(`📋 Config: ${JSON.stringify(config, null, 2)}`);

        // Start Express server once at startup
        app.listen(3000, "0.0.0.0", () => {
            logger.info("📡 Report API listening on port 3000");
        });

        await startBot();

        // Setup graceful shutdown handlers
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
        process.on("SIGHUP", () => shutdown("SIGHUP"));

        // Handle uncaught exceptions
        process.on("uncaughtException", (error) => {
            logger.error("❌ Uncaught exception", error);
            shutdown("uncaughtException");
        });

        process.on("unhandledRejection", (reason) => {
            logger.error("❌ Unhandled rejection", reason);
            shutdown("unhandledRejection");
        });
    } catch (error) {
        logger.error("Fatal error during startup", error);
        process.exit(1);
    }
}

// Run main
main().catch((error) => {
    logger.error("Main function error", error);
    process.exit(1);
});
