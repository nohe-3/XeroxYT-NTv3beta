
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
            if (newVideos.length < 10 && isInitial) {
                const { videos: trendingVideos } = await getRecommendedVideos();
                newVideos = [...newVideos, ...trendingVideos];
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

    if (error) {
        return <div className="text-center text-red-500 bg-red-100 dark:bg-red-900/50 p-4 rounded-lg">{error}</div>;
    }

    return (
        <div className="space-y-8">
            <VideoGrid videos={recommendedVideos} isLoading={isLoading} />
            
            {/* Infinite Scroll Sentinel */}
            {!isLoading && <div ref={lastElementRef} className="h-20 flex justify-center items-center">
                {isFetchingMore && <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-yt-blue"></div>}
            </div>}
        </div>
    );
};

export default HomePage;
