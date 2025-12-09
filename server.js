import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Innertube } from "youtubei.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

<<<<<<< HEAD
// -------------------- CORS --------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// -------------------- 共通 YouTube クライアント --------------------
const createYoutube = async () => {
  return await Innertube.create({ lang: "ja", location: "JP" });
};

// ----------------------------------------------------------------
// Stream Proxy API
// ----------------------------------------------------------------
app.get("/api/stream/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!videoId) return res.status(400).json({ error: "Missing video id" });

    const targetUrl = `https://siawaseok.duckdns.org/api/stream/${videoId}/type2`;
    const response = await fetch(targetUrl);

    res.status(response.status);
    response.headers.forEach((val, key) => res.setHeader(key, val));

    if (!response.body) return res.end();

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error("Stream error:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Video API
// ----------------------------------------------------------------
app.get("/api/video", async (req, res) => {
  try {
    const youtube = await createYoutube();
=======
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get('/api/video', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
>>>>>>> 9d0bd4a99e8134961d0af8e3b97be65771962820
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing video id" });

    const info = await youtube.getInfo(id);

    let relatedVideos = [];
    const MAX_VIDEOS = 100;
<<<<<<< HEAD
    const queue = [...(info.related || info.watch_next_feed || [])];
    const seen = new Set();

    while (queue.length && relatedVideos.length < MAX_VIDEOS) {
      const video = queue.shift();
      if (!video?.id || seen.has(video.id)) continue;
      seen.add(video.id);
      relatedVideos.push(video);
      if (Array.isArray(video.related)) queue.push(...video.related);
    }

    info.watch_next_feed = relatedVideos.slice(0, MAX_VIDEOS);
    info.related_videos = [];
    info.related = [];
    if (info.secondary_info) info.secondary_info.watch_next_feed = [];

    res.json(info);
  } catch (err) {
    console.error("Video error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Search API
// ----------------------------------------------------------------
app.get("/api/search", async (req, res) => {
  try {
    const youtube = await createYoutube();
    const { q, page = "1" } = req.query;
    if (!q) return res.status(400).json({ error: "Missing search query" });

    const perPage = 50;
    const pageNum = parseInt(page);

    let search = await youtube.search(q, { type: "video" });
    let videos = [...(search.videos || [])];

    while (videos.length < pageNum * perPage && search.has_continuation) {
      search = await search.getContinuation();
      if (search.videos) videos.push(...search.videos);
    }

    const start = (pageNum - 1) * perPage;
    const end = start + perPage;

    res.json({
      videos: videos.slice(start, end),
      nextPageToken: videos.length > end ? String(pageNum + 1) : undefined
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Comments API
// ----------------------------------------------------------------
app.get("/api/comments", async (req, res) => {
  try {
    const youtube = await createYoutube();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing video id" });

    const limit = 300;
    let commentsSection = await youtube.getComments(id);
    let comments = commentsSection.contents || [];

    while (comments.length < limit && commentsSection.has_continuation) {
      commentsSection = await commentsSection.getContinuation();
      comments = comments.concat(commentsSection.contents || []);
    }

    res.json({
      comments: comments.slice(0, limit).map(c => ({
        text: c.comment?.content?.text ?? null,
        author: c.comment?.author?.name ?? null
      }))
    });
  } catch (err) {
    console.error("Comments error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Channel API
// ----------------------------------------------------------------
app.get("/api/channel", async (req, res) => {
  try {
    const youtube = await createYoutube();
    const { id, page = "1" } = req.query;
    if (!id) return res.status(400).json({ error: "Missing channel id" });

    const channel = await youtube.getChannel(id);
    let videosFeed = await channel.getVideos();

    const pageNum = parseInt(page);
    for (let i = 1; i < pageNum; i++) {
      if (videosFeed.has_continuation) {
        videosFeed = await videosFeed.getContinuation();
      }
    }

    res.json({
      channel: {
        id: channel.id,
        name: channel.metadata?.title || null
      },
      page: pageNum,
      videos: videosFeed.videos || []
    });
  } catch (err) {
    console.error("Channel error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Playlist API
// ----------------------------------------------------------------
app.get("/api/playlist", async (req, res) => {
  try {
    const youtube = await createYoutube();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing playlist id" });

    const playlist = await youtube.getPlaylist(id);
    res.json(playlist);
  } catch (err) {
    console.error("Playlist error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// Home Feed
// ----------------------------------------------------------------
app.get("/api/fvideo", async (req, res) => {
  try {
    const youtube = await createYoutube();
    const home = await youtube.getHomeFeed();
    res.json({ videos: home.videos || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// AI mock API
// ----------------------------------------------------------------
app.get("/api/ai/completion", (req, res) => {
  const topics = ["ASMR", "Gaming", "Vtuber", "Music", "Tech"];
  const random = topics[Math.floor(Math.random() * topics.length)];
  res.json({
    response: `Suggestion: Try watching ${random} videos!`,
    recommended_tags: [random, "Trending"]
  });
});

// -------------------- 静的ファイル + SPA --------------------
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// -------------------- 起動 --------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
=======

    let initialRelated = info.related || [];
    if (!initialRelated.length && Array.isArray(info.related_videos)) {
      initialRelated = info.related_videos;
    } else if (!initialRelated.length && Array.isArray(info.watch_next_feed)) {
      initialRelated = info.watch_next_feed;
    } else if (!initialRelated.length && Array.isArray(info.secondary_info?.watch_next_feed)) {
      initialRelated = info.secondary_info.watch_next_feed;
    }
    
    const queue = [...initialRelated]; 
    const seen = new Set();
    
    while (queue.length > 0 && relatedVideos.length < MAX_VIDEOS) {
      const video = queue.shift();
      
      if (!video || typeof video.id !== 'string' || video.id.length !== 11 || seen.has(video.id)) {
        continue;
      }
      seen.add(video.id);

      relatedVideos.push(video);

      if (Array.isArray(video.related) && video.related.length > 0) {
        queue.push(...video.related);
      }
    }

    info.watch_next_feed = relatedVideos.slice(0, MAX_VIDEOS);
    
    if (info.related_videos) info.related_videos = [];
    if (info.secondary_info?.watch_next_feed) info.secondary_info.watch_next_feed = [];
    if (info.related) info.related = [];

    res.status(200).json(info);
    
  } catch (err) {
    console.error('Error in /api/video:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const { q: query, limit = '50' } = req.query;
    if (!query) return res.status(400).json({ error: "Missing search query" });
    const limitNumber = parseInt(limit);
    let search = await youtube.search(query, { type: "video" });
    let videos = search.videos || [];
    while (videos.length < limitNumber && search.has_continuation) {
        search = await search.getContinuation();
        videos = videos.concat(search.videos);
    }
    res.status(200).json(videos.slice(0, limitNumber));
  } catch (err) { 
    console.error('Error in /api/search:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/comments', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing video id" });
    const limit = 300;
    let commentsSection = await youtube.getComments(id);
    let allComments = commentsSection.contents || [];
    while (allComments.length < limit && commentsSection.has_continuation) {
      commentsSection = await commentsSection.getContinuation();
      allComments = allComments.concat(commentsSection.contents);
    }
    res.status(200).json({
      comments: allComments.slice(0, limit).map(c => ({
        text: c.comment?.content?.text ?? null, 
        comment_id: c.comment?.comment_id ?? null, 
        published_time: c.comment?.published_time ?? null,
        author: { 
          id: c.comment?.author?.id ?? null, 
          name: c.comment?.author?.name ?? null, 
          thumbnails: c.comment?.author?.thumbnails ?? [] 
        },
        like_count: c.comment?.like_count?.toString() ?? '0', 
        reply_count: c.comment?.reply_count?.toString() ?? '0', 
        is_pinned: c.comment?.is_pinned ?? false
      }))
    });
  } catch (err) { 
    console.error('Error in /api/comments:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/channel', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const { id, page = '1' } = req.query;
    if (!id) return res.status(400).json({ error: "Missing channel id" });
    const channel = await youtube.getChannel(id);
    let videosFeed = await channel.getVideos();
    for (let i = 1; i < parseInt(page); i++) {
      if (videosFeed.has_continuation) {
        videosFeed = await videosFeed.getContinuation();
      } else {
        videosFeed.videos = [];
        break;
      }
    }
    res.status(200).json({
      channel: {
        id: channel.id, 
        name: channel.metadata?.title || null, 
        description: channel.metadata?.description || null,
        avatar: channel.metadata?.avatar || null, 
        banner: channel.metadata?.banner || null,
        subscriberCount: channel.metadata?.subscriber_count?.pretty || '非公開', 
        videoCount: channel.metadata?.videos_count?.text ?? channel.metadata?.videos_count ?? '0'
      },
      page: parseInt(page), 
      videos: videosFeed.videos || []
    });
  } catch (err) { 
    console.error('Error in /api/channel:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/channel-shorts', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing channel id" });
    const channel = await youtube.getChannel(id);
    const shorts = await channel.getShorts();
    res.status(200).json(shorts.videos);
  } catch (err) { 
    console.error('Error in /api/channel-shorts:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/channel-playlists', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Missing channel id" });
    const channel = await youtube.getChannel(id);
    const playlists = await channel.getPlaylists();
    res.status(200).json(playlists);
  } catch (err) { 
    console.error('Error in /api/channel-playlists:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/playlist', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const { id: playlistId } = req.query;
    if (!playlistId) return res.status(400).json({ error: "Missing playlist id" });
    const playlist = await youtube.getPlaylist(playlistId);
    if (!playlist.info?.id) return res.status(404).json({ error: "Playlist not found"});
    res.status(200).json(playlist);
  } catch (err) { 
    console.error('Error in /api/playlist:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/fvideo', async (req, res) => {
  try {
    const youtube = await Innertube.create({ lang: "ja", location: "JP" });
    const trending = await youtube.getTrending("Music");
    res.status(200).json(trending);
  } catch (err) { 
    console.error('Error in /api/fvideo:', err); 
    res.status(500).json({ error: err.message }); 
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
>>>>>>> 9d0bd4a99e8134961d0af8e3b97be65771962820
});
