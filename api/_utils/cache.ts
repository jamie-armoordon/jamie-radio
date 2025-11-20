/**
 * Logo caching system - in-memory and disk persistence
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

interface CacheEntry {
  url: string;
  expires: number;
}

const CACHE_FILE = join(process.cwd(), 'cache', 'logos.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (for both homepages and logos)

// In-memory cache
const memoryCache = new Map<string, CacheEntry>();

// Track if we need to save to disk
let diskCacheDirty = false;
let saveTimeout: NodeJS.Timeout | null = null;

/**
 * Load cache from disk on startup
 */
export async function loadCache(): Promise<void> {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    const cache: Record<string, CacheEntry> = JSON.parse(data);
    
    const now = Date.now();
    let loaded = 0;
    for (const [key, entry] of Object.entries(cache)) {
      // Only load non-expired entries
      if (entry.expires > now) {
        memoryCache.set(key, entry);
        loaded++;
      }
    }
    console.log(`[Cache] Loaded ${loaded} entries from disk`);
  } catch (error: any) {
    // File doesn't exist or is invalid - start fresh
    if (error.code !== 'ENOENT') {
      console.warn('[Cache] Failed to load cache from disk:', error.message);
    }
    memoryCache.clear();
  }
}

/**
 * Save cache to disk (debounced)
 */
async function saveCacheInternal(): Promise<void> {
  try {
    // Ensure cache directory exists
    const cacheDir = dirname(CACHE_FILE);
    if (!existsSync(cacheDir)) {
      await mkdir(cacheDir, { recursive: true });
      console.log(`[Cache] Created cache directory: ${cacheDir}`);
    }
    
    const cache: Record<string, CacheEntry> = {};
    
    const now = Date.now();
    for (const [key, entry] of memoryCache.entries()) {
      // Only save non-expired entries
      if (entry.expires > now) {
        cache[key] = entry;
      }
    }
    
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    diskCacheDirty = false;
    console.log(`[Cache] Saved ${Object.keys(cache).length} entries to disk at ${CACHE_FILE}`);
  } catch (error) {
    console.error('[Cache] Failed to save cache to disk:', error);
  }
}

/**
 * Schedule a disk save (debounced)
 */
function scheduleSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  diskCacheDirty = true;
  saveTimeout = setTimeout(() => {
    saveCacheInternal().catch(console.error);
  }, 1000); // Debounce: save 1 second after last write
}

/**
 * Get cached URL for key
 */
export function getCached(key: string): string | null {
  if (!key) return null;
  
  const entry = memoryCache.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (entry.expires <= now) {
    // Expired - remove from cache
    memoryCache.delete(key);
    return null;
  }
  
  return entry.url;
}

/**
 * Clear a specific cache entry
 */
export function clearCached(key: string): void {
  if (!key) return;
  memoryCache.delete(key);
  diskCacheDirty = true;
  scheduleSave();
}

/**
 * Set cached URL for domain
 */
export function setCached(domain: string, url: string): void {
  if (!domain || !url) return;
  
  const expires = Date.now() + TTL_MS;
  memoryCache.set(domain, { url, expires });
  
  scheduleSave();
}

/**
 * Manually save cache (for shutdown, etc.)
 */
export async function saveCache(): Promise<void> {
  if (diskCacheDirty) {
    await saveCacheInternal();
  }
}

