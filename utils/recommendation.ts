
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

// Helper to chunk array into smaller arrays
const chunkArray = <T,>(array: T[], size: number): T[][] => {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};

// Helper to mix two lists based on a ratio (targetRatio is for listA)
const mixFeeds = (listA: Video[], listB: Video[], targetRatioA: number): Video[] => {
    const result: Video[] = [];
    let indexA = 0;
    let indexB = 0;
    
    // We approximate the ratio by picking N items from A and 1 item from B cyclically
    // ratio 0.66 (2/3) means: A, A, B, A, A, B...
    
    while (indexA < listA.length || indexB < listB.length) {
        // Simple probabilistic approach or cyclic approach to maintain ~65%
        // Cycle of 3: A, A, B (66% A) matches the request for ~65%
        
        // Slot 1: A
        if (indexA < listA.length) result.push(listA[indexA++]);
        
        // Slot 2: A
        if (indexA < listA.length) result.push(listA[indexA++]);
        
        // Slot 3: B
        if (indexB < listB.length) result.push(listB[indexB++]);
        
        // If one list runs out, just append the rest of the other
        if (indexA >= listA.length && indexB < listB.length) {
            result.push(...listB.slice(indexB));
            break;
        }
        if (indexB >= listB.length && indexA < listA.length) {
            result.push(...listA.slice(indexA));
            break;
        }
    }
    
    return result;
};

// --- XRAI v2 Recommendation Engine ---

export const getXraiRecommendations = async (sources: RecommendationSource): Promise<Video[]> => {
    const { 
        watchHistory, 
        searchHistory, 
        subscribedChannels, 
        preferredGenres
    } = sources;

    // 1. Build User Interest Profile
    const userProfile = buildUserProfile({
        watchHistory,
        searchHistory,
        subscribedChannels,
    });
    
    // --- Source A: "New Video" Discovery via OR Search (Target: 65%) ---
    // Extract top keywords from profile + preferred genres
    const weightedKeywords = [...userProfile.keywords.entries()]
        .sort((a, b) => b[1] - a[1]) // Sort by weight desc
        .map(entry => entry[0]);

    // Mix in explicit preferred genres at the top to ensure they are searched
    const priorityKeywords = Array.from(new Set([...preferredGenres, ...weightedKeywords]));
    
    // Take top 15 keywords
    const topKeywords = priorityKeywords.slice(0, 15);
    
    const searchPromises: Promise<Video[]>[] = [];

    if (topKeywords.length > 0) {
        // Create chunks for OR queries (e.g., "Minecraft OR Pokemon OR ASMR")
        // Grouping 4 keywords per query prevents query too long errors and maximizes variety
        const keywordChunks = chunkArray(topKeywords, 4);
        
        keywordChunks.forEach(chunk => {
            const query = chunk.join(' OR ');
            searchPromises.push(
                searchVideos(query, '1')
                    .then(res => res.videos)
                    .catch(() => [])
            );
        });
    } else {
        // Cold start: use generic trending or random topics if no history
        searchPromises.push(searchVideos("trending OR viral OR music OR game", '1').then(r => r.videos).catch(()=>[]));
    }


    // --- Source B: General / Contextual / Subscriptions (Target: 35%) ---
    const generalPromises: Promise<Video[]>[] = [];

    // 1. Home Feed (High Volume)
    generalPromises.push(
        getRecommendedVideos()
            .then(res => res.videos)
            .catch(() => [])
    );

    // 2. Contextual (Last watched)
    if (watchHistory.length > 0) {
        const lastVideo = watchHistory[0]; 
        generalPromises.push(
            getVideoDetails(lastVideo.id)
                .then(details => (details.relatedVideos || []).slice(0, 20)) 
                .catch(() => [])
        );
    }

    // 3. Subscriptions (Random subset)
    if (subscribedChannels.length > 0) {
        const randomSubs = shuffleArray(subscribedChannels).slice(0, 3);
        randomSubs.forEach(sub => {
            generalPromises.push(
                getChannelVideos(sub.id)
                    .then(res => res.videos.slice(0, 10))
                    .catch(() => [])
            );
        });
    }


    // --- Execution ---
    const [searchResultsNested, generalResultsNested] = await Promise.all([
        Promise.all(searchPromises),
        Promise.all(generalPromises)
    ]);

    // Flatten arrays
    const rawDiscoveryVideos = searchResultsNested.flat();
    const rawGeneralVideos = generalResultsNested.flat();
    
    // Deduplicate locally within lists
    const uniqueDiscovery = Array.from(new Map(rawDiscoveryVideos.map(v => [v.id, v])).values());
    const uniqueGeneral = Array.from(new Map(rawGeneralVideos.map(v => [v.id, v])).values());

    // Remove overlaps: If a video is in Discovery, remove it from General (prioritize Discovery label)
    const discoveryIds = new Set(uniqueDiscovery.map(v => v.id));
    const filteredGeneral = uniqueGeneral.filter(v => !discoveryIds.has(v.id));


    // --- Ranking ---
    // Rank both lists independently using XRAI scoring
    const rankedDiscovery = rankVideos(uniqueDiscovery, userProfile, {
        ngKeywords: sources.ngKeywords,
        ngChannels: sources.ngChannels,
        watchHistory: sources.watchHistory,
    });

    const rankedGeneral = rankVideos(filteredGeneral, userProfile, {
        ngKeywords: sources.ngKeywords,
        ngChannels: sources.ngChannels,
        watchHistory: sources.watchHistory,
    });


    // --- Mixing (65% Discovery / 35% General) ---
    // Target ratio: ~0.65
    const finalFeed = mixFeeds(rankedDiscovery, rankedGeneral, 0.65);

    // Return top 150
    return finalFeed.slice(0, 150);
};


// --- Legacy Recommendation Engine ---

export const getLegacyRecommendations = async (): Promise<Video[]> => {
    try {
        const { videos } = await getRecommendedVideos();
        return shuffleArray(videos); 
    } catch (error) {
        console.error("Failed to fetch legacy recommendations:", error);
        return [];
    }
}
