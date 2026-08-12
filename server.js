const express = require("express");
const cheerio = require("cheerio");
const { URL } = require("url");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const jobs = new Map();

async function fetchText(url, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const res = await fetch(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: {
                "User-Agent": "Website-Sitemap-Auditor/1.0"
            }
        });

        const text = await res.text();

        return {
            res,
            text
        };
    } finally {
        clearTimeout(timer);
    }
}

function absolute(base, href) {
    try {
        return new URL(href, base).href.split("#")[0];
    } catch {
        return null;
    }
}

function issue(severity, type, message) {
    return {
        severity,
        type,
        message
    };
}

/**
 * Find sitemap URLs
 */
async function findSitemaps(origin, job) {

    job.status = "Discovering sitemap";
    job.progress = 5;

    const found = new Set();

    // robots.txt
    try {
        job.currentUrl = new URL("/robots.txt", origin).href;

        const r = await fetchText(job.currentUrl);

        if (r.res.ok) {

            for (const line of r.text.split(/\r?\n/)) {

                if (/^sitemap:/i.test(line)) {

                    const sitemap = line
                        .split(":")
                        .slice(1)
                        .join(":")
                        .trim();

                    if (sitemap) {
                        found.add(sitemap);
                    }
                }
            }
        }

    } catch (error) {
        console.log("robots.txt error:", error.message);
    }

    job.progress = 15;

    // Common sitemap locations
    const candidates = [
        "/sitemap.xml",
        "/sitemap_index.xml",
        "/sitemap-index.xml"
    ];

    for (const path of candidates) {

        const sitemapUrl = new URL(path, origin).href;

        job.currentUrl = sitemapUrl;

        try {

            const r = await fetchText(sitemapUrl);

            if (r.res.ok) {
                found.add(sitemapUrl);
            }

        } catch (error) {
            console.log("Sitemap check error:", sitemapUrl);
        }
    }

    job.progress = 25;

    job.sitemaps = [...found];

    return [...found];
}

/**
 * Parse sitemap
 */
async function parseSitemap(url, seen = new Set(), job) {

    if (seen.has(url)) {
        return [];
    }

    seen.add(url);

    job.status = "Parsing sitemap";
    job.currentUrl = url;

    try {

        const {
            res,
            text
        } = await fetchText(url);

        if (!res.ok) {
            return [];
        }

        const $ = cheerio.load(text, {
            xmlMode: true
        });

        const urls = [];

        // Normal sitemap
        $("url > loc").each((_, element) => {

            const loc = $(element)
                .text()
                .trim();

            if (loc) {
                urls.push(loc);
            }

        });

        // Sitemap index
        const children = [];

        $("sitemap > loc").each((_, element) => {

            const loc = $(element)
                .text()
                .trim();

            if (loc) {
                children.push(loc);
            }

        });

        for (const child of children) {

            const childUrls = await parseSitemap(
                child,
                seen,
                job
            );

            urls.push(...childUrls);
        }

        return [...new Set(urls)];

    } catch (error) {

        console.log(
            "Sitemap parsing error:",
            url,
            error.message
        );

        return [];
    }
}

/**
 * Audit page
 */
async function auditPage(url, origin) {

    const started = Date.now();

    const result = {

        url,

        status: 0,

        finalUrl: url,

        responseMs: 0,

        title: "",

        metaDescription: "",

        h1Count: 0,

        canonical: "",

        robots: "",

        images: 0,

        imagesMissingAlt: 0,

        internalLinks: 0,

        issues: []
    };

    let res;
    let html;

    try {

        ({
            res,
            text: html
        } = await fetchText(url));

        result.status = res.status;

        result.finalUrl = res.url || url;

        result.responseMs =
            Date.now() - started;

    } catch (error) {

        result.issues.push(
            issue(
                "critical",
                "FETCH_ERROR",
                error.name === "AbortError"
                    ? "Request timed out"
                    : "Could not fetch page"
            )
        );

        return result;
    }

    if (result.status >= 400) {

        result.issues.push(
            issue(
                "critical",
                "HTTP_STATUS",
                `Page returned HTTP ${result.status}`
            )
        );

        return result;
    }

    const $ = cheerio.load(html);

    result.title =
        $("title")
            .first()
            .text()
            .trim();

    result.metaDescription =
        $('meta[name="description"]')
            .attr("content")
            ?.trim() || "";

    result.h1Count =
        $("h1").length;

    result.canonical =
        $('link[rel="canonical"]')
            .attr("href")
            ?.trim() || "";

    result.robots =
        $('meta[name="robots"]')
            .attr("content")
            ?.trim() || "";

    result.images =
        $("img").length;

    result.imagesMissingAlt =
        $("img")
            .filter(
                (_, el) =>
                    !$(el)
                        .attr("alt")
                        ?.trim()
            )
            .length;

    /**
     * SEO checks
     */

    if (!result.title) {

        result.issues.push(
            issue(
                "critical",
                "MISSING_TITLE",
                "Missing page title"
            )
        );

    } else if (result.title.length > 60) {

        result.issues.push(
            issue(
                "warning",
                "TITLE_LONG",
                `Title is ${result.title.length} characters`
            )
        );
    }

    if (!result.metaDescription) {

        result.issues.push(
            issue(
                "warning",
                "MISSING_META_DESCRIPTION",
                "Missing meta description"
            )
        );

    } else if (
        result.metaDescription.length > 160
    ) {

        result.issues.push(
            issue(
                "warning",
                "META_DESCRIPTION_LONG",
                `Meta description is ${result.metaDescription.length} characters`
            )
        );
    }

    if (result.h1Count === 0) {

        result.issues.push(
            issue(
                "critical",
                "MISSING_H1",
                "No H1 heading found"
            )
        );
    }

    if (result.h1Count > 1) {

        result.issues.push(
            issue(
                "warning",
                "MULTIPLE_H1",
                `${result.h1Count} H1 headings found`
            )
        );
    }

    if (!result.canonical) {

        result.issues.push(
            issue(
                "warning",
                "MISSING_CANONICAL",
                "Missing canonical URL"
            )
        );
    }

    if (result.imagesMissingAlt) {

        result.issues.push(
            issue(
                "warning",
                "IMAGE_ALT",
                `${result.imagesMissingAlt} image(s) missing alt text`
            )
        );
    }

    if (/noindex/i.test(result.robots)) {

        result.issues.push(
            issue(
                "warning",
                "NOINDEX",
                "Page contains noindex directive"
            )
        );
    }

    if (result.finalUrl !== url) {

        result.issues.push(
            issue(
                "warning",
                "REDIRECT",
                `Redirected to ${result.finalUrl}`
            )
        );
    }

    return result;
}

/**
 * Start audit
 */
app.post("/api/audit", async (req, res) => {

    const input =
        String(req.body.url || "").trim();

    let origin;

    try {

        origin =
            new URL(
                /^https?:\/\//i.test(input)
                    ? input
                    : `https://${input}`
            ).origin;

    } catch {

        return res.status(400).json({
            error:
                "Please enter a valid website URL."
        });
    }

    const jobId =
        Date.now().toString();

    jobs.set(jobId, {

        status: "Starting",

        progress: 0,

        currentUrl: "",

        scanned: 0,

        total: 0,

        issuesFound: 0,

        sitemaps: [],

        sitemapUrls: 0,

        pages: [],

        completed: false,

        error: null
    });

    // Start audit in background
    runAudit(jobId, origin);

    res.json({
        jobId
    });
});

/**
 * Progress API
 */
app.get("/api/audit/:jobId", (req, res) => {

    const job =
        jobs.get(req.params.jobId);

    if (!job) {

        return res.status(404).json({
            error: "Job not found"
        });
    }

    res.json(job);
});

/**
 * Actual audit process
 */
async function runAudit(jobId, origin) {

    const job =
        jobs.get(jobId);

    try {

        /**
         * STEP 1
         */
        const sitemapCandidates =
            await findSitemaps(
                origin,
                job
            );

        if (!sitemapCandidates.length) {

            job.status =
                "No sitemap found";

            job.progress = 100;

            job.completed = true;

            return;
        }

        /**
         * STEP 2
         */
        job.status =
            "Parsing sitemap";

        let urls = [];

        for (
            const sitemap of sitemapCandidates
        ) {

            const sitemapUrls =
                await parseSitemap(
                    sitemap,
                    new Set(),
                    job
                );

            urls.push(...sitemapUrls);
        }

        urls = [
            ...new Set(urls)
        ];

        job.sitemapUrls =
            urls.length;

        job.total =
            urls.length;

        if (!urls.length) {

            job.status =
                "Sitemap found but no URLs";

            job.progress = 100;

            job.completed = true;

            return;
        }

        /**
         * STEP 3
         */
        job.status =
            "Crawling pages";

        const maxPages =
            Math.min(
                Number(500),
                urls.length
            );

        const targetUrls =
            urls.slice(0, maxPages);

        job.total =
            targetUrls.length;

        const pages = [];

        for (
            let i = 0;
            i < targetUrls.length;
            i++
        ) {

            const url =
                targetUrls[i];

            job.currentUrl =
                url;

            const result =
                await auditPage(
                    url,
                    origin
                );

            pages.push(result);

            job.scanned =
                i + 1;

            job.issuesFound +=
                result.issues.length;

            /**
             * 25% → 95%
             */
            job.progress =
                25 +
                Math.round(
                    ((i + 1) /
                        targetUrls.length) *
                    70
                );
        }

        /**
         * STEP 4
         * Duplicate title/meta
         */

        job.status =
            "Analyzing results";

        const titleMap =
            new Map();

        const metaMap =
            new Map();

        pages.forEach(page => {

            if (page.title) {

                titleMap.set(
                    page.title,
                    (titleMap.get(page.title) || [])
                        .concat(page.url)
                );
            }

            if (page.metaDescription) {

                metaMap.set(
                    page.metaDescription,
                    (metaMap.get(page.metaDescription) || [])
                        .concat(page.url)
                );
            }
        });

        pages.forEach(page => {

            if (
                page.title &&
                titleMap.get(page.title).length > 1
            ) {

                page.issues.push(
                    issue(
                        "warning",
                        "DUPLICATE_TITLE",
                        "Duplicate title found"
                    )
                );
            }

            if (
                page.metaDescription &&
                metaMap.get(page.metaDescription).length > 1
            ) {

                page.issues.push(
                    issue(
                        "warning",
                        "DUPLICATE_META_DESCRIPTION",
                        "Duplicate meta description found"
                    )
                );
            }
        });

        job.pages = pages;

        job.status =
            "Audit completed";

        job.progress = 100;

        job.completed = true;

    } catch (error) {

        console.error(error);

        job.status =
            "Audit failed";

        job.error =
            error.message;

        job.completed = true;
    }
}

app.listen(
    3000,
    () => {
        console.log(
            "Website Auditor running on http://localhost:3000"
        );
    }
);