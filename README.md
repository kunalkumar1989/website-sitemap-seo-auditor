# Website Sitemap Auditor

A small Node.js application that discovers sitemap URLs and audits pages for common SEO and technical issues.

## Features

- Discovers sitemaps from `robots.txt`, `sitemap.xml`, and sitemap indexes.
- Checks HTTP status and redirects.
- Checks page titles and meta descriptions.
- Checks H1 usage.
- Checks canonical URLs.
- Checks `noindex` directives.
- Checks image ALT attributes.
- Detects duplicate titles and meta descriptions.

## Requirements

- Node.js 18 or newer
- npm

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Enter the website URL you are authorized to audit.

## Public repository hygiene

This repository intentionally excludes `node_modules`. Install dependencies with `npm install`.

The repository does not include website-specific assets, logos, customer data, credentials, private URLs, or copied website content.

Only audit websites that you own or are authorized to crawl. Respect the target site's terms, robots directives, rate limits, and applicable laws.

## Dependencies

Runtime dependencies are declared in `package.json` and locked in `package-lock.json`. Their respective licenses remain with their original authors.

## License

No open-source license is included in this repository because the original ownership and licensing of the supplied source could not be independently verified.

If you own all of the source code and want to release it under an open-source license, add the license you choose before publishing.

## Security

Before exposing this application to the public internet, review and harden SSRF protection, crawl limits, authentication, resource limits, robots compliance, and concurrent job handling.
