import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import pLimit from "p-limit";
import https from "https";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  }),
);

// ❌ keepAlive हटाया → memory leak warning बंद
const httpsAgent = new https.Agent({
  keepAlive: false,
  maxSockets: 3,
});

// ✅ clean axios instance
const api = axios.create({
  httpsAgent,
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0",
  },
});

const limit = pLimit(2); // 🔥 reduce more (important)

app.get("/api/videos", async (req, res) => {
  try {
    const { categoryId, language, orderBy, publishedAtYear, channels } =
      req.query;

    const params = new URLSearchParams();

    if (categoryId) params.append("categoryId", categoryId);
    if (language) params.append("language", language);
    if (orderBy) params.append("orderBy", orderBy);
    if (publishedAtYear) params.append("publishedAtYear", publishedAtYear);

    if (channels) {
      const arr = Array.isArray(channels) ? channels : [channels];
      arr.forEach((ch) => params.append("channels", ch));
    }

    const url = `https://acharyaprashant.org/on-youtube?${params.toString()}`;

    // 🔥 Step 1: fetch main page
    const { data: html } = await api.get(url);
    const $ = cheerio.load(html);

    const cards = $("div.block.p-3").toArray().slice(0, 20);

    // 🔥 Step 2: parallel scraping with limit
    const videos = await Promise.all(
      cards.map((el) =>
        limit(async () => {
          try {
            const $el = $(el);
            const anchor = $el.find("a");

            const link = anchor.attr("href");
            if (!link) return null;

            // 🔥 fetch video page
            const { data: videoHtml } = await api.get(
              `https://acharyaprashant.org${link}`,
            );

            const $$ = cheerio.load(videoHtml);

            // 🎯 thumbnail
            const iframeSrc = $$("iframe").attr("src");
            if (!iframeSrc) return null;

            let thumbnail = null;

            if (iframeSrc && iframeSrc.includes("/embed/")) {
              const videoId = iframeSrc.split("/embed/")[1]?.split("?")[0];

              if (videoId) {
                thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
              }
            }

            // 🎯 basic data
            const title = anchor.find("p").first().text().trim();
            const channel = anchor.find("p").eq(1).text().trim();
            const duration = anchor.find("div.absolute").text().trim();

            const spans = anchor.find("span");
            const views = spans.eq(0).text().trim();
            const timeAgo = spans.eq(1).text().trim();

            // 🔥 tags (main page से)
            const tags = [];
            $el.find("div.flex.gap-1\\.5.pt-3 div").each((i, el) => {
              const text = $(el).text().trim();
              if (text) tags.push(text);
            });

            return {
              title,
              thumbnail,
              duration,
              channel,
              views,
              timeAgo,
              tags,
              link: `https://acharyaprashant.org${link}`,
            };
          } catch (err) {
            return null;
          }
        }),
      ),
    );

    res.json(videos.filter(Boolean));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Scraping failed" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
