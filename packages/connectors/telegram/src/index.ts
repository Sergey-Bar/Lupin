import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  connectorFailure,
  dispatchEntry,
  executeWithRetry,
  requireString,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@lupin/connectors-sdk';

/**
 * The Telegram Bot API, for scheduled reports.
 *
 * Every method is `POST https://api.telegram.org/bot<token>/<method>` with a JSON body, and
 * every answer is `{ ok, result }` or `{ ok: false, error_code, description }` — usually
 * with the matching HTTP status, which is why a refusal is read from the body rather than
 * from `response.ok`. A refusal is a statement that nothing was sent, so it is a
 * `ConnectorRejectionError` and retried only when Telegram says "not now" (429, with
 * `parameters.retry_after`). The token is the secret; it is in the URL path, so it is never
 * put in an error message.
 */

const API = 'https://api.telegram.org';

interface TelegramOperation {
  readonly method: string;
  /** Required input fields, and the Bot API body key each becomes. */
  readonly fields: Readonly<Record<string, string>>;
  readonly extra: Readonly<Record<string, unknown>>;
  /**
   * Set for an operation that uploads a picture: the form field it travels in. Such an
   * operation is a multipart form rather than JSON, and reads the picture from `photoBase64`.
   */
  readonly photoField?: string;
}

/** Telegram cuts a caption past this many characters, so a longer one is refused, not cut. */
const MAX_CAPTION = 1_024;
/** Far above a chart and far below Telegram's own limit: what this adapter is willing to send. */
const MAX_PHOTO_BYTES = 1_000_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const OPERATIONS: Record<string, TelegramOperation> = {
  getMe: { method: 'getMe', fields: {}, extra: {} },
  sendMessage: {
    method: 'sendMessage',
    fields: { chatId: 'chat_id', text: 'text' },
    // The report renderer writes Telegram HTML; previews would expand the dashboard link
    // into a card that is larger than the report.
    extra: { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
  },
  // A picture with its caption in one message. The caption is the digest rendered for a
  // 1,024-character limit, so the message reads the same with or without the picture.
  sendPhoto: {
    method: 'sendPhoto',
    fields: { chatId: 'chat_id', caption: 'caption' },
    extra: { parse_mode: 'HTML' },
    photoField: 'photo',
  },
};

function bodyFor(operation: TelegramOperation, input: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { ...operation.extra };
  for (const [field, key] of Object.entries(operation.fields)) {
    body[key] = requireString(input, field);
  }
  return body;
}

/**
 * The picture of a `sendPhoto`, decoded and checked before any request is made.
 *
 * Only a PNG within the size this adapter will send is accepted, so what leaves this process
 * is a picture the caller drew and not whatever bytes were put in the field.
 */
function photoFrom(input: unknown): Blob {
  const encoded = requireString(input, 'photoBase64');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw new ConnectorInputError('invalid_photo', 'The picture is empty or larger than allowed');
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new ConnectorInputError('invalid_photo', 'The picture is not a PNG');
  }
  return new Blob([bytes], { type: 'image/png' });
}

/** The multipart form for an upload: the same fields as the JSON body, and the picture. */
function formFor(operation: TelegramOperation, input: unknown): FormData {
  const body = bodyFor(operation, input);
  const caption = body['caption'];
  if (typeof caption === 'string' && caption.length > MAX_CAPTION) {
    throw new ConnectorInputError(
      'caption_too_long',
      `A caption is at most ${String(MAX_CAPTION)} characters`,
    );
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, String(value));
  form.append(operation.photoField as string, photoFrom(input), 'chart.png');
  return form;
}

/** Telegram's own error code is the status worth acting on; the line may say 200. */
function refusalOf(record: Record<string, unknown>, response: Response): ConnectorRejectionError {
  const code = record['error_code'];
  const status =
    typeof code === 'number' && Number.isInteger(code) ? code : response.ok ? 400 : response.status;
  return new ConnectorRejectionError(status, 'Telegram refused the request');
}

export const telegramAdapter: ConnectorAdapter = {
  manifest: {
    name: 'telegram',
    version: '1.0.0',
    operations: {
      getMe: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      sendMessage: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
      sendPhoto: { sideEffecting: true, idempotent: false, timeoutMs: 20_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      const { entry, idempotent, timeoutMs } = dispatchEntry(
        telegramAdapter.manifest,
        OPERATIONS,
        request.operation,
      );
      // Built once, before the first attempt: a refusal of the input never becomes a request,
      // and a retry sends the same bytes.
      const upload = entry.photoField === undefined ? null : formFor(entry, request.input);
      const body = upload === null ? bodyFor(entry, request.input) : null;
      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(`${API}/bot${secret}/${entry.method}`, {
            method: 'POST',
            // A form sets its own content type, with the boundary; JSON names its own.
            ...(upload === null ? { headers: { 'content-type': 'application/json' } } : {}),
            body: upload ?? JSON.stringify(body),
            signal,
          });
          const parsed: unknown = await response.json().catch(() => null);
          if (typeof parsed !== 'object' || parsed === null) {
            throw new ConnectorHttpError(response.status, 'Telegram response was not an object');
          }
          const record = parsed as Record<string, unknown>;
          if (record['ok'] !== true) throw refusalOf(record, response);
          return record['result'];
        },
        { retries: 2, signal: request.signal, idempotent, attemptTimeoutMs: timeoutMs },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return connectorFailure('telegram', error, 'Telegram operation failed');
    }
  },
};
