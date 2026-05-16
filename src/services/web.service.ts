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

export class WebService {
  async search(query: string, count = 5): Promise<WebSearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ArcStack/1.0)",
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

  async fetch(url: string, maxLength = 15000): Promise<WebFetchResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ArcStack/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/json",
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
      const title = titleMatch ? titleMatch[1]!.trim() : new URL(url).hostname;

      return { url, title, content, statusCode: res.status };
    } catch (err: any) {
      logger.error({ url, err }, "Web fetch error");
      return {
        url,
        title: "",
        content: "",
        statusCode: 0,
      };
    }
  }
}

function extractReadableText(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*>/gi, "\n");
  text = text.replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, "\n");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
