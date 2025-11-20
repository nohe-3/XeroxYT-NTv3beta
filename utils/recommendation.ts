
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
            score += 20;
        }
    });
    
    // Freshness
    if (source.preferredFreshness === 'new') {
         if (video.uploadedAt.includes('分前') || video.uploadedAt.includes('時間前') || video.uploadedAt.includes('日前')) {
            score += 10;
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
    
    // ページネーションが進むごとに少しランダム性を変えるシードとして使用可能
    
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
        { type: 'keywords', weight: 10 }, // 設定キーワード (10% - 要望により低減)
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
                // 直近だけでなく、過去50件からランダムに選ぶことで「忘れていた興味」を拾う
                if (watchHistory.length > 0 || searchHistory.length > 0) {
                    const useWatch = watchHistory.length > 0 && (searchHistory.length === 0 || Math.random() > 0.4);
                    if (useWatch) {
                        const randomVideo = watchHistory[Math.floor(Math.random() * Math.min(watchHistory.length, 50))];
                        const kws = extractKeywords(randomVideo.title);
                        if (kws.length > 0) {
                            queries.add(kws[Math.floor(Math.random() * kws.length)]);
                        } else {
                            queries.add(randomVideo.channelName); // キーワードなければチャンネル名
                        }
                    } else {
                        // 検索履歴
                        const randomSearch = searchHistory[Math.floor(Math.random() * Math.min(searchHistory.length, 20))];
                        if (randomSearch) queries.add(randomSearch);
                    }
                } else {
                    // 履歴がない場合はDiscoveryにフォールバック
                    queries.add('Japan trending');
                }
                break;

            case 'subs':
                // 登録チャンネルまたはその関連
                if (subscribedChannels.length > 0) {
                    const randomSub = subscribedChannels[Math.floor(Math.random() * subscribedChannels.length)];
                    // 単にチャンネル名で検索するだけでなく、"関連"を見つけるために少し曖昧にする
                    if (Math.random() > 0.5) {
                        queries.add(randomSub.name);
                    } else {
                        // チャンネル名 + 一般的な単語
                        queries.add(`${randomSub.name} 動画`);
                    }
                } else {
                     queries.add('New Music Video');
                }
                break;

            case 'keywords':
                // ユーザー設定キーワード (全体の10%程度に収まるように確率制御されている)
                if (preferredGenres.length > 0) {
                    const randomGenre = preferredGenres[Math.floor(Math.random() * preferredGenres.length)];
                    queries.add(randomGenre);
                } else if (preferredChannels.length > 0) {
                    const randomCh = preferredChannels[Math.floor(Math.random() * preferredChannels.length)];
                    queries.add(randomCh);
                } else {
                    queries.add('おすすめ');
                }
                break;

            case 'discovery':
            default:
                // ランダム・トレンド・広い単語
                const topics = ['Music', 'Gaming', 'Vlog', 'News', 'Cat', 'Cooking', 'Japan', 'Live', 'ASMR', 'Anime'];
                queries.add(topics[Math.floor(Math.random() * topics.length)]);
                break;
        }
    }

    // クエリが少なすぎる場合の保険
    if (queries.size < 3) {
        queries.add('Japan trending');
        queries.add('Live stream');
    }

    // ---------------------------------------------------------
    // 2. Fetching
    // ---------------------------------------------------------
    
    const fetchPromises: Promise<Video[]>[] = [];
    const uniqueQueries = Array.from(queries);

    // Search API Calls
    uniqueQueries.forEach(q => {
        // ページネーションをシミュレートするためにランダム性を少し加えるか、ページ番号を使う
        // 注: YouTubeiの検索はページネーションが厳密ではないため、クエリを少し変える工夫も有効
        fetchPromises.push(searchVideos(q).then(res => res.videos).catch(() => []));
    });
    
    // 初回ロード時のみ、おすすめ動画（トレンド）も少し混ぜる
    if (page === 1) {
        fetchPromises.push(getRecommendedVideos().then(res => res.videos).catch(() => []));
    }

    // 登録チャンネルの動画も直接取得して混ぜる (確実な関連性)
    if (subscribedChannels.length > 0) {
        const randomSub = subscribedChannels[Math.floor(Math.random() * subscribedChannels.length)];
        fetchPromises.push(
            getChannelVideos(randomSub.id).then(res => 
                res.videos.map(v => ({...v, channelName: randomSub.name, channelAvatarUrl: randomSub.avatarUrl, channelId: randomSub.id}))
            ).catch(() => [])
        );
    }

    const results = await Promise.allSettled(fetchPromises);
    
    let rawCandidates: Video[] = [];
    results.forEach(res => {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            rawCandidates.push(...res.value);
        }
    });

    // Deduplication
    const seenIds = new Set<string>();
    const uniqueCandidates: Video[] = [];
    
    // 自分（ユーザー）が最近見た動画は除外するオプション（既視感を減らす）
    const historyIds = new Set(watchHistory.slice(0, 50).map(v => v.id));

    for (const v of rawCandidates) {
        // 直近50件の履歴にある動画は、おすすめに出さない（新しい出会いを優先）
        if (!seenIds.has(v.id) && !historyIds.has(v.id)) {
            seenIds.add(v.id);
            uniqueCandidates.push(v);
        }
    }

    // ---------------------------------------------------------
    // 3. Filtering & Shuffling (No Sorting)
    // スコアは「弾く」ために使い、「並べる」ためには使わないことでランダム性を維持
    // ---------------------------------------------------------

    const validVideos = uniqueCandidates.filter(video => {
        const { isValid } = validateVideo(video, sources);
        return isValid;
    });

    // 完全にシャッフルする (Fisher-Yates Shuffle)
    // これにより、特定のキーワード（スコアが高いもの）が常に上に来るのを防ぐ
    const shuffledVideos = shuffleArray(validVideos);

    // 結果を返す
    return shuffledVideos.slice(0, 50);
};
