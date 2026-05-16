import { logger } from "../utils/logger.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebFetchResult {
  url: string;
  title: string;
  content: string;
  statusCode: number;
}

const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export class WebService {
  async search(query: string, count = 5): Promise<WebSearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, "DuckDuckGo search failed");
        return [];
      }

      const html = await res.text();
      const results: WebSearchResult[] = [];

      const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < count) {
        const rawUrl = match[1] ?? "";
        const title = (match[2] ?? "").replace(/<[^>]*>/g, "").trim();
        const snippet = (match[3] ?? "").replace(/<[^>]*>/g, "").trim();

        let finalUrl = rawUrl;
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          finalUrl = decodeURIComponent(uddgMatch[1]!);
        }

        if (title && finalUrl) {
          results.push({ title, url: finalUrl, snippet });
        }
      }

      return results;
    } catch (err) {
      logger.error(err, "Web search error");
      return [];
    }
  }

  async fetch(url: string, maxLength = 20000): Promise<WebFetchResult> {
    // Try direct fetch first, fall back to Google cache / archive if blocked
    const result = await this.directFetch(url, maxLength);

    if (result.content && !isBlocked(result.content)) {
      return result;
    }

    // Blocked by JS challenge — try Google's cache
    logger.info({ url }, "Direct fetch blocked, trying Google cache");
    const cacheResult = await this.directFetch(
      `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`,
      maxLength,
    );
    if (cacheResult.content && !isBlocked(cacheResult.content)) {
      return { ...cacheResult, url };
    }

    // Try archive.org as last resort
    logger.info({ url }, "Google cache failed, trying archive.org");
    const archiveResult = await this.directFetch(
      `https://web.archive.org/web/2024/${url}`,
      maxLength,
    );
    if (archiveResult.content && !isBlocked(archiveResult.content)) {
      return { ...archiveResult, url };
    }

    return {
      url,
      title: "",
      content: `Could not fetch this page — it requires JavaScript. Try searching for the content instead using web_search.`,
      statusCode: result.statusCode,
    };
  }

  private async directFetch(url: string, maxLength: number): Promise<WebFetchResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "DNT": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      const contentType = res.headers.get("content-type") ?? "";
      let content: string;

      if (contentType.includes("application/json")) {
        const json = await res.json();
        content = JSON.stringify(json, null, 2);
      } else {
        const html = await res.text();
        content = extractReadableText(html);
      }

      if (content.length > maxLength) {
        content = content.slice(0, maxLength) + "\n\n[Content truncated]";
      }

      const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1]!.trim() : "";

      return { url, title, content, statusCode: res.status };
    } catch (err: any) {
      logger.error({ url, err: err.message }, "Web fetch error");
      return { url, title: "", content: "", statusCode: 0 };
    }
  }
}

function isBlocked(content: string): boolean {
  const lower = content.toLowerCase().slice(0, 2000);
  return (
    (lower.includes("enable javascript") && lower.includes("continue")) ||
    (lower.includes("just a moment") && content.length < 500) ||
    (lower.includes("checking your browser") && content.length < 500) ||
    (lower.includes("cf-browser-verification") && content.length < 1000) ||
    (lower.includes("ray id") && lower.includes("cloudflare") && content.length < 1000)
  );
}

function extractReadableText(html: string): string {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Convert headers to markdown-style
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    const clean = content.replace(/<[^>]*>/g, "").trim();
    return "\n" + "#".repeat(Number(level)) + " " + clean + "\n";
  });

  // Convert links to readable format
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
    const clean = content.replace(/<[^>]*>/g, "").trim();
    if (!clean) return "";
    return clean;
  });

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    const clean = content.replace(/<[^>]*>/g, "").trim();
    return "• " + clean + "\n";
  });

  // Preserve code blocks
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
    const clean = content.replace(/<[^>]*>/g, "");
    return "\n```\n" + clean.trim() + "\n```\n";
  });
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
    const clean = content.replace(/<[^>]*>/g, "");
    return "`" + clean + "`";
  });

  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|br|blockquote|tr|hr|section|article|main)[^>]*>/gi, "\n");
  text = text.replace(/<\/?(ul|ol|table|thead|tbody|dl|dt|dd)[^>]*>/gi, "\n");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
