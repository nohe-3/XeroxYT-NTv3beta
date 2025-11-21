
import type { Video, Channel } from '../types';
import { searchVideos, getVideoDetails, getChannelVideos, getRecommendedVideos } from './api';
import { buildUserProfile, rankVideos } from './xrai';

// --- Types ---

interface RecommendationSource {
    searchHistory: string[];
    watchHistory: Video[];
    subscribedChannels: Channel[];
    preferredGenres: string[];
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

// --- XRAI v2 Recommendation Engine ---

export const getXraiRecommendations = async (sources: RecommendationSource): Promise<Video[]> => {
    const { 
        watchHistory, 
        searchHistory, 
        subscribedChannels, 
    } = sources;

    // 1. Build User Interest Profile
    const userProfile = buildUserProfile({
        watchHistory,
        searchHistory,
        subscribedChannels,
    });
    
    const candidatePromises: Promise<Video[]>[] = [];

    // 2. Parallel Data Fetching for Speed

    // Source A: Contextual Walk (Related to recent history)
    // Only fetch related for the very last video to save bandwidth/time
    if (watchHistory.length > 0) {
        const lastVideo = watchHistory[0]; // Most recent
        candidatePromises.push(
            getVideoDetails(lastVideo.id)
                .then(details => (details.relatedVideos || []).slice(0, 20))
                .catch(() => [])
        );
    }

    // Source B: Interest-based Search (The core of discovery)
    // Extract top weighted keywords and search for them
    const topKeywords = [...userProfile.keywords.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2) // Top 2 keywords
        .map(entry => entry[0]);
    
    if (topKeywords.length > 0) {
        // Search combined keywords for specificity
        const query = topKeywords.join(' ');
        candidatePromises.push(
            searchVideos(query, '1')
                .then(res => res.videos)
                .catch(() => [])
        );
        // Also search the top keyword individually if we have enough
        if (topKeywords.length > 1) {
             candidatePromises.push(
                searchVideos(topKeywords[0], '1')
                    .then(res => res.videos)
                    .catch(() => [])
            );
        }
    } else {
        // If no profile, search for generic popular topics
        candidatePromises.push(
            searchVideos("trending", '1').then(res => res.videos).catch(()=>[])
        );
    }

    // Source C: Subscriptions (Recent uploads)
    if (subscribedChannels.length > 0) {
        // Pick 3 random subscribed channels to check for new content
        const randomSubs = shuffleArray(subscribedChannels).slice(0, 3);
        randomSubs.forEach(sub => {
            candidatePromises.push(
                getChannelVideos(sub.id)
                    .then(res => res.videos.slice(0, 5)) // Only latest 5
                    .catch(() => [])
            );
        });
    }

    // Source D: Fallback / Trend Filler
    // Use standard trending/home feed to ensure we always have content
    candidatePromises.push(
        getRecommendedVideos()
            .then(res => res.videos)
            .catch(() => [])
    );

    // 3. Aggregate & Deduplicate
    const results = await Promise.allSettled(candidatePromises);
    let allCandidates: Video[] = [];
    const seenCandidateIds = new Set<string>();

    results.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            result.value.forEach(v => {
                if (!seenCandidateIds.has(v.id)) {
                    seenCandidateIds.add(v.id);
                    allCandidates.push(v);
                }
            });
        }
    });

    // 4. Scoring & Ranking (The AI Part)
    const rankedVideos = rankVideos(allCandidates, userProfile, {
        ngKeywords: sources.ngKeywords,
        ngChannels: sources.ngChannels,
        watchHistory: sources.watchHistory,
    });
    
    // Return top results
    return rankedVideos;
};


// --- Legacy Recommendation Engine ---

/**
 * 従来のシンプルなYouTube風の推薦を生成する。
 * APIが返すデフォルトのホームフィードを使用する。
 */
export const getLegacyRecommendations = async (): Promise<Video[]> => {
    try {
        const { videos } = await getRecommendedVideos();
        return videos;
    } catch (error) {
        console.error("Failed to fetch legacy recommendations:", error);
        return [];
    }
}
