/**
 * Shopee Showcase Scraper
 * Scraping produk dari collshp.com/shinkowstore menggunakan Playwright
 * Karena halaman ini adalah SPA (Single Page App), kita butuh headless browser
 */

import { chromium } from "playwright-core";
import { createLogger } from "./logger.js";

const logger = createLogger("Scraper");

export interface ShopeeProduct {
    title: string;
    affiliateLink: string;
    imageUrl: string;
    price?: string;
}

const DEFAULT_SHOWCASE_URL = "https://collshp.com/shinkowstore";

/**
 * Scrape semua produk dari halaman showcase Shopee
 * @param url - URL showcase yang akan di-scrape (default: shinkowstore)
 */
export async function scrapeShowcase(url?: string): Promise<ShopeeProduct[]> {
    const targetUrl = url || DEFAULT_SHOWCASE_URL;
    logger.info(`🔍 Starting scrape: ${targetUrl}`);

    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
    });

    const products: ShopeeProduct[] = [];

    try {
        const page = await browser.newPage();

        // Set user agent biar keliatan kayak browser biasa
        await page.setExtraHTTPHeaders({
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });

        logger.info("🌐 Opening showcase page...");
        await page.goto(targetUrl, {
            waitUntil: "networkidle",
            timeout: 60000,
        });

        // Tunggu konten produk muncul
        logger.info("⏳ Waiting for product content to load...");
        await page.waitForTimeout(3000);

        // Scroll ke bawah untuk load semua produk (lazy loading)
        await autoScroll(page);

        logger.info("📦 Extracting product data...");

        // Extract data produk dari DOM
        // Kode di dalam evaluate() berjalan di browser context, bukan Node.js
        const extractedProducts = await page.evaluate((): Array<{
            title: string;
            affiliateLink: string;
            imageUrl: string;
            price: string;
        }> => {
            const results: Array<{
                title: string;
                affiliateLink: string;
                imageUrl: string;
                price: string;
            }> = [];

            // Ambil semua link yang mengarah ke produk Shopee
            const allLinks = Array.from(document.querySelectorAll("a"));
            const productLinks = allLinks.filter(
                (link) =>
                    link.href &&
                    (link.href.includes("shopee") ||
                        link.href.includes("collshp") ||
                        link.href.includes("s.shopee"))
            );

            for (const link of productLinks) {
                // Cari gambar di dalam link
                const img = link.querySelector("img");
                const imageUrl = img?.src || img?.getAttribute("data-src") || "";

                // Cari judul produk
                const titleEl = link.querySelector("h1, h2, h3, h4, p, span, .title, .name");
                const title = titleEl?.textContent?.trim() 
                    || link.getAttribute("title") 
                    || link.getAttribute("aria-label") 
                    || "";

                // Cari harga
                const priceEl = link.querySelector("[class*='price']");
                const price = priceEl?.textContent?.trim() || "";

                if (title && link.href) {
                    results.push({
                        title,
                        affiliateLink: link.href,
                        imageUrl,
                        price,
                    });
                }
            }

            return results;
        });


        // Filter duplikat berdasarkan affiliate link
        const seen = new Set<string>();
        for (const product of extractedProducts) {
            if (product.title && product.affiliateLink && !seen.has(product.affiliateLink)) {
                seen.add(product.affiliateLink);
                products.push({
                    title: product.title,
                    affiliateLink: product.affiliateLink,
                    imageUrl: product.imageUrl,
                    price: product.price || undefined,
                });
            }
        }

        logger.info(`✅ Scraped ${products.length} products from showcase`);
    } catch (error) {
        logger.error("❌ Scraping failed", error);
        throw error;
    } finally {
        await browser.close();
    }

    return products;
}

/**
 * Auto scroll halaman untuk trigger lazy loading secara robust
 */
async function autoScroll(page: any): Promise<void> {
    await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 400; // Jarak scroll per interval
            let lastHeight = document.body.scrollHeight;
            let noChangeCount = 0;

            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;

                const currentHeight = document.body.scrollHeight;
                if (currentHeight === lastHeight) {
                    noChangeCount++;
                } else {
                    noChangeCount = 0;
                    lastHeight = currentHeight;
                }

                // Jika tinggi halaman tidak berubah selama 8 kali interval (sekitar 2 detik)
                // atau total scroll sudah sangat jauh (anti-loop), stop scroll.
                if (noChangeCount >= 8 || totalHeight >= 30000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 250);
        });
    });

    // Berikan jeda ekstra agar gambar lazy-load ter-render dengan sempurna
    await page.waitForTimeout(3000);
}
