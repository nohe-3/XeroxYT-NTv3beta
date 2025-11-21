
import type { Video, Channel } from '../types';

// --- Types ---

interface UserProfile {
  keywords: Map<string, number>;
}

interface UserSources {
  watchHistory: Video[];
  searchHistory: string[];
  subscribedChannels: Channel[];
}

interface ScoringContext {
  ngKeywords: string[];
  ngChannels: string[];
  watchHistory: Video[];
}

// --- Keyword Extraction (Improved Version) ---

const JAPANESE_STOP_WORDS = new Set([
  'の', 'に', 'は', 'を', 'が', 'で', 'です', 'ます', 'こと', 'もの', 'これ', 'それ', 'あれ',
  'いる', 'する', 'ある', 'ない', 'から', 'まで', 'と', 'も', 'や', 'など', 'さん', 'ちゃん',
  'about', 'and', 'the', 'to', 'a', 'of', 'in', 'for', 'on', 'with', 'as', 'at'
]);

// Fix: Explicitly cast Intl to any to allow access to Segmenter which may not be in all TS lib definitions
const segmenter = (typeof Intl !== 'undefined' && (Intl as any).Segmenter) 
    ? new (Intl as any).Segmenter('ja', { granularity: 'word' }) 
    : null;

const extractKeywords = (text: string): string[] => {
  if (!text) return [];
  const cleanedText = text.toLowerCase();
  
  let words: string[] = [];

  if (segmenter) {
      // Use Intl.Segmenter for proper Japanese tokenization
      const segments = segmenter.segment(cleanedText);
      for (const segment of segments) {
          if (segment.isWordLike) {
              words.push(segment.segment);
          }
      }
  } else {
      // Fallback: Simple split by whitespace and punctuation
      words = cleanedText
        .replace(/[\p{S}\p{P}\p{Z}\p{C}]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0);
  }

  const keywords = words.filter(word => {
    if (word.length <= 1 && !/^[a-zA-Z0-9]$/.test(word)) return false; // Ignore single chars mostly
    if (JAPANESE_STOP_WORDS.has(word)) return false;
    if (/^\d+$/.test(word)) return false; // Ignore pure numbers
    return true;
  });

  return Array.from(new Set(keywords));
};

// --- User Profile Builder ---

export const buildUserProfile = (sources: UserSources): UserProfile => {
  const keywords = new Map<string, number>();

  const addKeywords = (text: string, weight: number) => {
    extractKeywords(text).forEach(kw => {
      keywords.set(kw, (keywords.get(kw) || 0) + weight);
    });
  };

  // 1. Search History: High intent, strong weight
  // Decay: Newer searches are much more relevant
  sources.searchHistory.slice(0, 20).forEach((term, index) => {
    const weight = 5.0 * Math.exp(-index / 5); 
    addKeywords(term, weight);
  });

  // 2. Watch History: Implicit interest
  // Decay: Recent watches define current session context
  sources.watchHistory.slice(0, 50).forEach((video, index) => {
    const weight = 3.0 * Math.exp(-index / 10);
    addKeywords(video.title, weight);
    addKeywords(video.channelName, weight * 1.2); // Channel affinity
  });

  // 3. Subscriptions: Long-term interest
  sources.subscribedChannels.forEach(channel => {
    addKeywords(channel.name, 2.0);
  });
  
  return { keywords };
};

// --- Scoring and Ranking ---

const parseUploadedAt = (uploadedAt: string): number => {
    if (!uploadedAt) return 999;
    const text = uploadedAt.toLowerCase();
    const numMatch = text.match(/(\d+)/);
    const num = numMatch ? parseInt(numMatch[1], 10) : 0;

    if (text.includes('分前') || text.includes('minutes ago')) return 0;
    if (text.includes('時間前') || text.includes('hours ago')) return 0;
    if (text.includes('日前') || text.includes('days ago')) return num;
    if (text.includes('週間前') || text.includes('weeks ago')) return num * 7;
    if (text.includes('か月前') || text.includes('months ago')) return num * 30;
    if (text.includes('年前') || text.includes('years ago')) return num * 365;
    return 999; 
};

const parseViews = (viewsStr: string): number => {
    if (!viewsStr) return 0;
    let mult = 1;
    if (viewsStr.includes('万')) mult = 10000;
    else if (viewsStr.includes('億')) mult = 100000000;
    else if (viewsStr.toUpperCase().includes('K')) mult = 1000;
    else if (viewsStr.toUpperCase().includes('M')) mult = 1000000;
    else if (viewsStr.toUpperCase().includes('B')) mult = 1000000000;

    const numMatch = viewsStr.match(/(\d+(\.\d+)?)/);
    if (!numMatch) return 0;
    return parseFloat(numMatch[1]) * mult;
}

export const rankVideos = (
  videos: Video[],
  userProfile: UserProfile,
  context: ScoringContext
): Video[] => {
  const scoredVideos: { video: Video; score: number }[] = [];
  const seenIds = new Set<string>(context.watchHistory.map(v => v.id));

  for (const video of videos) {
    if (!video || !video.id) continue;
    
    // Negative Filtering
    const fullText = `${video.title} ${video.channelName} ${video.descriptionSnippet || ''}`.toLowerCase();
    if (context.ngKeywords.some(ng => fullText.includes(ng.toLowerCase()))) continue;
    if (context.ngChannels.includes(video.channelId)) continue;
    
    // Penalty for already watched videos (diminishing return)
    let historyPenalty = 1.0;
    if (seenIds.has(video.id)) {
        historyPenalty = 0.1; 
    }

    // 1. Relevance Score (Keyword Match)
    let relevanceScore = 0;
    const videoKeywords = new Set(extractKeywords(fullText));
    videoKeywords.forEach(kw => {
      if (userProfile.keywords.has(kw)) {
        relevanceScore += userProfile.keywords.get(kw)!;
      }
    });

    // 2. Popularity Score (Log scale)
    const views = parseViews(video.views);
    const popularityScore = Math.log10(views + 1); 

    // 3. Freshness Score
    const daysAgo = parseUploadedAt(video.uploadedAt);
    let freshnessScore = 0;
    if (daysAgo <= 3) freshnessScore = 5;
    else freshnessScore = Math.max(0, 4 - Math.log2(daysAgo)); 

    // 4. Random Jitter (Entropy/Randomness)
    // Adds +/- 20% random factor to ensure the feed isn't static
    const randomJitter = (Math.random() - 0.5) * 0.4; 

    const baseScore = (
        (relevanceScore * 2.5) + 
        (popularityScore * 0.5) + 
        (freshnessScore * 1.0)
    ) * historyPenalty;

    // Apply Jitter
    const finalScore = baseScore * (1 + randomJitter);
    
    scoredVideos.push({ video, score: finalScore });
  }

  // Sort by score descending
  scoredVideos.sort((a, b) => b.score - a.score);

  // 6. Diversity Filter (Limit videos from same channel)
  const finalRankedList: Video[] = [];
  const channelCount = new Map<string, number>();
  const MAX_FROM_SAME_CHANNEL = 4; 

  for (const { video } of scoredVideos) {
    const count = channelCount.get(video.channelId) || 0;
    if (count < MAX_FROM_SAME_CHANNEL) {
      finalRankedList.push(video);
      channelCount.set(video.channelId, count + 1);
    }
  }

  return finalRankedList;
};
