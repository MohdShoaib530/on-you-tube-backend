import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

const app = express();
app.use(cors());

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

    // 🔥 Step 1: Fetch main page
    const response = await axios.get(url);
    const html = response.data;

    const $ = cheerio.load(html);

    // 🔥 Step 2: Get limited cards (performance)
    const cards = $("div.block.p-3").toArray().slice(0, 50);

    // 🔥 Step 3: Parallel scraping
    const videos = await Promise.all(
      cards.map(async (el) => {
        try {
          const $el = $(el);
          const anchor = $el.find("a");

          const link = anchor.attr("href");
          if (!link) return null;

          // 🔥 Fetch individual video page
          const videoPage = await axios.get(
            `https://acharyaprashant.org${link}`
          );

          const $$ = cheerio.load(videoPage.data);

          const iframeSrc = $$("iframe").attr("src");
          if (!iframeSrc || !iframeSrc.includes("/embed/")) return null;

          const videoId = iframeSrc.split("/embed/")[1].split("?")[0];

          const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

          // Extract other data
          const title = anchor.find("p").first().text().trim();
          const channel = anchor.find("p").eq(1).text().trim();
          const duration = anchor.find("div.absolute").text().trim();

          const spans = anchor.find("span");
          const views = spans.eq(0).text().trim();
          const timeAgo = spans.eq(1).text().trim();

          return {
            title,
            thumbnail,
            duration,
            channel,
            views,
            timeAgo,
            link: `https://acharyaprashant.org${link}`,
          };
        } catch (err) {
          return null; // skip failed ones
        }
      })
    );

    // 🔥 Step 4: Clean response
    const cleanVideos = videos.filter(Boolean);

    res.json(cleanVideos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Scraping failed" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));