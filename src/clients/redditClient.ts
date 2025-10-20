import snoowrap from 'snoowrap';
import { config } from '../config';
import { RedditPost, RedditComment, RedditAPIError, SubredditValidationResult } from '../types';
import { EventEmitter } from 'events';

export class RedditClient extends EventEmitter {
  private reddit: any;
  private streamingSubreddits: Set<string> = new Set();
  private isStreaming: boolean = false;
  private streamIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  // Ticker context inheritance tracking
  public tickerContextMap: Map<string, string[]> = new Map(); // commentId -> tickers
  private readonly CONTEXT_MAP_MAX_SIZE = 10000; // Limit memory usage
  
  // Subreddit validation cache to avoid rate limits
  private validationCache: Map<string, { result: SubredditValidationResult; timestamp: number }> = new Map();
  private readonly VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    this.initializeClient();
  }

  /**
   * Initialize the snoowrap Reddit client
   */
  private initializeClient(): void {
    try {
      // Check if we're in development mode with placeholder credentials
      const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                   config.reddit.clientId.startsWith('placeholder_');
      
      if (isDev) {
        console.log('⚠️  Running in development mode with mock Reddit client');
        this.reddit = this.createMockRedditClient();
        return;
      }
      
      this.reddit = new (snoowrap as any)({
        userAgent: config.reddit.userAgent,
        clientId: config.reddit.clientId,
        clientSecret: config.reddit.clientSecret,
        username: config.reddit.username,
        password: config.reddit.password
      });

      // Configure rate limiting
      this.reddit.config({
        requestDelay: 1000, // 1 second between requests
        requestTimeout: 30000, // 30 second timeout
        continueAfterRatelimitError: true,
        retryErrorCodes: [502, 503, 504, 522],
        maxRetryAttempts: 3
      });

      console.log('Reddit client initialized successfully');
    } catch (error) {
      throw new RedditAPIError('Failed to initialize Reddit client', { error });
    }
  }

  /**
   * Start streaming posts and comments from specified subreddits
   * If no subreddits provided, loads from database
   */
  public async startStreaming(subreddits?: string[]): Promise<void> {
    if (this.isStreaming) {
      console.warn('Reddit streaming is already active');
      return;
    }

    // If no subreddits provided, load from database
    let subredditsToStream = subreddits;
    if (!subredditsToStream) {
      try {
        const { dataStorageService } = await import('../services/dataStorageService');
        subredditsToStream = await dataStorageService.getActiveSubreddits();
        console.log(`📊 Loaded ${subredditsToStream.length} active subreddits from database`);
      } catch (error) {
        console.warn('Failed to load subreddits from database, falling back to config:', error);
        subredditsToStream = config.trading.subreddits;
      }
    }

    if (!subredditsToStream || subredditsToStream.length === 0) {
      console.warn('⚠️  No subreddits to monitor');
      return;
    }

    this.isStreaming = true;
    console.log(`🚀 Starting Reddit stream for ${subredditsToStream.length} subreddits: ${subredditsToStream.join(', ')}`);

    for (const subreddit of subredditsToStream) {
      await this.addStreamingSubreddit(subreddit);
    }

    this.emit('streamStarted', { subreddits: subredditsToStream });
  }

  /**
   * Stop all streaming activities
   */
  public stopStreaming(): void {
    console.log('Stopping Reddit streaming...');
    
    // Clear all intervals
    for (const [subreddit, interval] of this.streamIntervals.entries()) {
      clearInterval(interval);
      console.log(`Stopped streaming ${subreddit}`);
    }
    
    this.streamIntervals.clear();
    this.streamingSubreddits.clear();
    this.isStreaming = false;
    
    this.emit('streamStopped');
  }

  /**
   * Stream posts and comments from a specific subreddit
   */
  private async streamSubreddit(subredditName: string): Promise<void> {
    if (this.streamingSubreddits.has(subredditName)) {
      return; // Already streaming this subreddit
    }

    this.streamingSubreddits.add(subredditName);
    
    // Track the last processed item timestamp to avoid duplicates
    let lastProcessedTime = Date.now() / 1000;

    const pollSubreddit = async () => {
      try {
        // Get new posts
        const posts = await this.reddit.getSubreddit(subredditName).getNew({ limit: 25 });
        
        for (const post of posts) {
          if (post.created_utc > lastProcessedTime) {
            const redditPost = this.convertToRedditPost(post);
            this.emit('newPost', redditPost);
            
            // Also get comments for the post if it has any
            if (post.num_comments > 0) {
              try {
                const submission = await this.reddit.getSubmission(post.id);
                const comments = await submission.comments.fetchMore({ amount: 10, skipReplies: true });
                
                for (const comment of comments) {
                  if (comment.created_utc > lastProcessedTime) {
                    const redditComment = this.convertToRedditComment(comment);
                    this.emit('newComment', redditComment);
                  }
                }
              } catch (error) {
                console.warn(`Failed to fetch comments for post ${post.id}:`, error);
              }
            }
          }
        }

        // Update the last processed time to the most recent post
        if (posts.length > 0) {
          lastProcessedTime = Math.max(...posts.map((p: any) => p.created_utc));
        }

      } catch (error) {
        console.error(`Error streaming subreddit ${subredditName}:`, error);
        this.emit('streamError', new RedditAPIError(`Failed to stream ${subredditName}`, { error, subreddit: subredditName }));
      }
    };

    // Initial poll
    await pollSubreddit();

    // Set up periodic polling (every 30 seconds)
    const interval = setInterval(pollSubreddit, 30000);
    this.streamIntervals.set(subredditName, interval);

    console.log(`Started streaming subreddit: r/${subredditName}`);
  }

  /**
   * Get recent posts from a subreddit (one-time fetch)
   */
  public async getRecentPosts(subredditName: string, limit: number = 25): Promise<RedditPost[]> {
    try {
      const posts = await this.reddit.getSubreddit(subredditName).getNew({ limit });
      return posts.map((post: any) => this.convertToRedditPost(post));
    } catch (error) {
      throw new RedditAPIError(`Failed to fetch posts from r/${subredditName}`, { error, subreddit: subredditName });
    }
  }

  /**
   * Get comments from a specific post
   */
  public async getPostComments(postId: string, limit: number = 50): Promise<RedditComment[]> {
    try {
      const submission = await this.reddit.getSubmission(postId);
      const comments = await submission.comments.fetchMore({ amount: limit, skipReplies: false });
      
      return this.flattenComments(comments).map(comment => this.convertToRedditComment(comment));
    } catch (error) {
      throw new RedditAPIError(`Failed to fetch comments for post ${postId}`, { error, postId });
    }
  }

  /**
   * Search for posts containing specific keywords
   */
  public async searchPosts(query: string, subreddits?: string[], limit: number = 25): Promise<RedditPost[]> {
    try {
      let searchQuery = query;
      if (subreddits && subreddits.length > 0) {
        searchQuery += ` subreddit:${subreddits.join(' OR subreddit:')}`;
      }

      const results = await this.reddit.search({
        query: searchQuery,
        sort: 'new',
        time: 'day',
        limit
      });

      return results.map((post: any) => this.convertToRedditPost(post));
    } catch (error) {
      throw new RedditAPIError('Failed to search Reddit posts', { error, query, subreddits });
    }
  }

  /**
   * Get user information
   */
  public async getUser(username: string): Promise<any> {
    try {
      return await this.reddit.getUser(username).fetch();
    } catch (error) {
      throw new RedditAPIError(`Failed to fetch user ${username}`, { error, username });
    }
  }

  /**
   * Convert snoowrap post to our RedditPost type
   */
  private convertToRedditPost(post: any): RedditPost {
    return {
      id: post.id,
      title: post.title || '',
      selftext: post.selftext || '',
      author: post.author ? post.author.name : '[deleted]',
      subreddit: post.subreddit.display_name,
      score: post.score || 0,
      upvote_ratio: post.upvote_ratio || 0,
      created_utc: post.created_utc || 0,
      url: post.url || '',
      num_comments: post.num_comments || 0
    };
  }

  /**
   * Convert snoowrap comment to our RedditComment type
   */
  private convertToRedditComment(comment: any): RedditComment {
    return {
      id: comment.id,
      body: comment.body || '',
      author: comment.author ? comment.author.name : '[deleted]',
      subreddit: comment.subreddit ? comment.subreddit.display_name : '',
      score: comment.score || 0,
      created_utc: comment.created_utc || 0,
      parent_id: comment.parent_id || ''
    };
  }

  /**
   * Flatten nested comment structure
   */
  private flattenComments(comments: any[]): any[] {
    const flattened: any[] = [];
    
    const flatten = (commentList: any[]) => {
      for (const comment of commentList) {
        if (comment.body && comment.body !== '[deleted]') {
          flattened.push(comment);
        }
        if (comment.replies && comment.replies.length > 0) {
          flatten(comment.replies);
        }
      }
    };
    
    flatten(comments);
    return flattened;
  }

  /**
   * Create mock Reddit client for development
   */
  private createMockRedditClient(): any {
    return {
      config: () => {},
      getSubreddit: (name: string) => ({
        getNew: () => Promise.resolve([
          {
            id: 'mock_post_1',
            title: 'Bitcoin to the moon! 🚀',
            selftext: 'I think BTC will reach $100k soon based on recent trends',
            author: { name: 'crypto_enthusiast' },
            subreddit: { display_name: name },
            score: 150,
            upvote_ratio: 0.85,
            created_utc: Date.now() / 1000,
            url: 'https://reddit.com/mock',
            num_comments: 25
          },
          {
            id: 'mock_post_2', 
            title: 'Ethereum gas fees are too high',
            selftext: 'ETH network congestion is killing DeFi adoption',
            author: { name: 'defi_user' },
            subreddit: { display_name: name },
            score: 89,
            upvote_ratio: 0.75,
            created_utc: (Date.now() / 1000) - 300,
            url: 'https://reddit.com/mock2',
            num_comments: 42
          }
        ])
      }),
      getSubmission: (id: string) => ({
        comments: {
          fetchMore: () => Promise.resolve([
            {
              id: 'mock_comment_1',
              body: 'Totally agree! BTC is going to explode higher!',
              author: { name: 'bull_market_fan' },
              subreddit: { display_name: 'CryptoCurrency' },
              score: 15,
              created_utc: Date.now() / 1000,
              parent_id: id
            }
          ])
        }
      }),
      search: () => Promise.resolve([]),
      getUser: (username: string) => ({
        fetch: () => Promise.resolve({ name: username })
      })
    };
  }

  /**
   * Get streaming status
   */
  public getStreamingStatus(): { isStreaming: boolean; subreddits: string[] } {
    return {
      isStreaming: this.isStreaming,
      subreddits: Array.from(this.streamingSubreddits)
    };
  }

  /**
   * Get rate limit information
   */
  public async getRateLimitInfo(): Promise<any> {
    // Note: snoowrap doesn't expose rate limit info directly
    // Return basic info about current configuration
    return {
      requestDelay: 1000,
      maxRetryAttempts: 3,
      note: 'snoowrap handles rate limiting internally'
    };
  }
  
  /**
   * Get a single comment by ID (for parent comment fetching)
   */
  public async getCommentById(commentId: string): Promise<RedditComment | null> {
    try {
      // Reddit API expects full thing_id format (t1_xxxxx for comments)
      const fullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
      const comment = await this.reddit.getComment(fullId.replace('t1_', ''));
      
      if (!comment || !comment.body || comment.body === '[deleted]') {
        return null;
      }
      
      return this.convertToRedditComment(comment);
    } catch (error) {
      console.warn(`Failed to fetch comment ${commentId}:`, error);
      return null;
    }
  }
  
  /**
   * Store ticker context for a comment (for inheritance)
   */
  public storeTickerContext(commentId: string, tickers: string[]): void {
    if (tickers.length > 0) {
      this.tickerContextMap.set(commentId, tickers);
      
      // Clean up old entries if map gets too large (simple FIFO)
      if (this.tickerContextMap.size > this.CONTEXT_MAP_MAX_SIZE) {
        const firstKey = this.tickerContextMap.keys().next().value;
        if (firstKey) {
          this.tickerContextMap.delete(firstKey);
        }
      }
    }
  }
  
  /**
   * Get inherited ticker context from parent
   */
  public getInheritedTickers(parentId: string): string[] {
    // Remove Reddit prefix if present (t1_, t3_, etc.)
    const cleanParentId = parentId.replace(/^t[0-9]_/, '');
    return this.tickerContextMap.get(cleanParentId) || [];
  }
  
  /**
   * Validate a subreddit exists and get metadata
   */
  public async validateSubreddit(name: string): Promise<SubredditValidationResult> {
    // Normalize subreddit name
    const normalized = this.normalizeSubredditName(name);

    // Check cache first
    const cached = this.validationCache.get(normalized);
    if (cached && Date.now() - cached.timestamp < this.VALIDATION_CACHE_TTL) {
      console.log(`📦 Returning cached validation for r/${normalized}`);
      return cached.result;
    }

    console.log(`🔍 Validating subreddit: r/${normalized}`);

    // Check if in development mode
    const isDev = process.env.SKIP_CONFIG_VALIDATION === 'true' || 
                 config.reddit.clientId.startsWith('placeholder_');
    
    if (isDev) {
      // Mock validation response in development
      const result: SubredditValidationResult = {
        exists: true,
        isCryptoFocused: this.isCryptoRelated(normalized),
        description: `Mock description for r/${normalized}`,
        subscribers: 100000,
        isPrivate: false,
        isQuarantined: false,
        isBanned: false
      };
      this.validationCache.set(normalized, { result, timestamp: Date.now() });
      return result;
    }

    try {
      const subreddit = await this.reddit.getSubreddit(normalized);
      const data = await subreddit.fetch();

      // Check for quarantined/private/banned status
      const isPrivate = data.subreddit_type === 'private';
      const isQuarantined = data.quarantine === true;
      const isBanned = data.subreddit_type === 'banned';

      // Get description for crypto-focus detection
      const description = data.public_description || data.description || '';
      const isCryptoFocused = this.isCryptoRelated(normalized + ' ' + description);

      const result: SubredditValidationResult = {
        exists: true,
        isCryptoFocused,
        description: data.public_description || null,
        subscribers: data.subscribers || null,
        isPrivate,
        isQuarantined,
        isBanned
      };

      // Cache the result
      this.validationCache.set(normalized, { result, timestamp: Date.now() });

      console.log(`✅ Validated r/${normalized}: ${result.subscribers?.toLocaleString()} subscribers, crypto: ${isCryptoFocused}`);
      return result;

    } catch (error: any) {
      // Handle various error cases
      const errorMessage = error.message || String(error);

      if (errorMessage.includes('404') || errorMessage.includes('Forbidden')) {
        const result: SubredditValidationResult = {
          exists: false,
          isCryptoFocused: false,
          description: null,
          subscribers: null,
          isPrivate: errorMessage.includes('Forbidden'),
          isQuarantined: false,
          isBanned: false
        };

        // Cache negative results briefly (1 minute)
        this.validationCache.set(normalized, { result, timestamp: Date.now() - (this.VALIDATION_CACHE_TTL - 60000) });

        return result;
      }

      // Handle rate limiting
      if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        console.warn(`⏱️  Rate limited validating r/${normalized}, will retry later`);
        throw new RedditAPIError('Rate limited, please try again in a moment', { subreddit: normalized });
      }

      throw new RedditAPIError(`Failed to validate subreddit: ${errorMessage}`, { subreddit: normalized, error });
    }
  }

  /**
   * Add a subreddit to streaming (dynamic addition without restart)
   */
  public async addStreamingSubreddit(name: string): Promise<void> {
    const normalized = this.normalizeSubredditName(name);

    if (this.streamingSubreddits.has(normalized)) {
      console.log(`⏩ Already streaming r/${normalized}`);
      return;
    }

    console.log(`➕ Adding r/${normalized} to streaming`);
    await this.streamSubreddit(normalized);
  }

  /**
   * Remove a subreddit from streaming (dynamic removal without restart)
   */
  public removeStreamingSubreddit(name: string): void {
    const normalized = this.normalizeSubredditName(name);

    if (!this.streamingSubreddits.has(normalized)) {
      console.log(`⏩ r/${normalized} is not being streamed`);
      return;
    }

    console.log(`➖ Removing r/${normalized} from streaming`);

    // Stop the interval
    const interval = this.streamIntervals.get(normalized);
    if (interval) {
      clearInterval(interval);
      this.streamIntervals.delete(normalized);
    }

    // Remove from active set
    this.streamingSubreddits.delete(normalized);

    console.log(`✅ Stopped streaming r/${normalized}`);
  }

  /**
   * Normalize subreddit name (remove r/ prefix, lowercase, trim)
   */
  private normalizeSubredditName(name: string): string {
    if (!name || typeof name !== 'string') {
      return '';
    }

    let normalized = name.trim();
    normalized = normalized.replace(/^\/r\/|^r\//i, '');
    normalized = normalized.toLowerCase();

    return normalized;
  }

  /**
   * Check if a subreddit or text is crypto-related
   */
  private isCryptoRelated(text: string): boolean {
    const cryptoKeywords = [
      'crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'blockchain',
      'defi', 'altcoin', 'coin', 'token', 'nft', 'web3', 'trading',
      'satoshi', 'hodl', 'cryptocurrency'
    ];

    const lowerText = text.toLowerCase();
    return cryptoKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Clear ticker context map (useful for memory management)
   */
  public clearTickerContext(): void {
    this.tickerContextMap.clear();
    console.log('🧹 Cleared ticker context map');
  }
}

// Export singleton instance
export const redditClient = new RedditClient();