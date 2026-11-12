// Design Ref: §5 서버 API — POST /api/interpret : 집계 결과를 받아 AI 해석을 돌려준다. 서버 쪽 코드는 이 파일 하나뿐이다.
// Plan SC: 작업 14 — API 키(OPENAI_API_KEY)와 공유 비밀번호(ACCESS_PASSWORD)는 서버 환경 변수에서만 읽는다.
//          NEXT_PUBLIC_ 이름을 붙이지 않았으므로 브라우저에는 절대 내려가지 않는다.
//
// 실제 일은 lib/ai/handler.ts에서 한다 (가짜 AI로 서버 없이 시험할 수 있게). 여기서는 요청과 환경 변수를 꺼내 넘기기만 한다.
// 라우트 파일이라 상대 경로로 가져온다 (자동 테스트에서도 이 파일을 그대로 불러 시험한다).

import { handleInterpret } from '../../../lib/ai/handler';
import { createOpenAiClient } from '../../../lib/ai/openai';

/** 문항이 많아 AI를 여러 번 부르면 오래 걸릴 수 있어서, 서버가 기다려 주는 시간(초)을 늘린다 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  const lengthHeader = request.headers.get('content-length');
  const length = lengthHeader === null ? null : Number(lengthHeader);

  const result = await handleInterpret({
    expectedPassword: process.env.ACCESS_PASSWORD,
    password: request.headers.get('x-access-password'),
    contentLength: length !== null && Number.isFinite(length) ? length : null,
    readBody: () => request.text(),
    ai: apiKey ? createOpenAiClient({ apiKey, model: process.env.OPENAI_MODEL }) : null,
  });

  // 결과는 사람마다 다르므로 어디에도 저장(캐시)하지 않게 한다
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
