/**
 * Traffic Harvester — Auth Module
 * Register, Login, JWT middleware
 */

import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, users, showcaseConfigs } from "./db.js";
import { eq } from "drizzle-orm";
import { createLogger } from "./logger.js";

const logger = createLogger("Auth");
const JWT_SECRET = process.env.JWT_SECRET || "traffic-harvester-secret-change-in-prod";

export interface AuthRequest extends Request {
    userId?: number;
    userEmail?: string;
}

/**
 * POST /auth/register
 */
export async function register(req: Request, res: Response): Promise<Response> {
    try {
        const { email, password, store_name } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email dan password wajib diisi" });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: "Password minimal 6 karakter" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await db.instance()
            .insert(users)
            .values({ email, passwordHash, storeName: store_name || null })
            .returning({ id: users.id, email: users.email, storeName: users.storeName });

        const user = result[0];
        if (!user) return res.status(500).json({ error: "Gagal membuat akun" });

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });

        logger.info(`✅ New user registered: ${email}`);
        return res.status(201).json({ success: true, token, user: { id: user.id, email: user.email, store_name: user.storeName } });
    } catch (error: any) {
        if (error.message?.includes("unique") || error.code === "23505") {
            return res.status(409).json({ error: "Email sudah terdaftar" });
        }
        logger.error("Register error", error);
        return res.status(500).json({ error: "Terjadi kesalahan server" });
    }
}

/**
 * POST /auth/login
 */
export async function login(req: Request, res: Response): Promise<Response> {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email dan password wajib diisi" });
        }

        const result = await db.instance()
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        const user = result[0];
        if (!user) {
            return res.status(401).json({ error: "Email atau password salah" });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: "Email atau password salah" });
        }

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });

        logger.info(`✅ User logged in: ${email}`);
        return res.json({
            success: true,
            token,
            user: { id: user.id, email: user.email, store_name: user.storeName }
        });
    } catch (error: any) {
        logger.error("Login error", error);
        return res.status(500).json({ error: "Terjadi kesalahan server" });
    }
}

/**
 * JWT Middleware — protect routes
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Token tidak ditemukan" });
        return;
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token!, JWT_SECRET) as unknown as { userId: number; email: string };
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        next();
    } catch {
        res.status(401).json({ error: "Token tidak valid atau sudah expired" });
    }
}

/**
 * GET /api/me — Get current user profile
 */
export async function getMe(req: AuthRequest, res: Response): Promise<Response> {
    try {
        const result = await db.instance()
            .select({ id: users.id, email: users.email, storeName: users.storeName, createdAt: users.createdAt })
            .from(users)
            .where(eq(users.id, req.userId!))
            .limit(1);

        const user = result[0];
        if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

        // Ambil showcase configs milik user
        const showcases = await db.instance()
            .select()
            .from(showcaseConfigs)
            .where(eq(showcaseConfigs.userId, req.userId!));

        return res.json({
            success: true,
            user: { id: user.id, email: user.email, store_name: user.storeName, created_at: user.createdAt },
            showcases
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}

/**
 * POST /api/showcase — Tambah/update showcase URL
 */
export async function upsertShowcase(req: AuthRequest, res: Response): Promise<Response> {
    try {
        const { showcase_url, label } = req.body;
        if (!showcase_url) return res.status(400).json({ error: "showcase_url wajib diisi" });

        // Validasi format URL
        try { new URL(showcase_url); } catch {
            return res.status(400).json({ error: "Format URL tidak valid" });
        }

        const result = await db.instance()
            .insert(showcaseConfigs)
            .values({ userId: req.userId!, showcaseUrl: showcase_url, label: label || null })
            .onConflictDoUpdate({
                target: [showcaseConfigs.userId, showcaseConfigs.showcaseUrl],
                set: { label: label || null, isActive: true }
            })
            .returning();

        logger.info(`✅ Showcase upserted for user ${req.userId}: ${showcase_url}`);
        return res.json({ success: true, showcase: result[0] });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}

/**
 * DELETE /api/showcase/:id — Hapus showcase
 */
export async function deleteShowcase(req: AuthRequest, res: Response): Promise<Response> {
    const { id } = req.params;
    try {
        await db.instance().execute(
            // @ts-ignore
            `DELETE FROM showcase_configs WHERE id = ${parseInt(id)} AND user_id = ${req.userId}`
        );
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}
