import { execFile } from 'child_process';
import path from 'path';
import process from 'process';

const ytdlpPath = path.resolve(process.cwd(), 'yt-dlp_linux');
const PROXY_URL = "http://ytproxy-siawaseok.duckdns.org:3007";

export default function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { videoId } = req.query;
  if (!videoId) {
    return res.status(400).json({ error: '有効なVideo IDを指定してください。' });
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Note: Vercel timeout is short (10s for hobby), using dump-json is usually fast enough.
  const args = ['--proxy', PROXY_URL, '--dump-json', youtubeUrl];

  execFile(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      console.error("yt-dlp stderr:", stderr);
      return res.status(500).json({ error: "動画情報の取得に失敗しました。", details: stderr });
    }

    try {
      const info = JSON.parse(stdout);

      // 1. 映像+音声が結合済みのMP4形式を抽出 (Combined)
      const combinedFormats = info.formats.filter(f =>
        f.vcodec !== 'none' && f.acodec !== 'none' && f.ext === 'mp4' &&
        (f.protocol === 'https' || f.protocol === 'http')
      );

      // 2. 品質でソート
      combinedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      
      // 3. ストリーミングURL: ソート済みリストの先頭
      const streamingFormat = combinedFormats[0];

      // 4. 音声のみ (m4a優先)
      const audioOnlyFormats = info.formats.filter(f =>
        f.vcodec === 'none' && f.acodec !== 'none' &&
        (f.protocol === 'https' || f.protocol === 'http')
      );
      audioOnlyFormats.sort((a,b) => (b.abr || 0) - (a.abr || 0));
      const bestAudio = audioOnlyFormats.find(f => f.ext === 'm4a') || audioOnlyFormats[0];

      // 5. 1080p (映像のみ)
      const video1080pFormat = info.formats.find(f =>
        f.height === 1080 && f.vcodec !== 'none' && f.acodec === 'none' && f.ext === 'mp4' &&
        (f.protocol === 'https' || f.protocol === 'http')
      );

      res.status(200).json({
        streamingUrl: streamingFormat ? streamingFormat.url : null,
        streamType: 'mp4',
        combinedFormats: combinedFormats.map(f => ({
          quality: f.format_note || `${f.height}p`, 
          container: f.ext, 
          url: f.url
        })),
        audioOnlyFormat: bestAudio ? {
          quality: `${Math.round(bestAudio.abr || 0)}kbps`, 
          container: bestAudio.ext, 
          url: bestAudio.url
        } : null,
        separate1080p: video1080pFormat ? {
          video: { quality: '1080p (映像のみ)', container: 'mp4', url: video1080pFormat.url },
          audio: bestAudio ? { quality: `${Math.round(bestAudio.abr || 0)}kbps (音声のみ)`, container: bestAudio.ext, url: bestAudio.url } : null
        } : null
      });

    } catch (parseError) {
      console.error("yt-dlp JSON parse error:", parseError);
      res.status(500).json({ error: "データの解析に失敗しました。", details: parseError.message });
    }
  });
}