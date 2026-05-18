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
        await page.waitForTimeout(5000);

        logger.info("📦 Scrolling virtualized list & extracting products...");

        // Halaman showcase menggunakan ReactVirtualized yang hanya merender
        // produk yang terlihat di layar. Kita perlu scroll CONTAINER internalnya
        // (bukan window) dan mengumpulkan produk secara bertahap.
        const extractedProducts = await page.evaluate(async (): Promise<Array<{
            title: string;
            affiliateLink: string;
            imageUrl: string;
            price: string;
        }>> => {
            const seen = new Set<string>();
            const results: Array<{
                title: string;
                affiliateLink: string;
                imageUrl: string;
                price: string;
            }> = [];

            function collectProducts() {
                const allLinks = Array.from(document.querySelectorAll("a"));
                const productLinks = allLinks.filter(
                    (link) =>
                        link.href &&
                        (link.href.includes("shopee") ||
                            link.href.includes("collshp") ||
                            link.href.includes("s.shopee"))
                );

                for (const link of productLinks) {
                    if (seen.has(link.href)) continue;
                    seen.add(link.href);

                    const img = link.querySelector("img");
                    const imageUrl = img?.src || img?.getAttribute("data-src") || "";

                    const titleEl = link.querySelector("h1, h2, h3, h4, p, span, .title, .name");
                    const title = titleEl?.textContent?.trim()
                        || link.getAttribute("title")
                        || link.getAttribute("aria-label")
                        || "";

                    const priceEl = link.querySelector("[class*='price']");
                    const price = priceEl?.textContent?.trim() || "";

                    if (title && link.href) {
                        results.push({ title, affiliateLink: link.href, imageUrl, price });
                    }
                }
            }

            // Kumpulkan produk awal yang sudah terrender
            collectProducts();

            // Cari container ReactVirtualized (atau scrollable container lainnya)
            const gridContainer = document.querySelector(
                ".ReactVirtualized__Grid, .ReactVirtualized__List, [role='grid'][scrollable], [class*='virtual'], [style*='overflow: auto'], [style*='overflow:auto'], [style*='overflow-y: auto'], [style*='overflow-y:auto'], [style*='overflow: scroll'], [style*='overflow:scroll']"
            ) as HTMLElement | null;

            if (gridContainer) {
                // Scroll container virtualized secara bertahap
                const scrollDistance = 300;
                let noChangeCount = 0;
                let lastProductCount = results.length;

                for (let i = 0; i < 50; i++) { // max 50 scroll attempts
                    gridContainer.scrollTop += scrollDistance;
                    await new Promise(r => setTimeout(r, 500));
                    collectProducts();

                    if (results.length === lastProductCount) {
                        noChangeCount++;
                        if (noChangeCount >= 5) break; // Tidak ada produk baru 5x berturut-turut
                    } else {
                        noChangeCount = 0;
                        lastProductCount = results.length;
                    }
                }
            } else {
                // Fallback: scroll window biasa jika bukan ReactVirtualized
                let noChangeCount = 0;
                let lastProductCount = results.length;

                for (let i = 0; i < 30; i++) {
                    window.scrollBy(0, 400);
                    await new Promise(r => setTimeout(r, 500));
                    collectProducts();

                    if (results.length === lastProductCount) {
                        noChangeCount++;
                        if (noChangeCount >= 8) break;
                    } else {
                        noChangeCount = 0;
                        lastProductCount = results.length;
                    }
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

