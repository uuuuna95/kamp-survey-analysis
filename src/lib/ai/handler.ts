// Design Ref: §5 서버 API — 공유 비밀번호 확인 → 크기 확인 → 요청 확인 → AI 해석 → 응답.
// Plan SC: 작업 14 — 공유 비밀번호가 맞을 때만 처리, 요청 크기(1MB)·문항 수(50개) 상한, 요청 내용은 저장하지도 로그로 남기지도 않는다.
//
// route.ts는 환경 변수와 요청을 꺼내서 이 함수에 넘기기만 한다. 그래서 가짜 AI로 서버 없이 시험할 수 있다.
// 오류 응답: 401 비밀번호, 413 너무 큼, 400 모양이 틀림, 500 서버 설정·AI 실패.

import { createHash, timingSafeEqual } from 'node:crypto';
import { describeError, hasNothingToInterpret, interpretAll } from './interpret';
import { MAX_BODY_BYTES } from './limits';
import { parseInterpretRequest } from './request';
import type { AiClient, ErrorBody, InterpretResponse } from './types';

export interface HandleInput {
  /** 서버에 설정된 공유 비밀번호(ACCESS_PASSWORD). 없거나 비어 있으면 아무도 통과시키지 않는다 */
  expectedPassword: string | undefined;
  /** 요청 머리말(x-access-password)로 받은 비밀번호 */
  password: string | null;
  /** 요청 머리말(content-length)로 받은 크기. 모르면 null */
  contentLength: number | null;
  /** 요청 본문을 글로 읽는 함수 (비밀번호가 맞은 뒤에만 부른다) */
  readBody: () => Promise<string>;
  /** AI 호출. API 키가 설정되지 않았으면 null */
  ai: AiClient | null;
}

export interface HandleResult {
  status: number;
  body: InterpretResponse | ErrorBody;
}

const failure = (status: number, code: string, message: string): HandleResult => ({
  status,
  body: { error: { code, message } },
});

/** 비밀번호를 같은 시간이 걸리는 방식으로 비교한다 (길이·내용이 달라도 걸리는 시간으로 추측할 수 없게) */
export function passwordsMatch(given: string | null, expected: string): boolean {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return given !== null && timingSafeEqual(a, b);
}

export async function handleInterpret(input: HandleInput): Promise<HandleResult> {
  const { expectedPassword, password, contentLength, readBody, ai } = input;

  if (!expectedPassword) {
    return failure(500, 'SERVER_NOT_CONFIGURED', '서버에 공유 비밀번호가 설정되지 않았어요. 관리자에게 알려 주세요.');
  }
  if (!passwordsMatch(password, expectedPassword)) {
    return failure(401, 'UNAUTHORIZED', '공유 비밀번호가 맞지 않아요.');
  }

  const tooLarge = () => failure(413, 'PAYLOAD_TOO_LARGE', '보내는 내용이 너무 커요. 문항을 나눠서 다시 시도해 주세요.');
  if (contentLength !== null && contentLength > MAX_BODY_BYTES) return tooLarge();

  let bodyText: string;
  try {
    bodyText = await readBody();
  } catch {
    return failure(400, 'INVALID_BODY', '요청 내용을 읽을 수 없어요.');
  }
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_BODY_BYTES) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return failure(400, 'INVALID_JSON', '요청 내용이 JSON이 아니에요.');
  }

  const checked = parseInterpretRequest(json);
  if (!checked.ok) {
    return checked.status === 413
      ? failure(413, 'PAYLOAD_TOO_LARGE', checked.message)
      : failure(400, 'INVALID_REQUEST', checked.message);
  }
  if (!ai) {
    return failure(500, 'AI_NOT_CONFIGURED', 'AI 서비스 키가 서버에 설정되지 않았어요. 관리자에게 알려 주세요.');
  }

  const { questions } = checked.value;
  // 요청 내용은 로그에 남기지 않는다. 오류도 종류와 상태 번호만 적는다
  const results = await interpretAll(ai, questions, (error) => console.error(`[interpret] AI 호출 실패: ${describeError(error)}`));

  const interpretations: InterpretResponse['interpretations'] = {};
  const failed: number[] = [];
  questions.forEach((q, i) => {
    const result = results[i];
    if (result === null) failed.push(q.no);
    else interpretations[String(q.no)] = result;
  });

  // AI가 필요한 문항이 있는데 하나도 못 만들었으면 서버 오류로 알린다 (부분 성공이면 200과 failed 목록)
  const asked = questions.filter((q) => !hasNothingToInterpret(q)).length;
  if (asked > 0 && failed.length === asked) {
    return failure(500, 'AI_FAILED', 'AI 해석을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
  return { status: 200, body: { interpretations, failed } };
}
