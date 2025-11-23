/**
 * Parallel resolver execution
 */

/**
 * Race multiple resolvers in parallel
 * Returns the first non-null result, or null if all fail
 */
export async function raceResolvers(
  resolvers: Array<() => Promise<string | null>>,
  timeoutMs: number = 10000
): Promise<string | null> {
  if (resolvers.length === 0) return null;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    // Execute all resolvers in parallel
    const results = await Promise.allSettled(
      resolvers.map(async (resolver) => {
        if (controller.signal.aborted) return null;
        return await resolver();
      })
    );
    
    clearTimeout(timeout);
    
    // Return first non-null result
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }
    
    return null;
  } catch (error) {
    clearTimeout(timeout);
    return null;
  }
}

