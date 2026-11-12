// Design Ref: §6.2 AI 서비스 — 실제 OpenAI를 부르는 부분. 서버에서만 쓴다 (API 키는 서버 환경 변수에서만 읽는다).
// 별도 패키지 없이 OpenAI의 Chat Completions 주소를 fetch로 직접 부른다. AiClient 약속만 지킨다.

import type { AiClient } from './types';

/** 기본 모델. `.env`의 OPENAI_MODEL로 바꿀 수 있다 */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAiOptions {
  apiKey: string;
  /** 비어 있으면 DEFAULT_OPENAI_MODEL */
  model?: string | undefined;
  /** 시험용: 네트워크 대신 쓸 fetch */
  fetch?: typeof fetch;
}

/** 오류 내용(요청·응답 글, 키)은 담지 않고 종류와 상태 번호만 담는다 — 로그에 남겨도 안전하다 */
class OpenAiError extends Error {
  constructor(public readonly status: number) {
    super(`OpenAI 요청 실패 (${status})`);
    this.name = 'OpenAiError';
  }
}

export function createOpenAiClient({ apiKey, model, fetch: fetchImpl }: OpenAiOptions): AiClient {
  const call = fetchImpl ?? fetch;
  const modelName = model?.trim() ? model.trim() : DEFAULT_OPENAI_MODEL;

  return {
    async complete({ system, prompt }) {
      const res = await call(OPENAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelName,
          max_completion_tokens: 1024,
          response_format: { type: 'json_object' }, // 답을 JSON으로만 받는다 (프롬프트에도 JSON 형식이 적혀 있다)
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new OpenAiError(res.status);
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    },
  };
}
