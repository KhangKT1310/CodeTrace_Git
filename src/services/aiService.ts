import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

export class AIService {
  async generateCommitMessage(diff: string): Promise<string> {
    return this.callProvider(
      diff,
      'Write a concise Git commit message for this staged diff. Return only the commit message.'
    );
  }

  async explainDiff(diff: string): Promise<string> {
    return this.callProvider(
      diff,
      'Explain this staged diff clearly for a developer. Include summary, key changes, and likely impact.'
    );
  }

  private async callProvider(diff: string, instruction: string): Promise<string> {
    const configuration = vscode.workspace.getConfiguration('openGitInsight.ai');
    const provider = configuration.get<'ollama' | 'custom'>('provider', 'ollama');
    const model = configuration.get<string>('model', provider === 'ollama' ? 'llama3.1' : '');
    const endpoint = configuration.get<string>(
      'endpoint',
      provider === 'ollama' ? 'http://127.0.0.1:11434/api/generate' : ''
    );
    const apiKey = configuration.get<string>('apiKey', '');

    if (!endpoint) {
      throw new Error('AI endpoint is not configured. Set openGitInsight.ai.endpoint first.');
    }

    const prompt = `${instruction}\n\nDiff:\n${diff}`;
    if (provider === 'ollama') {
      const response = await postJson(endpoint, {
        model,
        prompt,
        stream: false
      });
      return String((response as { response?: string }).response ?? '').trim();
    }

    const response = await postJson(
      endpoint,
      { model, prompt },
      apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    );

    return extractCustomText(response);
  }
}

function postJson(
  urlString: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
      ...headers
    };

    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: 'POST',
        headers: requestHeaders
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`AI request failed: ${response.statusCode} ${text}`));
            return;
          }

          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function extractCustomText(response: unknown): string {
  if (typeof response === 'string') {
    return response.trim();
  }

  if (response && typeof response === 'object') {
    const known = response as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'response']) {
      const value = known[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return JSON.stringify(response, null, 2);
}
