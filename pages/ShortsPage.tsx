import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import ShortsPlayer from '../components/ShortsPlayer';
import { getPlayerConfig, getComments, parseDuration, getChannelShorts, getVideoDetails } from '../utils/api';
import { getXraiShorts } from '../utils/recommendation';
import type { Video, Comment } from '../types';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useSearchHistory } from '../contexts/SearchHistoryContext';
import { useHistory } from '../contexts/HistoryContext';
import { usePreference } from '../contexts/PreferenceContext';
import { LikeIcon, CommentIcon, CloseIcon, BlockIcon, TrashIcon } from '../components/icons/Icons';
import CommentComponent from '../components/Comment';
import { useTheme } from '../hooks/useTheme';

// Re-created Chevron Icons for better visibility
const ChevronUpIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" className="fill-current text-black dark:text-white w-8 h-8">
        <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
    </svg>
);

const ChevronDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" className="fill-current text-black dark:text-white w-8 h-8">
        <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
    </svg>
);

const ShortsPage: React.FC = () => {
    const { videoId } = useParams<{ videoId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const context = location.state?.context as { type: 'channel' | 'home' | 'search', channelId?: string } | undefined;

    const [videos, setVideos] = useState<Video[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [playerParams, setPlayerParams] = useState<string | null>(null);
    const [showComments, setShowComments] = useState(false);
    const [comments, setComments] = useState<Comment[]>([]);
    const [areCommentsLoading, setAreCommentsLoading] = useState(false);

    const { theme } = useTheme();
    const { subscribedChannels } = useSubscription();
    const { searchHistory } = useSearchHistory();
    const { history: watchHistory, shortsHistory, addShortToHistory } = useHistory();
    const { ngKeywords, ngChannels, hiddenVideos, negativeKeywords, addHiddenVideo, addNgChannel } = usePreference();
    
    const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
    
    // Keep track of ALL fetched IDs to prevent duplicates strictly
    const seenVideoIdsRef = useRef<Set<string>>(new Set());

    // --- Pre-loading Logic ---
    // Only mount current video and the NEXT video.
    // CSS display:none hides the next video but keeps it loaded in DOM.
    // When user swipes, we just toggle visibility.
    const getVisibleIndices = () => {
        return [currentIndex, currentIndex + 1];
    };

    const postPlayCommand = useCallback((index: number) => {
        const video = videos[index];
        if (!video) return;
        const iframe = iframeRefs.current.get(video.id);
        
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(
                '{"event":"command","func":"playVideo","args":""}',
                'https://www.youtubeeducation.com'
            );
        }
    }, [videos]);

    const postPauseCommand = useCallback((index: number) => {
        const video = videos[index];
        if (!video) return;
        const iframe = iframeRefs.current.get(video.id);

        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(
                '{"event":"command","func":"pauseVideo","args":""}',
                'https://www.youtubeeducation.com'
            );
        }
    }, [videos]);

    const fetchMoreShorts = useCallback(async () => {
        if (isFetchingMore) return;
        setIsFetchingMore(true);
        try {
            if (!context || context.type !== 'channel') {
                // Pass all currently known IDs to the recommender to exclude them
                const currentSeenIds = Array.from(seenVideoIdsRef.current) as string[];
                
                const shorts = await getXraiShorts({ 
                    searchHistory, watchHistory, shortsHistory, subscribedChannels, 
                    ngKeywords, ngChannels, hiddenVideos, negativeKeywords, 
                    page: Math.floor(videos.length / 20) + 1,
                    seenIds: currentSeenIds
                });
                
                setVideos(prev => {
                    // Double check duplicates just in case
                    const newUniqueShorts = shorts.filter(s => !seenVideoIdsRef.current.has(s.id));
                    newUniqueShorts.forEach(s => seenVideoIdsRef.current.add(s.id));
                    return [...prev, ...newUniqueShorts];
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsFetchingMore(false);
        }
    }, [isFetchingMore, context, videos.length, searchHistory, watchHistory, shortsHistory, subscribedChannels, ngKeywords, ngChannels, hiddenVideos, negativeKeywords]);

    // Initial Data Fetch Logic
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            setError(null);
            
            try {
                const params = await getPlayerConfig();
                setPlayerParams(params);

                // Scenario 1: Channel Context
                if (context?.type === 'channel' && context.channelId) {
                    const { videos: channelShorts } = await getChannelShorts(context.channelId);
                    
                    let initialIndex = 0;
                    if (videoId) {
                        const idx = channelShorts.findIndex(v => v.id === videoId);
                        if (idx !== -1) {
                            initialIndex = idx;
                        } else {
                            try {
                                const detail = await getVideoDetails(videoId);
                                channelShorts.unshift(detail);
                                initialIndex = 0;
                            } catch (e) {
                                console.warn("Could not fetch detail for initial video", e);
                            }
                        }
                    }
                    
                    // Reset seen IDs for this new context
                    seenVideoIdsRef.current = new Set(channelShorts.map(v => v.id));
                    setVideos(channelShorts);
                    setCurrentIndex(initialIndex);
                } 
                // Scenario 2: Home/Recommendation Context
                else {
                    const shorts = await getXraiShorts({ 
                        searchHistory, watchHistory, shortsHistory, subscribedChannels, 
                        ngKeywords, ngChannels, hiddenVideos, negativeKeywords, 
                        page: 1,
                        seenIds: []
                    });

                    let initialList = shorts;
                    if (videoId) {
                        const existingIdx = shorts.findIndex(v => v.id === videoId);
                        if (existingIdx !== -1) {
                            const [target] = shorts.splice(existingIdx, 1);
                            initialList = [target, ...shorts];
                        } else {
                            try {
                                const detail = await getVideoDetails(videoId);
                                initialList = [detail, ...shorts];
                            } catch (e) {
                                console.warn("Could not fetch detail for requested video", e);
                            }
                        }
                    }
                    
                    if (initialList.length === 0) setError("ショート動画が見つかりませんでした。");
                    else {
                        seenVideoIdsRef.current = new Set(initialList.map(v => v.id));
                        setVideos(initialList);
                    }
                    setCurrentIndex(0);
                }
            } catch (err: any) {
                setError(err.message || 'ショート動画の読み込みに失敗しました。');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };

        if (videos.length === 0) {
            init();
        }
    }, [videoId, context]); // Dependencies simplified to prevent re-init loops

    // --- Pre-fetching Logic ---
    useEffect(() => {
        if (videos.length > 0 && context?.type !== 'channel') {
            const remainingVideos = videos.length - 1 - currentIndex;
            if (remainingVideos < 10 && !isFetchingMore && !isLoading) {
                console.log(`Stock low (${remainingVideos} remaining). Fetching more...`);
                fetchMoreShorts();
            }
        }
    }, [currentIndex, videos.length, isFetchingMore, isLoading, context, fetchMoreShorts]);

    // Update URL
    useEffect(() => {
        if (videos[currentIndex] && videos[currentIndex].id !== videoId) {
            navigate(`/shorts/${videos[currentIndex].id}`, { replace: true, state: location.state });
        }
    }, [currentIndex, videos, navigate, videoId, location.state]);

    const handleNext = useCallback(() => {
        setCurrentIndex(prev => {
            if (prev < videos.length - 1) {
                // Pause current before moving
                postPauseCommand(prev);
                // Move next
                const nextIndex = prev + 1;
                // Play next (it should be preloaded)
                setTimeout(() => postPlayCommand(nextIndex), 100);
                return nextIndex;
            }
            return prev;
        });
    }, [videos.length, postPlayCommand, postPauseCommand]);

    const handlePrev = useCallback(() => {
        setCurrentIndex(prev => {
            if (prev > 0) {
                postPauseCommand(prev);
                const prevIndex = prev - 1;
                setTimeout(() => postPlayCommand(prevIndex), 100);
                return prevIndex;
            }
            return prev;
        });
    }, [postPlayCommand, postPauseCommand]);
    
    // Reset comments
    useEffect(() => {
        setShowComments(false);
        setComments([]);
    }, [currentIndex]);
    
    const getParamsForVideo = (index: number, videoId: string) => {
        if (!playerParams) return '';
        // Autoplay enabled for all, but we control via postMessage/DOM visibility
        // Ideally we want autoplay=1 so it buffers, but we might need to pause non-active ones via JS if they auto-start.
        // Actually for pre-loading, autoplay=1 is good, we just ensure the iframe is rendered.
        let params = playerParams.replace(/&?autoplay=[01]/g, "") + "&playsinline=1&autoplay=1&enablejsapi=1";
        params += `&loop=1&playlist=${videoId}`;
        return params;
    };

    // History saving
    useEffect(() => {
        const video = videos[currentIndex];
        if (!video) return;
        const durationSec = parseDuration(video.isoDuration, video.duration);
        const timeoutMs = durationSec > 0 ? (durationSec * 1000) / 2 : 10000;
        const historyTimer = setTimeout(() => {
            addShortToHistory(video);
        }, timeoutMs);
        return () => clearTimeout(historyTimer);
    }, [currentIndex, videos, addShortToHistory]);
    
    const handleToggleComments = async () => {
        const willBeOpen = !showComments;
        setShowComments(willBeOpen);
        if (willBeOpen && comments.length === 0 && videos[currentIndex]) {
            setAreCommentsLoading(true);
            try {
                const data = await getComments(videos[currentIndex].id);
                setComments(data);
            } catch (e) { console.error("Failed to fetch comments", e); } 
            finally { setAreCommentsLoading(false); }
        }
    };
    
    const removeVideoAndAdvance = (videoIdToRemove: string, channelIdToRemove?: string) => {
        // Just hide/skip logic, actual removal from array might mess up index tracking in this simple impl
        handleNext();
        // In a real app, we'd filter `videos` and adjust `currentIndex` carefully.
    }

    const handleNotInterested = () => {
        const video = videos[currentIndex];
        if(!video) return;
        addHiddenVideo({ id: video.id, title: video.title, channelName: video.channelName });
        removeVideoAndAdvance(video.id);
    };

    const handleBlockChannel = () => {
        const video = videos[currentIndex];
        if(!video) return;
        addNgChannel({ id: video.channelId, name: video.channelName, avatarUrl: video.channelAvatarUrl });
        removeVideoAndAdvance(video.id, video.channelId);
    };

    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (wheelTimeoutRef.current) return;
            if (e.deltaY > 5) handleNext();
            else if (e.deltaY < -5) handlePrev();
            wheelTimeoutRef.current = setTimeout(() => { wheelTimeoutRef.current = null; }, 200);
        };
        const container = document.querySelector('.shorts-container');
        if(container) container.addEventListener('wheel', handleWheel, { passive: false });
        return () => { 
            if(container) container.removeEventListener('wheel', handleWheel);
            if(wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
        };
    }, [handleNext, handlePrev]);

    if (isLoading) return <div className="flex justify-center items-center h-[calc(100vh-64px)]"><div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-yt-blue"></div></div>;
    if (error) return <div className="text-center text-red-500 bg-red-100 dark:bg-red-900/50 p-4 rounded-lg m-4">{error}</div>;
    if (videos.length === 0 || !playerParams) return <div className="text-center p-8">No shorts found.</div>;

    const currentVideo = videos[currentIndex];
    const isTransparentTheme = theme.includes('glass');
    const bgClass = isTransparentTheme ? 'bg-transparent' : 'bg-yt-white dark:bg-yt-black';
    const visibleIndices = getVisibleIndices();

    return (
        <div className={`shorts-container flex justify-center items-center h-[calc(100vh-3.5rem)] w-full overflow-hidden relative ${bgClass}`}>
            <div className="relative flex items-center justify-center gap-4 h-full w-full max-w-7xl mx-auto px-2 sm:px-4">
                {/* Main Player Container - Renders list but hides non-active */}
                <div className="relative h-[85vh] max-h-[900px] aspect-[9/16] rounded-2xl shadow-2xl overflow-hidden bg-black flex-shrink-0 z-10">
                     {videos.map((video, index) => {
                         // Unmount if far away to save memory
                         if (Math.abs(currentIndex - index) > 2) return null;
                         
                         const isActive = index === currentIndex;
                         const isVisible = visibleIndices.includes(index);
                         
                         return (
                             <div 
                                key={video.id} 
                                className="absolute inset-0 w-full h-full"
                                style={{ 
                                    display: isVisible ? 'block' : 'none',
                                    zIndex: isActive ? 2 : 1, // Active on top
                                    visibility: isVisible ? 'visible' : 'hidden'
                                }}
                             >
                                 <ShortsPlayer 
                                    ref={(el) => {
                                        if (el) iframeRefs.current.set(video.id, el);
                                        else iframeRefs.current.delete(video.id);
                                    }}
                                    video={video} 
                                    playerParams={getParamsForVideo(index, video.id)} 
                                 />
                             </div>
                         );
                     })}
                </div>

                {/* Right Side Controls */}
                <div className="flex flex-col gap-5 z-10 absolute right-4 bottom-20 md:static md:bottom-auto">
                    <div className="flex flex-col gap-3">
                        <button onClick={() => {}} className="flex flex-col items-center p-3 rounded-full bg-yt-light/50 dark:bg-yt-light-black/50 hover:bg-yt-light dark:hover:bg-yt-light-black backdrop-blur-sm transition-all group">
                            <LikeIcon /><span className="text-xs font-semibold text-black dark:text-white mt-1 hidden md:block">高評価</span>
                        </button>
                        <button onClick={handleToggleComments} className={`flex flex-col items-center p-3 rounded-full bg-yt-light/50 dark:bg-yt-light-black/50 hover:bg-yt-light dark:hover:bg-yt-light-black backdrop-blur-sm transition-all group ${showComments ? 'bg-white text-black hover:bg-white/90' : ''}`}>
                            <CommentIcon /><span className="text-xs font-semibold text-black dark:text-white mt-1 hidden md:block">コメント</span>
                        </button>
                        <button onClick={handleNotInterested} className="flex flex-col items-center p-3 rounded-full bg-yt-light/50 dark:bg-yt-light-black/50 hover:bg-yt-light dark:hover:bg-yt-light-black backdrop-blur-sm transition-all group">
                            <TrashIcon /><span className="text-xs font-semibold text-black dark:text-white mt-1 hidden md:block">興味なし</span>
                        </button>
                        <button onClick={handleBlockChannel} className="flex flex-col items-center p-3 rounded-full bg-yt-light/50 dark:bg-yt-light-black/50 hover:bg-yt-light dark:hover:bg-yt-light-black backdrop-blur-sm transition-all group">
                            <BlockIcon /><span className="text-xs font-semibold text-black dark:text-white mt-1 hidden md:block">非表示</span>
                        </button>
                    </div>

                    <div className="flex flex-col gap-4 mt-auto hidden md:flex">
                        <button 
                            onClick={handlePrev} 
                            disabled={currentIndex === 0} 
                            className={`p-3 rounded-full bg-yt-light/50 dark:bg-yt-light-black/50 hover:bg-yt-light dark:hover:bg-yt-light-black backdrop-blur-sm transition-all shadow-lg ${currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110 active:scale-95'}`}
                            title="前の動画"
                        >
                            <ChevronUpIcon />
                        </button>
                        <button 
                            onClick={handleNext} 
                            disabled={currentIndex >= videos.length - 1 && !isFetchingMore} 
                            className={`p-3 rounded-full bg-yt-light/50 dark:bg-yt-light-black/50 hover:bg-yt-light dark:hover:bg-yt-light-black backdrop-blur-sm transition-all shadow-lg ${currentIndex >= videos.length - 1 && !isFetchingMore ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110 active:scale-95'}`}
                            title="次の動画"
                        >
                            <ChevronDownIcon />
                        </button>
                    </div>
                </div>

                {/* Comment Drawer */}
                {showComments && (
                    <div className="absolute inset-0 md:static md:w-[360px] md:h-[85vh] md:max-h-[900px] glass-panel rounded-2xl shadow-2xl flex flex-col animate-scale-in z-20 bg-white/95 dark:bg-black/95 md:bg-transparent">
                         <div className="flex items-center justify-between p-4 border-b border-white/20">
                             <h3 className="font-bold text-black dark:text-white">コメント {comments.length > 0 && `(${comments.length})`}</h3>
                             <button onClick={() => setShowComments(false)} className="p-2 hover:bg-white/10 rounded-full"><CloseIcon /></button>
                         </div>
                         <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                             {areCommentsLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-yt-blue"></div></div>
                             : comments.length > 0 ? (
                                 <div className="space-y-2">
                                     {comments.map((comment, idx) => ( <div key={idx} className="bg-black/5 dark:bg-white/5 rounded-lg p-2 backdrop-blur-sm"><CommentComponent comment={comment} /></div> ))}
                                 </div>
                             ) : <div className="text-center text-yt-light-gray py-10">コメントはありません</div> }
                         </div>
                    </div>
                )}
            </div>
        </div>
    );
};
export default ShortsPage;