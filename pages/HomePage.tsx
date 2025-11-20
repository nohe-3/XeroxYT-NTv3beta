
import React, { useState, useEffect, useCallback } from 'react';
import VideoGrid from '../components/VideoGrid';
import { getRecommendedVideos } from '../utils/api';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useSearchHistory } from '../contexts/SearchHistoryContext';
import { useHistory } from '../contexts/HistoryContext';
import { usePreference } from '../contexts/PreferenceContext';
import { getDeeplyAnalyzedRecommendations } from '../utils/recommendation';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import type { Video } from '../types';

const HomePage: React.FC = () => {
    const [recommendedVideos, setRecommendedVideos] = useState<Video[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    const { subscribedChannels } = useSubscription();
    const { searchHistory } = useSearchHistory();
    const { history: watchHistory } = useHistory();
    const { preferredGenres, preferredChannels } = usePreference();

    const loadRecommendations = useCallback(async (pageNum: number) => {
        const isInitial = pageNum === 1;
        if (isInitial) {
            setIsLoading(true);
        } else {
            setIsFetchingMore(true);
        }
        
        try {
            let newVideos: Video[] = [];

            // 深い分析に基づくレコメンデーションを取得
            // ページ番号を渡すことで、異なる履歴や好みをローテーションして使用する
            const analyzedVideos = await getDeeplyAnalyzedRecommendations({
                searchHistory,
                watchHistory,
                subscribedChannels,
                preferredGenres,
                preferredChannels,
                page: pageNum
            });

            newVideos = [...analyzedVideos];

            // フォールバック: 急上昇動画 (ページ1のみ、または結果が少ない場合)
            // エラーが出ても無視して、可能な限り分析結果を表示する
            if (newVideos.length < 10 && isInitial) {
                try {
                    const { videos: trendingVideos } = await getRecommendedVideos();
                    newVideos = [...newVideos, ...trendingVideos];
                } catch (trendingError) {
                    console.warn("Failed to load trending videos", trendingError);
                }
            }
            
            // IDでの重複排除（既存の動画とも比較）
            setRecommendedVideos(prev => {
                const existingIds = new Set(prev.map(v => v.id));
                const uniqueNewVideos = newVideos.filter(v => !existingIds.has(v.id));
                
                // 既存の動画 + 新しい動画
                return isInitial ? uniqueNewVideos : [...prev, ...uniqueNewVideos];
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

    // 初期ロード (依存配列が変わった時のみリセット)
    useEffect(() => {
        setPage(1);
        setRecommendedVideos([]);
        setError(null);
        loadRecommendations(1);
    }, [preferredGenres, preferredChannels]); // 好みが変わったらリロード

    const loadMore = () => {
        if (!isFetchingMore && !isLoading) {
            const nextPage = page + 1;
            setPage(nextPage);
            loadRecommendations(nextPage);
        }
    };

    const lastElementRef = useInfiniteScroll(loadMore, true, isFetchingMore || isLoading);

    // データがない場合（エラー時含む）は、ユーザーガイドを表示する
    if (recommendedVideos.length === 0 && !isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4 animate-fade-in">
                <div className="mb-6 text-6xl">📺</div>
                <h2 className="text-2xl font-bold mb-3 text-black dark:text-white">動画を視聴して、おすすめをカスタマイズ</h2>
                <p className="text-yt-light-gray text-base max-w-lg mb-8 leading-relaxed">
                    まだおすすめできる動画がありません。<br />
                    検索バーから興味のある動画を探して視聴したり、チャンネル登録をすると、<br />
                    ここにパーソナライズされた動画が表示されます。
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <VideoGrid videos={recommendedVideos} isLoading={isLoading} />
            
            {/* Infinite Scroll Sentinel */}
            {!isLoading && recommendedVideos.length > 0 && (
                <div ref={lastElementRef} className="h-20 flex justify-center items-center">
                    {isFetchingMore && <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-yt-blue"></div>}
                </div>
            )}
        </div>
    );
};

export default HomePage;
