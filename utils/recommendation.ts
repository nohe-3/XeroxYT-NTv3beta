
import type { Video, Channel } from '../types';
import { searchVideos, getChannelVideos } from './api';

// 文字列からハッシュタグや重要そうなキーワードを抽出する
const extractKeywords = (text: string): string[] => {
    if (!text) return [];
    // ハッシュタグを抽出
    const hashtags = text.match(/#[^\s#]+/g) || [];
    // 日本語や英語の名詞っぽいものを簡易的に抽出（厳密な形態素解析は重いため簡易実装）
    // 括弧内のテキストなどを重視
    const brackets = text.match(/[\[【](.+?)[\]】]/g) || [];
    
    // クリーンアップ
    const cleanHashtags = hashtags.map(t => t.trim());
    const cleanBrackets = brackets.map(t => t.replace(/[\[【\]】]/g, '').trim());
    
    return [...cleanHashtags, ...cleanBrackets];
};

// 配列をシャッフルする
const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

interface RecommendationSource {
    searchHistory: string[];
    watchHistory: Video[];
    subscribedChannels: Channel[];
    preferredGenres: string[];
    preferredChannels: string[];
    page: number;
}

export const getDeeplyAnalyzedRecommendations = async (sources: RecommendationSource): Promise<Video[]> => {
    const { searchHistory, watchHistory, subscribedChannels, preferredGenres, preferredChannels, page } = sources;
    
    const queries: string[] = [];
    
    // 1. ユーザーの明示的な好み (PreferenceContext)
    if (preferredGenres.length > 0) {
        const genreIndex = (page - 1) % preferredGenres.length;
        queries.push(preferredGenres[genreIndex]);
        // ランダムにもう1つ
        queries.push(preferredGenres[Math.floor(Math.random() * preferredGenres.length)]);
    }

    if (preferredChannels.length > 0) {
        const channelName = preferredChannels[(page - 1) % preferredChannels.length];
        queries.push(`${channelName} new`); // 新着を探す
    }

    // 2. 視聴履歴からの深い分析 (WatchHistory)
    // 最近見た動画のタイトルや説明からキーワードを抽出して検索
    if (watchHistory.length > 0) {
        // ページ番号に応じて履歴を遡る
        const historyIndex = (page - 1) % Math.min(watchHistory.length, 10);
        const targetVideo = watchHistory[historyIndex];
        if (targetVideo) {
            const keywords = extractKeywords(targetVideo.title + ' ' + (targetVideo.descriptionSnippet || ''));
            if (keywords.length > 0) {
                // キーワードを組み合わせて検索 (例: "#Gaming" + "Minecraft")
                queries.push(keywords.slice(0, 2).join(' '));
            } else {
                // キーワードがなければタイトルそのもので検索（ノイズ除去）
                queries.push(targetVideo.title.replace(/[^a-zA-Z0-9\s\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/g, ''));
            }
        }
    }

    // 3. 検索履歴 (SearchHistory)
    if (searchHistory.length > 0) {
        const searchIndex = (page - 1) % Math.min(searchHistory.length, 10);
        queries.push(searchHistory[searchIndex]);
    }

    // 4. 登録チャンネル (Subscriptions)
    // ランダムではなく、ページごとにローテーションして網羅する
    const subPromises: Promise<any>[] = [];
    if (subscribedChannels.length > 0) {
        const subIndex = (page - 1) % subscribedChannels.length;
        const subChannel = subscribedChannels[subIndex];
        
        // チャンネルの最新動画を取得
        subPromises.push(
            getChannelVideos(subChannel.id).then(res => 
                res.videos.slice(0, 3).map(v => ({
                    ...v,
                    channelName: subChannel.name,
                    channelAvatarUrl: subChannel.avatarUrl,
                    channelId: subChannel.id
                }))
            ).catch(() => [])
        );
    }

    // クエリ実行
    const searchPromises = queries.map(q => 
        searchVideos(q).then(res => res.videos.slice(0, 5)).catch(() => [])
    );

    const results = await Promise.allSettled([...searchPromises, ...subPromises]);
    
    let combinedVideos: Video[] = [];
    results.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            combinedVideos.push(...result.value);
        }
    });

    // 重複排除
    const uniqueVideos = Array.from(new Map(combinedVideos.map(v => [v.id, v])).values());
    
    // ショート動画の簡易フィルタリング (60秒以下は除外、ただし検索結果が少ない場合は許容)
    let filteredVideos = uniqueVideos;
    if (uniqueVideos.length > 10) {
        filteredVideos = uniqueVideos.filter(v => {
             // ISO duration parser
             const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
             const matches = v.isoDuration.match(regex);
             if (!matches) return true;
             const h = parseInt(matches[1] || '0', 10);
             const m = parseInt(matches[2] || '0', 10);
             const s = parseInt(matches[3] || '0', 10);
             const seconds = h * 3600 + m * 60 + s;
             return seconds > 60;
        });
    }

    return shuffleArray(filteredVideos);
};
