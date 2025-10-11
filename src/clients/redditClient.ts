import snoowrap from 'snoowrap';
import { config } from '../config';
import { RedditPost, RedditComment, RedditAPIError } from '../types';
import { EventEmitter } from 'events';

export class RedditClient extends EventEmitter {
  private reddit: any;
  private streamingSubreddits: Set<string> = new Set();
  private isStreaming: boolean = false;
  private streamIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    this.initializeClient();
  }

  /**
   * Initialize the snoowrap Reddit client
   */
  private initializeClient(): void {
    try {
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
   */
  public async startStreaming(subreddits: string[] = config.trading.subreddits): Promise<void> {
    if (this.isStreaming) {
      console.warn('Reddit streaming is already active');
      return;
    }

    this.isStreaming = true;
    console.log(`Starting Reddit stream for subreddits: ${subreddits.join(', ')}`);

    for (const subreddit of subreddits) {
      await this.streamSubreddit(subreddit);
    }

    this.emit('streamStarted', { subreddits });
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
}

// Export singleton instance
export const redditClient = new RedditClient();