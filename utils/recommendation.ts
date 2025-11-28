import type { Video, Channel } from '../types';
import { searchVideos, getRecommendedVideos, parseDuration } from './api';
import { extractKeywords, calculateMagnitude } from './xrai';
import type { BlockedChannel, HiddenVideo } from '../contexts/PreferenceContext';

interface RecommendationSource {
    searchHistory: string[];
    watchHistory: Video[];
    shortsHistory?: Video[];
    subscribedChannels: Channel[];
    ngKeywords: string[];
    ngChannels: BlockedChannel[];
    hiddenVideos: HiddenVideo[];
    negativeKeywords: Map<string, number>;
    page: number;
}

export interface HomeFeed {
    videos: Video[];
    shorts: Video[];
}

const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

const cleanTitleForSearch = (title: string): string => {
    return title.replace(/【.*?】|\[.*?\]|\(.*?\)/g, '').trim().split(' ').slice(0, 4).join(' ');
};

const isShortVideo = (v: Video): boolean => {
    const seconds = parseDuration(v.isoDuration, v.duration);
    return (seconds > 0 && seconds <= 60) || v.title.toLowerCase().includes('#shorts');
};

export const getXraiRecommendations = async (sources: RecommendationSource): Promise<HomeFeed> => {
    const { 
        watchHistory, 
        subscribedChannels,
        ngKeywords,
        ngChannels,
        hiddenVideos,
        negativeKeywords
    } = sources;

    const TARGET_VIDEOS = 50;
    const TRENDING_VIDEO_RATIO = 0.40;
    const TARGET_SHORTS = 20;

    const seenIds = new Set<string>(hiddenVideos.map(v => v.id));
    const ngChannelIds = new Set(ngChannels.map(c => c.id));

    const filterAndDedupe = (videos: Video[]): Video[] => {
        return videos.filter(v => {
            if (seenIds.has(v.id)) return false;
            
            const fullText = `${v.title} ${v.channelName}`.toLowerCase();

            if (ngKeywords.some(ng => fullText.includes(ng.toLowerCase()))) return false;
            if (ngChannelIds.has(v.channelId)) return false;

            const vKeywords = [...extractKeywords(v.title), ...extractKeywords(v.channelName)];
            let negativeScore = 0;
            vKeywords.forEach(k => {
                if (negativeKeywords.has(k)) {
                    negativeScore += (negativeKeywords.get(k) || 0);
                }
            });
            if (negativeScore > 2) return false;
            
            seenIds.add(v.id);
            return true;
        });
    };

    // 1. Fetch Personalized Seeds
    let personalizedSeeds: string[] = [];
    if (watchHistory.length > 0) {
        const historySample = shuffleArray(watchHistory).slice(0, 5);
        personalizedSeeds = historySample.map(v => `${cleanTitleForSearch(v.title)} related`);
    } else if (subscribedChannels.length > 0) {
        const subSample = shuffleArray(subscribedChannels).slice(0, 3);
        personalizedSeeds = subSample.map(c => `${c.name} videos`);
    } else {
        personalizedSeeds = ["Music", "Gaming", "Vlog"];
    }

    // 2. Fetch Content
    const trendingPromise = getRecommendedVideos().then(res => res.videos).catch(() => []);
    const searchPromises = personalizedSeeds.map(query => 
        searchVideos(query, '1').then(res => ({ videos: res.videos, shorts: res.shorts })).catch(() => ({ videos: [], shorts: [] }))
    );
    
    const [trendingContent, personalizedResults] = await Promise.all([trendingPromise, Promise.all(searchPromises)]);

    // 3. Separate ALL content into videos and shorts FIRST
    const allTrendingVideos: Video[] = [];
    const allTrendingShorts: Video[] = [];
    for (const v of trendingContent) {
        if (isShortVideo(v)) {
            allTrendingShorts.push(v);
        } else {
            allTrendingVideos.push(v);
        }
    }

    const allPersonalizedVideos: Video[] = [];
    const allPersonalizedShorts: Video[] = [...personalizedResults.flatMap(r => r.shorts)];
    const personalizedVideosFromSearch = personalizedResults.flatMap(r => r.videos);
    for (const v of personalizedVideosFromSearch) {
        if (isShortVideo(v)) {
            allPersonalizedShorts.push(v);
        } else {
            allPersonalizedVideos.push(v);
        }
    }

    // 4. Filter and Dedupe
    const cleanTrendingVideos = filterAndDedupe(allTrendingVideos);
    const cleanPersonalizedVideos = filterAndDedupe(allPersonalizedVideos);
    const cleanTrendingShorts = filterAndDedupe(allTrendingShorts);
    const cleanPersonalizedShorts = filterAndDedupe(allPersonalizedShorts);

    // 5. Mix Videos
    const numTrending = Math.floor(TARGET_VIDEOS * TRENDING_VIDEO_RATIO);
    const numPersonalized = TARGET_VIDEOS - numTrending;
    
    const finalVideos = shuffleArray([
        ...shuffleArray(cleanTrendingVideos).slice(0, numTrending),
        ...shuffleArray(cleanPersonalizedVideos).slice(0, numPersonalized)
    ]);

    // 6. Mix Shorts
    const finalShorts = shuffleArray([
        ...shuffleArray(cleanTrendingShorts),
        ...shuffleArray(cleanPersonalizedShorts)
    ]).slice(0, TARGET_SHORTS);

    return { videos: finalVideos, shorts: finalShorts };
};


export const getXraiShorts = async (sources: RecommendationSource & { seenIds?: string[] }): Promise<Video[]> => {
    const { 
        watchHistory, 
        shortsHistory,
        subscribedChannels,
        hiddenVideos,
        ngChannels,
        ngKeywords,
        negativeKeywords,
        seenIds = []
    } = sources;

    // --- Configuration ---
    const BATCH_SIZE = 20;
    const POPULAR_RATIO = 0.85; // 85% Popular Shorts target
    const targetPopularCount = Math.ceil(BATCH_SIZE * POPULAR_RATIO);
    const targetPersonalizedCount = BATCH_SIZE - targetPopularCount;

    // --- User Profile Construction ---
    const userVector = new Map<string, number>();
    const addWeight = (text: string, weight: number) => {
        extractKeywords(text).forEach(k => userVector.set(k, (userVector.get(k) || 0) + weight));
    };

    subscribedChannels.forEach(c => addWeight(c.name, 5.0));
    (shortsHistory || []).slice(0, 30).forEach((v, i) => {
        const recencyDecay = Math.exp(-i / 10);
        addWeight(v.title, 3.0 * recencyDecay);
        addWeight(v.channelName, 4.0 * recencyDecay);
    });
    
    const userMag = calculateMagnitude(userVector); 

    // --- Candidate Generation (Robust Popularity Sources) ---
    
    // 1. Popular/Trending Pool (Japanese)
    // 日本向けの一般的な人気ワードで検索して候補を確保する
    const popularQueries = [
        "急上昇 #shorts", 
        "人気 #shorts", 
        "バズってる #shorts", 
        "面白い #shorts", 
        "切り抜き #shorts", 
        "猫 #shorts", 
        "犬 #shorts", 
        "アニメ #shorts", 
        "歌ってみた #shorts", 
        "踊ってみた #shorts"
    ];
    // Shuffle queries to get variety each load
    const selectedQueries = shuffleArray(popularQueries).slice(0, 3);
    
    const popularPromise = Promise.all([
        getRecommendedVideos().then(res => res.videos.filter(isShortVideo)).catch(() => []),
        ...selectedQueries.map(q => searchVideos(q, '1').then(res => [...res.videos, ...res.shorts].filter(isShortVideo)).catch(() => []))
    ]).then(results => results.flat());
    
    // 2. Personalized Pool
    const topKeywords = [...userVector.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    const personalizedSeeds = topKeywords.length > 0 ? topKeywords.map(k => `${k} #shorts`) : ["音楽 #shorts"];
    const personalizedPromise = Promise.all(personalizedSeeds.map(query => 
        searchVideos(query, '1').then(res => [...res.videos, ...res.shorts].filter(isShortVideo)).catch(() => [])
    )).then(results => results.flat());

    const [popularShortsRaw, personalizedShortsRaw] = await Promise.all([popularPromise, personalizedPromise]);

    // --- Filtering & Scoring ---
    const allSeenIds = new Set([
        ...(shortsHistory || []).map(v => v.id),
        ...hiddenVideos.map(v => v.id),
        ...seenIds
    ]);
    const ngChannelIds = new Set(ngChannels.map(c => c.id));

    // Scoring Function
    const scoreVideo = (video: Video, isPopularSource: boolean): number => {
        let score = 0;
        
        // Base score for simply being from the popular feed to ensure it competes
        if (isPopularSource) {
            score += 30;
        }

        // Content Match
        const vKeywords = [...extractKeywords(video.title), ...extractKeywords(video.channelName)];
        let dotProduct = 0;
        vKeywords.forEach(k => {
            if (userVector.has(k)) {
                dotProduct += userVector.get(k)!;
            }
        });
        
        if (userMag > 0 && vKeywords.length > 0) {
            score += (dotProduct / (userMag * Math.sqrt(vKeywords.length))) * 100;
        }

        // Channel Affinity
        if (subscribedChannels.some(c => c.id === video.channelId)) {
            score += 50; 
        }

        // Negative Signals
        let negScore = 0;
        vKeywords.forEach(k => {
            if (negativeKeywords.has(k)) negScore += negativeKeywords.get(k)!;
        });
        score -= negScore * 30; // Strong penalty

        // Random Noise
        score += Math.random() * 20;

        return score;
    };

    const processCandidates = (candidates: Video[], isPopularSource: boolean): { video: Video, score: number }[] => {
        const unique = new Map<string, Video>();
        candidates.forEach(v => {
            if (allSeenIds.has(v.id)) return;
            if (ngChannelIds.has(v.channelId)) return;
            const fullText = `${v.title} ${v.channelName}`.toLowerCase();
            if (ngKeywords.some(ng => fullText.includes(ng.toLowerCase()))) return;
            // Local dedupe within batch
            if (!unique.has(v.id)) unique.set(v.id, v);
        });

        return Array.from(unique.values()).map(v => ({
            video: v,
            score: scoreVideo(v, isPopularSource)
        })).sort((a, b) => b.score - a.score);
    };

    const rankedPopular = processCandidates(popularShortsRaw, true);
    const rankedPersonalized = processCandidates(personalizedShortsRaw, false);

    // --- Selection (85% / 15%) ---
    const finalFeed: Video[] = [];
    const usedIds = new Set<string>();

    const addVideoSafely = (item: { video: Video, score: number } | undefined) => {
        if (!item) return;
        if (item.score < -50) return; // Strict negative cutoff
        if (usedIds.has(item.video.id)) return;

        finalFeed.push(item.video);
        usedIds.add(item.video.id);
    };

    // 1. Take top popular items to fill quota
    rankedPopular.slice(0, targetPopularCount).forEach(addVideoSafely);

    // 2. Take top personalized items
    rankedPersonalized.slice(0, targetPersonalizedCount).forEach(addVideoSafely);

    // 3. Backfill if needed (Prefer popular, then personalized)
    const remainingNeeded = BATCH_SIZE - finalFeed.length;
    if (remainingNeeded > 0) {
        const remainingPopular = rankedPopular.slice(targetPopularCount);
        remainingPopular.slice(0, remainingNeeded).forEach(addVideoSafely);
    }
    
    // Check again
    if (finalFeed.length < BATCH_SIZE) {
        const stillNeeded = BATCH_SIZE - finalFeed.length;
        const remainingPersonalized = rankedPersonalized.slice(targetPersonalizedCount);
        remainingPersonalized.slice(0, stillNeeded).forEach(addVideoSafely);
    }

    // Shuffle final result so "Popular" isn't always first
    return shuffleArray(finalFeed);
};