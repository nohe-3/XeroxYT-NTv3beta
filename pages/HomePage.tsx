
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import VideoGrid from '../components/VideoGrid';
import ShortsShelf from '../components/ShortsShelf';
import { getRecommendedVideos } from '../utils/api';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useSearchHistory } from '../contexts/SearchHistoryContext';
import { useHistory } from '../contexts/HistoryContext';
import { usePreference } from '../contexts/PreferenceContext';
import { getDeeplyAnalyzedRecommendations, containsJapanese } from '../utils/recommendation';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type { Video } from '../types';
import { SearchIcon, SaveIcon, DownloadIcon } from '../components/icons/Icons';

// Helper to parse duration string to seconds
const parseDuration = (iso: string, text: string): number => {
    if (iso) {
        const matches = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (matches) {
            const h = parseInt(matches[1] || '0', 10);
            const m = parseInt(matches[2] || '0', 10);
            const s = parseInt(matches[3] || '0', 10);
            return h * 3600 + m * 60 + s;
        }
    }
    if (text) {
         const parts = text.split(':').map(p => parseInt(p, 10));
         if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
         if (parts.length === 2) return parts[0] * 60 + parts[1];
         if (parts.length === 1) return parts[0];
    }
    return 0;
}

// セクション（ページごとのコンテンツ塊）の型定義
interface HomeSection {
    page: number;
    videos: Video[];
    shorts: Video[];
}

const HomePage: React.FC = () => {
    // 単一のリストではなく、ページごとのセクションとして管理する
    const [sections, setSections] = useState<HomeSection[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    // 重複排除用：これまでに表示した全動画IDを保持するRef
    const seenIdsRef = useRef<Set<string>>(new Set());

    const { subscribedChannels } = useSubscription();
    const { searchHistory } = useSearchHistory();
    const { history: watchHistory } = useHistory();
    const { preferredGenres, preferredChannels, exportUserData, importUserData } = usePreference();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ユーザーが「新規（データなし）」かどうかを判定
    const isNewUser = useMemo(() => {
        // デフォルトで1つのチャンネル(Xerox)が登録されているため、1より大きい場合を「ユーザーが登録した」とみなす
        const hasSubscriptions = subscribedChannels.length > 1;
        const hasSearchHistory = searchHistory.length > 0;
        const hasWatchHistory = watchHistory.length > 0;
        const hasPreferences = preferredGenres.length > 0 || preferredChannels.length > 0;

        return !(hasSubscriptions || hasSearchHistory || hasWatchHistory || hasPreferences);
    }, [subscribedChannels, searchHistory, watchHistory, preferredGenres, preferredChannels]);

    const loadRecommendations = useCallback(async (pageNum: number) => {
        const isInitial = pageNum === 1;
        if (isInitial) {
            setIsLoading(true);
        } else {
            setIsFetchingMore(true);
        }
        
        try {
            let fetchedVideos: Video[] = [];

            // 深い分析に基づくレコメンデーションを取得
            const analyzedVideos = await getDeeplyAnalyzedRecommendations({
                searchHistory,
                watchHistory,
                subscribedChannels,
                preferredGenres,
                preferredChannels,
                page: pageNum
            });

            // 重複チェック：Refを使ってこれまでに表示されたIDと照合
            const uniqueNewVideos: Video[] = [];
            for (const v of analyzedVideos) {
                if (!seenIdsRef.current.has(v.id)) {
                    seenIdsRef.current.add(v.id);
                    uniqueNewVideos.push(v);
                }
            }
            fetchedVideos = [...uniqueNewVideos];

            // フォールバック: 分析結果が少ない場合のみ急上昇を取得（初回のみ）
            if (fetchedVideos.length < 10 && isInitial) {
                try {
                    const { videos: trendingVideos } = await getRecommendedVideos();
                    const uniqueTrending = trendingVideos.filter(v => !seenIdsRef.current.has(v.id));
                    uniqueTrending.forEach(v => seenIdsRef.current.add(v.id));
                    fetchedVideos = [...fetchedVideos, ...uniqueTrending];
                } catch (trendingError) {
                    console.warn("Failed to load trending videos", trendingError);
                }
            }
            
            // Separate Shorts (<= 60s or #shorts or vertical) vs Regular Videos
            const nextVideos: Video[] = [];
            const nextShorts: Video[] = [];

            fetchedVideos.forEach(v => {
                const seconds = parseDuration(v.isoDuration, v.duration);
                // Consider Short if <= 60s OR contains #shorts. 
                // Note: We assume short duration or explicit tag means it fits "Shorts/Vertical" category request.
                const isShort = (seconds > 0 && seconds <= 60) || v.title.toLowerCase().includes('#shorts');

                if (isShort) {
                    // Shorts Shelf Filter: Must contain Japanese text to filter out overseas videos
                    // 日本語のタイトル、説明、またはチャンネル名が含まれている場合のみショート棚に追加
                    const hasJapanese = containsJapanese(v.title) || containsJapanese(v.descriptionSnippet || '') || containsJapanese(v.channelName);
                    if (hasJapanese) {
                        nextShorts.push(v);
                    }
                } else {
                    nextVideos.push(v);
                }
            });

            // セクションとして追加
            setSections(prev => {
                const newSection: HomeSection = {
                    page: pageNum,
                    videos: nextVideos,
                    shorts: nextShorts
                };
                return isInitial ? [newSection] : [...prev, newSection];
            });

        } catch (err: any) {
            if (isInitial) {
                setError(err.message || '動画の読み込みに失敗しました。');
            }
            console.error(err);
        } finally {
            setIsLoading(false);
            setIsFetchingMore(false);
        }
    }, [subscribedChannels, searchHistory, watchHistory, preferredGenres, preferredChannels]);

    useEffect(() => {
        setPage(1);
        setSections([]);
        seenIdsRef.current.clear(); // リセット時に重複チェック用セットもクリア
        setError(null);
        
        // データが何もない新規ユーザーの場合は、APIリクエストを行わずにガイドを表示する
        if (isNewUser) {
            setIsLoading(false);
        } else {
            loadRecommendations(1);
        }
    }, [isNewUser, preferredGenres, preferredChannels]);

    const loadMore = () => {
        if (!isFetchingMore && !isLoading && !isNewUser) {
            const nextPage = page + 1;
            setPage(nextPage);
            loadRecommendations(nextPage);
        }
    };

    const lastElementRef = useInfiniteScroll(loadMore, true, isFetchingMore || isLoading);

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await importUserData(file);
        }
    };

    // コンテンツがあるかどうか
    const hasContent = sections.some(s => s.videos.length > 0 || s.shorts.length > 0);

    // 新規ユーザー、または動画がない場合のガイド表示
    if ((isNewUser || (!hasContent && !isLoading))) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 animate-fade-in">
                <div className="bg-yt-light dark:bg-yt-spec-10 p-6 rounded-full mb-6">
                    <SearchIcon />
                </div>
                <h2 className="text-2xl font-bold mb-4 text-black dark:text-white">まずは動画を探してみましょう</h2>
                <p className="text-yt-light-gray text-base max-w-lg mb-8 leading-relaxed">
                    検索してチャンネル登録したり、動画を閲覧すると、<br />
                    ここにあなたへのおすすめ動画が表示されるようになります。<br />
                    <br />
                    上の検索バーから、好きなキーワードで検索してみてください！
                </p>

                <div className="flex gap-4">
                    <button 
                        onClick={exportUserData}
                        className="flex items-center gap-2 px-4 py-2 bg-yt-light dark:bg-yt-spec-10 rounded-lg hover:bg-gray-200 dark:hover:bg-yt-spec-20 transition-colors text-sm font-medium"
                    >
                        <DownloadIcon />
                        設定をエクスポート
                    </button>
                    <button 
                        onClick={handleImportClick}
                        className="flex items-center gap-2 px-4 py-2 bg-yt-light dark:bg-yt-spec-10 rounded-lg hover:bg-gray-200 dark:hover:bg-yt-spec-20 transition-colors text-sm font-medium"
                    >
                        <SaveIcon />
                        データを復元 (インポート)
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept=".json" 
                        onChange={handleFileChange} 
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-10">
            {error && <div className="text-red-500 text-center mb-4">{error}</div>}
            
            {sections.map((section, index) => (
                <div key={section.page} className="animate-fade-in">
                    {/* 2ページ目以降の区切り線 */}
                    {index > 0 && (
                        <div className="py-4">
                            <hr className="border-yt-spec-light-20 dark:border-yt-spec-20" />
                        </div>
                    )}

                    {/* ショート動画の棚 (各ページの先頭に表示) */}
                    {section.shorts.length > 0 && (
                        <div className="mb-6">
                            <ShortsShelf shorts={section.shorts} isLoading={false} />
                            {/* ショートと動画の間の区切り（ページ内の区切り） */}
                            {section.videos.length > 0 && (
                                <hr className="border-yt-spec-light-20 dark:border-yt-spec-20 mt-6 mb-6" />
                            )}
                        </div>
                    )}

                    {/* 動画グリッド */}
                    <VideoGrid videos={section.videos} isLoading={false} />
                </div>
            ))}
            
            {/* ローディングインジケータ */}
            {(isLoading || isFetchingMore) && (
                <div className="flex flex-col gap-6 animate-pulse mt-4">
                     {/* Loading Skeleton for new page */}
                    <div className="mb-6">
                         <div className="h-8 w-32 bg-yt-light dark:bg-yt-dark-gray rounded mb-4"></div>
                         <div className="flex gap-4 overflow-hidden">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="w-44 h-80 bg-yt-light dark:bg-yt-dark-gray rounded-xl flex-shrink-0"></div>
                            ))}
                         </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8">
                        {Array.from({ length: 10 }).map((_, index) => (
                            <div key={index} className="flex flex-col">
                                <div className="w-full aspect-video bg-yt-light dark:bg-yt-dark-gray rounded-xl mb-3"></div>
                                <div className="flex gap-3">
                                    <div className="w-9 h-9 rounded-full bg-yt-light dark:bg-yt-dark-gray"></div>
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 bg-yt-light dark:bg-yt-dark-gray rounded w-3/4"></div>
                                        <div className="h-4 bg-yt-light dark:bg-yt-dark-gray rounded w-1/2"></div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 無限スクロールの検知用要素 */}
            {!isLoading && hasContent && (
                <div ref={lastElementRef} className="h-20 flex justify-center items-center" />
            )}
        </div>
    );
};

export default HomePage;
