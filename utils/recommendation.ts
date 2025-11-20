
import type { Video, Channel } from '../types';
import { searchVideos, getChannelVideos, getRecommendedVideos } from './api';

// 文字列からハッシュタグや重要そうなキーワードを抽出する
const extractKeywords = (text: string): string[] => {
    if (!text) return [];
    const hashtags = text.match(/#[^\s#]+/g) || [];
    const brackets = text.match(/[\[【](.+?)[\]】]/g) || [];
    const rawText = text.replace(/[\[【].+?[\]】]/g, '').replace(/#[^\s#]+/g, '');
    // 記号を除去し、スペースで分割
    const words = rawText.replace(/[!-/:-@[-`{-~]/g, ' ').split(/\s+/);
    
    const cleanHashtags = hashtags.map(t => t.trim());
    const cleanBrackets = brackets.map(t => t.replace(/[\[【\]】]/g, '').trim());
    // 短すぎる単語やURL、一般的な接続詞などを除外する簡易フィルタ
    const cleanWords = words.filter(w => 
        w.length > 1 && 
        !/^(http|www|com|jp|youtube|video|movie|the|and|of|in|to|for|on|with|movie|動画|公式|ch|channel|チャンネル)/i.test(w)
    );
    
    // 重複排除して結合
    return Array.from(new Set([...cleanHashtags, ...cleanBrackets, ...cleanWords]));
};

const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

const parseDurationToSeconds = (isoDuration: string): number => {
    if (!isoDuration) return 0;
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
    const matches = isoDuration.match(regex);
    if (!matches) return 0;
    const h = parseInt(matches[1] || '0', 10);
    const m = parseInt(matches[2] || '0', 10);
    const s = parseInt(matches[3] || '0', 10);
    return h * 3600 + m * 60 + s;
};

export const containsJapanese = (text: string): boolean => {
    return /[一-龠]+|[ぁ-ゔ]+|[ァ-ヴー]+/.test(text);
}

interface RecommendationSource {
    searchHistory: string[];
    watchHistory: Video[];
    subscribedChannels: Channel[];
    preferredGenres: string[];
    preferredChannels: string[];
    preferredDurations?: string[];
    preferredFreshness?: string;
    discoveryMode?: string;
    ngKeywords?: string[];
    ngChannels?: string[];
    // Preferences
    prefDepth?: string;
    prefVocal?: string;
    prefEra?: string;
    prefRegion?: string;
    prefLive?: string;
    prefInfoEnt?: string;
    prefPacing?: string;
    prefVisual?: string;
    prefCommunity?: string;
    page: number;
}

// --- SCORING ENGINE (FILTERING ONLY) ---
// 並び替えのためではなく、ユーザー設定（NGや長さ）に合致しない動画を弾くためのフィルタとして機能させる
const validateVideo = (
    video: Video, 
    source: RecommendationSource
): { isValid: boolean; score: number; reasons: string[] } => {
    let score = 0;
    const reasons: string[] = [];
    const lowerTitle = video.title.toLowerCase();
    const lowerDesc = (video.descriptionSnippet || '').toLowerCase();
    const lowerChannel = video.channelName.toLowerCase();
    const fullText = `${lowerTitle} ${lowerDesc} ${lowerChannel}`;
    
    // 0. Xerox Specific Filter
    // "xerox"を含み、かつ指定のチャンネルIDではない場合除外
    if (fullText.includes('xerox') && video.channelId !== 'UCCMV3NfZk_NB-MmUvHj6aFw') {
        return { isValid: false, score: -9999, reasons: ['Keyword Exclusion: Xerox'] };
    }

    // 1. NG Filter (Instant Block)
    if (source.ngKeywords && source.ngKeywords.length > 0) {
        for (const ng of source.ngKeywords) {
            if (fullText.includes(ng.toLowerCase())) {
                return { isValid: false, score: -9999, reasons: [`NG Keyword: ${ng}`] };
            }
        }
    }
    if (source.ngChannels && source.ngChannels.includes(video.channelId)) {
        return { isValid: false, score: -9999, reasons: [`NG Channel: ${video.channelName}`] };
    }

    // 2. Duration Filter (Strict Block)
    // ユーザーが長さを指定している場合、一致しないものは除外する
    if (source.preferredDurations && source.preferredDurations.length > 0) {
        const sec = parseDurationToSeconds(video.isoDuration);
        let durationMatch = false;
        
        if (source.preferredDurations.includes('short') && sec > 0 && sec < 240) durationMatch = true;
        if (source.preferredDurations.includes('medium') && sec >= 240 && sec <= 1200) durationMatch = true;
        if (source.preferredDurations.includes('long') && sec > 1200) durationMatch = true;

        if (!durationMatch && sec > 0) {
            // 指定があるのに一致しない場合は無効化
            return { isValid: false, score: -500, reasons: ['Duration Mismatch'] };
        }
    }

    // 3. Context Scoring (Bonus Only)
    // ここでのスコアは「並び替え」には強く影響させず、「質」の担保に使う
    
    // History Relevance
    if (source.watchHistory.some(h => h.channelId === video.channelId)) {
        score += 10;
    }

    // Genre Match
    source.preferredGenres.forEach(genre => {
        if (fullText.includes(genre.toLowerCase())) {
            score += 40;
        }
    });
    
    // Freshness
    if (source.preferredFreshness === 'new') {
         if (video.uploadedAt.includes('分前') || video.uploadedAt.includes('時間前') || video.uploadedAt.includes('日前')) {
            score += 10;
        }
    }

    // Context Match
    if (source.searchHistory.length > 0) {
        // 簡易的なコンテキスト一致
        const recentSearches = source.searchHistory.slice(0, 5);
        if (recentSearches.some(s => fullText.includes(s.toLowerCase()))) {
             score += 30;
        }
    }

    return { isValid: true, score, reasons };
};


export const getDeeplyAnalyzedRecommendations = async (sources: RecommendationSource): Promise<Video[]> => {
    const { 
        searchHistory, watchHistory, subscribedChannels, 
        preferredGenres, preferredChannels, 
        page 
    } = sources;
    
    // ---------------------------------------------------------
    // 1. Query Generation (Weighted Random Strategy)
    // YouTubeのように多様なソースから確率的にクエリを選択し、バランスの良いフィードを作る
    // ---------------------------------------------------------
    
    const queries: Set<string> = new Set();
    
    // 取得するクエリの総数（APIリクエスト数に直結するため制限する）
    const TOTAL_QUERIES = 6;
    
    // ソース群の定義と重み付け
    // weight: 選択される確率の重み
    const querySources = [
        { type: 'history', weight: 50 }, // 履歴からの推測 (50%)
        { type: 'subs', weight: 30 },    // 登録チャンネル関連 (30%)
        { type: 'keywords', weight: 10 }, // 設定キーワード (10%)
        { type: 'discovery', weight: 10 } // 新規開拓 (10%)
    ];

    const getRandomSourceType = () => {
        const totalWeight = querySources.reduce((sum, s) => sum + s.weight, 0);
        let random = Math.random() * totalWeight;
        for (const source of querySources) {
            if (random < source.weight) return source.type;
            random -= source.weight;
        }
        return 'discovery';
    };

    // クエリ生成ループ
    for (let i = 0; i < TOTAL_QUERIES; i++) {
        const type = getRandomSourceType();

        switch (type) {
            case 'history':
                // 履歴からキーワードを抽出
                if (watchHistory.length > 0 || searchHistory.length > 0) {
                    const useWatch = watchHistory.length > 0 && (searchHistory.length === 0 || Math.random() > 0.4);
                    if (useWatch) {
                        const historyPoolSize = Math.min(watchHistory.length, 50);
                        const randomVideo = watchHistory[Math.floor(Math.random() * historyPoolSize)];
                        const kws = extractKeywords(randomVideo.title);
                        if (kws.length > 0) {
                            queries.add(kws[Math.floor(Math.random() * kws.length)]);
                        } else {
                            queries.add(randomVideo.channelName);
                        }
                    } else {
                        const searchPoolSize = Math.min(searchHistory.length, 20);
                        const randomSearch = searchHistory[Math.floor(Math.random() * searchPoolSize)];
                        if (randomSearch) queries.add(randomSearch);
                    }
                } else {
                    queries.add('New Trend');
                }
                break;
            
            case 'subs':
                if (subscribedChannels.length > 0) {
                    const randomChannel = subscribedChannels[Math.floor(Math.random() * subscribedChannels.length)];
                    queries.add(randomChannel.name);
                } else {
                     queries.add('Popular');
                }
                break;

            case 'keywords':
                 if (preferredGenres.length > 0) {
                     queries.add(preferredGenres[Math.floor(Math.random() * preferredGenres.length)]);
                 } else {
                     queries.add('Music');
                 }
                 break;

            case 'discovery':
            default:
                 const randomTopics = ['Music', 'Gaming', 'Vlog', 'Live', 'News', 'Tech', 'Art', 'Cat', 'Cooking'];
                 queries.add(randomTopics[Math.floor(Math.random() * randomTopics.length)]);
                 break;
        }
    }

    // If no queries generated (fresh user), add defaults
    if (queries.size === 0) {
        queries.add('Trending');
        queries.add('Japan');
    }

    // ---------------------------------------------------------
    // 2. Fetching & Merging
    // ---------------------------------------------------------
    const queryArray = Array.from(queries);
    const fetchPromises = queryArray.map(q => 
        searchVideos(q, page.toString())
        .then(res => res.videos)
        .catch(e => { console.warn(`Failed to fetch for query: ${q}`, e); return []; })
    );

    // 登録チャンネルの最新動画も少し混ぜる
    const subPromises = subscribedChannels.length > 0 
        ? shuffleArray(subscribedChannels).slice(0, 2).map(c => getChannelVideos(c.id).then(res => res.videos).catch(() => []))
        : [];

    const allResults = await Promise.all([...fetchPromises, ...subPromises]);
    const candidates = allResults.flat();
    
    // ---------------------------------------------------------
    // 3. Validation, Deduplication & Scoring
    // ---------------------------------------------------------
    const validVideos: Video[] = [];
    const seenIds = new Set<string>();
    
    for (const video of candidates) {
        if (seenIds.has(video.id)) continue;
        seenIds.add(video.id);

        const validation = validateVideo(video, sources);
        if (validation.isValid) {
            validVideos.push(video);
        }
    }

    // ---------------------------------------------------------
    // 4. Final Shuffle
    // スコアに基づく厳密なソートよりも、ランダム性を残して「飽き」を防ぐ
    // ---------------------------------------------------------
    return shuffleArray(validVideos);
};
