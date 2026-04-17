/**
 * Scrape MarineTraffic vessel positions via their internal tile JSON API.
 * Uses puppeteer-extra with stealth plugin to bypass Cloudflare.
 *
 * Key: must visit the main MarineTraffic page first to establish a
 * Cloudflare session (cookies + JS challenge), then scrape tile URLs.
 *
 * Environment variables:
 *   INGEST_URL      — e.g. https://hormuzwatch-production-d56b.up.railway.app
 *   INGEST_API_KEY  — bearer token for /api/ingest/vessels
 */
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

// Strait of Hormuz tiles at zoom level 8
const TILES = [
  { x: 83, y: 53 },
  { x: 84, y: 53 },
  { x: 83, y: 54 },
  { x: 84, y: 54 },
];

const BASE_URL = "https://www.marinetraffic.com/getData/get_data_json_4/z:8";

async function scrapeTile(page, tile) {
  const url = `${BASE_URL}/X:${tile.x}/Y:${tile.y}/station:0`;
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const status = resp?.status();
    const body = await page.evaluate(() => document.body.innerText);

    if (status === 403 || body.includes("<!DOCTYPE") || body.includes("Cloudflare")) {
      console.error(`Tile (${tile.x},${tile.y}): blocked (status ${status})`);
      return [];
    }

    const data = JSON.parse(body);
    if (!Array.isArray(data)) {
      console.error(`Tile (${tile.x},${tile.y}): unexpected response type: ${typeof data}`);
      return [];
    }
    console.error(`Tile (${tile.x},${tile.y}): ${data.length} ships`);
    return data;
  } catch (e) {
    console.error(`Tile (${tile.x},${tile.y}): ${e.message}`);
    return [];
  }
}

function normalize(ship) {
  return {
    mmsi: String(ship.MMSI || ship.SHIP_ID || ""),
    name: (ship.SHIPNAME || "").replace("[SAT-AIS]", "").trim(),
    lat: ship.LAT,
    lon: ship.LON,
    speed: ship.SPEED ? ship.SPEED / 10.0 : 0,
    course: ship.COURSE ? ship.COURSE / 10.0 : 0,
    heading: ship.HEADING === 511 ? 511 : (ship.HEADING || 511),
    ship_type: ship.SHIPTYPE || 0,
    flag: (ship.FLAG || "").toLowerCase(),
    timestamp: new Date().toISOString(),
    _source: "marinetraffic",
  };
}

async function main() {
  console.error("Launching browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  // Set viewport to look like a real browser
  await page.setViewport({ width: 1920, height: 1080 });

  // Step 1: Visit the main site to pass Cloudflare challenge and get cookies
  console.error("Visiting MarineTraffic homepage to establish session...");
  try {
    await page.goto("https://www.marinetraffic.com/en/ais/home", {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    // Wait a bit for Cloudflare JS challenge to complete
    await new Promise((r) => setTimeout(r, 5000));

    const title = await page.title();
    console.error(`Page title: "${title}"`);

    // Check if we're past Cloudflare
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
    if (bodyText.includes("Checking your browser") || bodyText.includes("Just a moment")) {
      console.error("Cloudflare challenge detected — waiting 10s more...");
      await new Promise((r) => setTimeout(r, 10000));
    }

    // Log cookies to verify session
    const cookies = await page.cookies();
    const cfCookie = cookies.find((c) => c.name === "cf_clearance");
    console.error(`Cookies: ${cookies.length} total, cf_clearance: ${cfCookie ? "YES" : "NO"}`);
  } catch (e) {
    console.error(`Homepage visit failed: ${e.message}`);
  }

  // Step 2: Scrape tiles using the established session
  console.error("Scraping tiles...");
  const allShips = new Map();
  for (const tile of TILES) {
    const ships = await scrapeTile(page, tile);
    for (const s of ships) {
      const key = s.SHIP_ID || s.MMSI || `${s.LAT}_${s.LON}`;
      if (!allShips.has(key)) {
        allShips.set(key, s);
      }
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
  }
  await browser.close();

  // Filter out stale positions (>6h) and SAT-AIS tagged
  const vessels = [...allShips.values()]
    .filter((s) => !(s.SHIPNAME || "").includes("[SAT-AIS]"))
    .filter((s) => !s.ELAPSED || s.ELAPSED < 360)
    .map(normalize)
    .filter((v) => v.lat && v.lon);

  console.error(`Scraped ${vessels.length} unique vessels from ${TILES.length} tiles.`);

  // POST to backend if configured
  const ingestUrl = process.env.INGEST_URL;
  const ingestKey = process.env.INGEST_API_KEY;
  if (ingestUrl && vessels.length > 0) {
    try {
      const resp = await fetch(`${ingestUrl}/api/ingest/vessels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ingestKey ? { Authorization: `Bearer ${ingestKey}` } : {}),
        },
        body: JSON.stringify(vessels),
      });
      const result = await resp.json();
      console.error(`POSTed to backend: ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`Failed to POST: ${e.message}`);
    }
  } else if (vessels.length === 0) {
    console.error("No vessels scraped — nothing to POST.");
  } else {
    console.error("INGEST_URL not set — skipping POST.");
  }

  console.log(JSON.stringify({ count: vessels.length, timestamp: new Date().toISOString() }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
