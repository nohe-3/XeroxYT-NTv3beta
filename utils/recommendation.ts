
import type { Video, Channel } from '../types';
import { searchVideos, getVideoDetails, getChannelVideos, getRecommendedVideos } from './api';

// --- Constants & Types ---

// ニュース・政治・不快コンテンツのNGワード（ユーザー体験保護のため維持）
const NOISE_BLOCK_KEYWORDS = [
    'ニュース', 'News', '報道', '政治', '首相', '大統領', '内閣', 
    '事件', '事故', '逮捕', '裁判', '速報', '会見', '訃報', '地震', 
    '津波', '災害', '炎上', '物申す', '批判', '晒し', '閲覧注意',
    '衆院選', '参院選', '選挙', '与党', '野党', '政策',
    'NHK', '日テレ', 'FNN', 'TBS', 'ANN', 'テレ東'
];

// 多様性を確保するための10の固定カテゴリ
const DIVERSE_CATEGORIES = [
    '音楽', 'ゲーム実況', 'エンタメ', 'お笑い', 'ガジェット',
    'アニメ', 'スポーツ', 'ペット', '料理', 'Vlog'
];

interface RecommendationSource {
    searchHistory: string[];
    watchHistory: Video[];
    subscribedChannels: Channel[];
    preferredGenres: string[]; // ユーザーが明示的に指定したタグ
    preferredChannels: string[];
    ngKeywords: string[];
    ngChannels: string[];
    page: number;
}

// --- Helpers ---

const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

const containsJapanese = (text: string): boolean => {
    return /[一-龠]+|[ぁ-ゔ]+|[ァ-ヴー]+/.test(text);
};

// Duration parser (ISO to seconds)
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

// --- Main Validation Logic ---

const isValidRecommendation = (video: Video, source: RecommendationSource): boolean => {
    const lowerTitle = video.title.toLowerCase();
    const lowerChannel = video.channelName.toLowerCase();
    const fullText = `${lowerTitle} ${lowerChannel}`;

    // 1. Xerox Filter (アプリのブランド保護)
    if (fullText.includes('xerox') && video.channelId !== 'UCCMV3NfZk_NB-MmUvHj6aFw') {
        return false;
    }

    // 2. Noise/News Filter
    if (NOISE_BLOCK_KEYWORDS.some(word => fullText.includes(word.toLowerCase()))) {
        return false;
    }

    // 3. User Block Settings
    if (source.ngKeywords?.some(ng => fullText.includes(ng.toLowerCase()))) {
        return false;
    }
    if (source.ngChannels?.includes(video.channelId)) {
        return false;
    }

    // 4. Japanese Content Priority for Home Feed
    const isSubscribed = source.subscribedChannels.some(c => c.id === video.channelId);
    if (!isSubscribed && !containsJapanese(fullText) && !containsJapanese(video.descriptionSnippet || '')) {
        // 外国語コンテンツのフィルタリング（厳密にしすぎない）
    }

    return true;
};

// --- Core Recommendation Engine ---

/**
 * YouTubeの「関連動画」アルゴリズムを擬似的に再現しつつ、10の分野から多様なコンテンツを混ぜ込む。
 */
export const getDeeplyAnalyzedRecommendations = async (sources: RecommendationSource): Promise<Video[]> => {
    const { 
        watchHistory, 
        searchHistory, 
        subscribedChannels, 
        preferredGenres,
        page 
    } = sources;

    let candidates: Video[] = [];
    const promises: Promise<Video[]>[] = [];

    // ------------------------------------------------------------
    // Strategy 1: "Continue Watching" Context (関連動画ウォーク)
    // 直近で見た動画の「関連動画」を取得するが、数が多すぎると偏るので制限する
    // ------------------------------------------------------------
    if (watchHistory.length > 0) {
        const historyDepth = Math.min(watchHistory.length, 3); // 参照する履歴数を減らす
        const targetIndices = new Set<number>();
        
        targetIndices.add(0); 
        if (historyDepth > 1) targetIndices.add(Math.floor(Math.random() * historyDepth));
        
        targetIndices.forEach(index => {
            const video = watchHistory[index];
            if (video && video.id) {
                promises.push(
                    getVideoDetails(video.id)
                        .then(details => (details.relatedVideos || []).slice(0, 8)) // 1つの動画につき関連動画は8個まで
                        .catch(() => [])
                );
            }
        });
    }

    // ------------------------------------------------------------
    // Strategy 2: "Explicit Preferences" (タグ・登録チャンネル)
    // ------------------------------------------------------------
    if (preferredGenres.length > 0) {
        // ランダムに2つのジャンルをピックアップ
        const genres = shuffleArray(preferredGenres).slice(0, 2);
        genres.forEach(genre => {
            promises.push(
                searchVideos(genre, '1')
                    .then(res => res.videos.slice(0, 5))
                    .catch(() => [])
            );
        });
    }

    if (subscribedChannels.length > 0) {
        const randomSubs = shuffleArray(subscribedChannels).slice(0, 3);
        randomSubs.forEach(sub => {
            promises.push(
                getChannelVideos(sub.id)
                    .then(res => res.videos.slice(0, 4))
                    .catch(() => [])
            );
        });
    }

    // ------------------------------------------------------------
    // Strategy 3: "Forced Diversity" (10 Fields)
    // 特定のジャンル（ボカロなど）に偏らないよう、固定の10カテゴリからランダムに混ぜる
    // ------------------------------------------------------------
    // ページごとに異なるカテゴリを混ぜるため、シャッフルして数個選ぶ
    const diversityCount = 5; // 1回のロードで混ぜるカテゴリ数
    const selectedCategories = shuffleArray(DIVERSE_CATEGORIES).slice(0, diversityCount);
    
    selectedCategories.forEach(cat => {
        promises.push(
            searchVideos(cat, '1')
                .then(res => res.videos.slice(0, 5)) // 各カテゴリから5動画
                .catch(() => [])
        );
    });

    // ------------------------------------------------------------
    // Strategy 4: "General Popularity" (急上昇・フォールバック)
    // ------------------------------------------------------------
    if (watchHistory.length < 5 || page === 1) {
        promises.push(
            getRecommendedVideos()
                .then(res => res.videos.slice(0, 10))
                .catch(() => [])
        );
    }

    // 全リクエストの解決
    const results = await Promise.all(promises);
    results.forEach(videos => candidates.push(...videos));

    // ------------------------------------------------------------
    // Filtering & Deduplication
    // ------------------------------------------------------------
    const uniqueVideos: Video[] = [];
    const seenIds = new Set<string>();
    const recentHistoryIds = new Set(watchHistory.slice(0, 10).map(v => v.id));

    // シャッフルしてからフィルタリング
    candidates = shuffleArray(candidates);

    for (const video of candidates) {
        if (!video.id) continue;
        if (seenIds.has(video.id)) continue;
        if (recentHistoryIds.has(video.id)) continue;

        if (isValidRecommendation(video, sources)) {
            seenIds.add(video.id);
            uniqueVideos.push(video);
        }
    }

    return uniqueVideos;
};
