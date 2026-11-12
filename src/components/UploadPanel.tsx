'use client';

// Design Ref: §2 ① 파일 올리기 — 파일 2개 선택, 공유 비밀번호 입력, 분석 시작, 오류 문구.
// Plan SC: 작업 10 — 한글(.hwp)은 엑셀로 옮겨 올리도록 안내하고, 파일 모양이 틀리면 이유를 알려 준다.
// 업로드한 파일은 서버로 보내지 않고 이 브라우저에서만 읽는다. 공유 비밀번호는 저장하지 않고 메모리에만 둔다.

import { useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { GROUP_ROLES } from '@/lib/survey/analyze';
import type { GroupRole } from '@/lib/survey/analyze';
import { checkFileName, loadSurvey } from '@/lib/survey/load';
import type { LoadedSurvey } from '@/lib/survey/load';

export interface LoadedUpload {
  survey: LoadedSurvey;
  /** 공유 비밀번호. AI 해석을 요청할 때만 쓴다 (작업 14·15). 어디에도 저장하지 않는다 */
  password: string;
  /** 참여자 정보(B~G열)를 분석 결과에 반영할까 (기본 아니오). 반영해도 AI에는 보내지 않는다 */
  includeParticipants: boolean;
  /** 객관식 문항을 집단별로 나눠서 볼 참여자 정보 (기본 없음) */
  groupBy: GroupRole[];
}

const GROUP_LABEL: Record<GroupRole, string> = { department: '부서', rank: '직급' };

interface UploadPanelProps {
  /** 두 파일을 읽고 확인까지 끝났을 때 */
  onLoaded: (loaded: LoadedUpload) => void;
  /** 분석 시작을 눌러서 이전 결과를 지워야 할 때 */
  onReset: () => void;
}

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface FilePickerProps {
  label: string;
  hint: string;
  file: File | null;
  error: string | null;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

function FilePicker({ label, hint, file, error, disabled, onChange }: FilePickerProps) {
  const id = useId();
  const describedBy = `${id}-hint${error ? ` ${id}-error` : ''}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {label}
      </label>
      <p id={`${id}-hint`} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {hint}
      </p>
      <input
        id={id}
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-2 block w-full text-sm text-zinc-700 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700 disabled:opacity-60 dark:text-zinc-300"
      />
      {file && !error && (
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">선택한 파일: {file.name}</p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default function UploadPanel({ onLoaded, onReset }: UploadPanelProps) {
  const passwordId = useId();
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [questionFile, setQuestionFile] = useState<File | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // 분석을 시작하기 전에 묻는 두 가지: 참여자 정보 반영 여부, 집단별 집계
  const [includeParticipants, setIncludeParticipants] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupRole[]>([]);
  const participantsName = useId();

  // 파일을 고르면 이름만 보고 바로 확인한다 (엑셀(.xlsx)이 아니면 그 자리에서 안내)
  const pick =
    (setFile: (file: File | null) => void, setError: (message: string | null) => void) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setErrors([]);
      onReset(); // 파일을 바꾸면 이전에 읽은 결과는 더 이상 맞지 않으니 지운다
      if (file === null) {
        setFile(null);
        setError(null);
        return;
      }
      const message = checkFileName(file.name);
      if (message) {
        setFile(null);
        setError(message);
        event.target.value = ''; // 잘못 고른 파일은 선택에서 지운다
      } else {
        setFile(file);
        setError(null);
      }
    };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rawFile || !questionFile || busy) return;
    setBusy(true);
    setErrors([]);
    onReset();
    try {
      const [raw, questions] = await Promise.all([rawFile.arrayBuffer(), questionFile.arrayBuffer()]);
      const result = await loadSurvey(raw, questions);
      if (result.ok) onLoaded({ survey: result.survey, password, includeParticipants, groupBy });
      else setErrors(result.errors);
    } catch {
      setErrors(['파일을 읽는 중 문제가 생겼어요. 다시 시도해 주세요.']);
    } finally {
      setBusy(false);
    }
  }

  const canStart = rawFile !== null && questionFile !== null && !busy;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">① 파일 올리기</h2>

      <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
        <p>
          한글 파일(.hwp)은 바로 읽을 수 없어요. <strong>엑셀(.xlsx)로 옮겨서</strong> 올려 주세요.
        </p>
        <p className="mt-1">올린 파일은 서버로 보내지 않고, 이 브라우저에서만 읽어요.</p>
      </div>

      <div className="mt-6 space-y-6">
        <FilePicker
          label="엑셀 원본(로데이터)"
          hint="설문 시스템에서 내려받은 응답 파일이에요. A~G열은 참여일·이름·사번·부서·직급·직위·직책이고, H열부터 열 제목이 문항번호1, 문항번호2…로 이어져요."
          file={rawFile}
          error={rawError}
          disabled={busy}
          onChange={pick(setRawFile, setRawError)}
        />
        <FilePicker
          label="설문 문항 파일"
          hint="문항 번호·질문과, 객관식이면 보기(“1. 매우 그렇다”)가 적힌 파일이에요."
          file={questionFile}
          error={questionError}
          disabled={busy}
          onChange={pick(setQuestionFile, setQuestionError)}
        />

        <fieldset disabled={busy} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">참여자 정보를 분석 결과에 반영할까요?</legend>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            엑셀 원본 B~G열(이름·사번·부서·직급·직위·직책)이 참여자 정보예요. A열(참여일)은 쓰지 않아요.
          </p>
          <div className="mt-2 space-y-1 text-sm text-zinc-900 dark:text-zinc-100">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={participantsName}
                checked={!includeParticipants}
                onChange={() => setIncludeParticipants(false)}
                className="mt-1"
              />
              <span>
                <strong>아니오</strong> (기본) — 참여자 정보는 결과에 넣지 않아요.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={participantsName}
                checked={includeParticipants}
                onChange={() => setIncludeParticipants(true)}
                className="mt-1"
              />
              <span>
                <strong>예</strong> — B~G열을 열마다 주관식·서술형 문항 카드로 분석해요. 화면과 엑셀에 값이 그대로 들어가고,{' '}
                <strong>AI에는 보내지 않아요.</strong>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset disabled={busy} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">집단별로 나눠서 응답 수·비율을 볼까요?</legend>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            고른 참여자 정보(부서·직급)별로 객관식 문항의 응답 수와 비율을 따로 보여 줘요. 아무것도 고르지 않으면 보지 않아요. 위의 선택(반영 여부)과는 따로예요.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-900 dark:text-zinc-100">
            {GROUP_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={groupBy.includes(role)}
                  onChange={(e) => setGroupBy((prev) => (e.target.checked ? [...prev, role] : prev.filter((r) => r !== role)))}
                />
                {GROUP_LABEL[role]}별
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={passwordId} className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            공유 비밀번호
          </label>
          <p id={`${passwordId}-hint`} className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            AI 해석을 받을 때만 필요해요. 이 브라우저에 저장하지 않아요.
          </p>
          <input
            id={passwordId}
            type="password"
            autoComplete="off"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={`${passwordId}-hint`}
            className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-60 sm:max-w-xs dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-semibold">파일을 분석할 수 없어요.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canStart}
          className="whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '읽는 중…' : '분석 시작'}
        </button>
        {!rawFile || !questionFile ? (
          <span className="text-sm text-zinc-600 dark:text-zinc-400">두 파일을 모두 고르면 시작할 수 있어요.</span>
        ) : null}
      </div>
    </form>
  );
}
