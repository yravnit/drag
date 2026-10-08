import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubApiClient } from '../githubApiClient';

describe('GitHubApiClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('sends correct headers and returns JSON for getRepository', async () => {
    const fakeRepo = { name: 'drag', owner: { login: 'octocat' }, html_url: 'https://github.com/octocat/drag', default_branch: 'main' };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(fakeRepo),
    });

    const client = new GitHubApiClient({ authToken: 'test-token', fetchFn: mockFetch as unknown as typeof fetch });
    const res = await client.getRepository('octocat', 'drag');

    expect(res.name).toBe('drag');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/octocat/drag',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'User-Agent': 'Vercel-Workflow-Ingestion-Engine',
        }),
      })
    );
  });

  it('retries transient 5xx errors and succeeds on attempt 2', async () => {
    const fakeCommit = { sha: 'sha123', commit: { message: 'init' } };

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Map() })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(fakeCommit),
      });

    const client = new GitHubApiClient({ maxRetries: 2, baseDelayMs: 0, fetchFn: mockFetch as unknown as typeof fetch });
    const res = await client.getCommit('octocat', 'drag', 'main');

    expect(res.sha).toBe('sha123');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent 404 error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Map(),
    });

    const client = new GitHubApiClient({ maxRetries: 3, baseDelayMs: 0, fetchFn: mockFetch as unknown as typeof fetch });
    await expect(client.getRepository('octocat', 'nonexistent')).rejects.toThrow('GitHub API returned status 404');
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
