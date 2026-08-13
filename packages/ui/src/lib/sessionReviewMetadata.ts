import type { Session } from '@opencode-ai/sdk/v2';

export type SessionMetadataRecord = Record<string, unknown>;

type NoatinWorkMetadata = {
  kind?: 'review';
  originalSessionID?: string;
  reviewSessionID?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const getSessionMetadata = (session: Session | null | undefined): SessionMetadataRecord => {
  const metadata = (session as (Session & { metadata?: unknown }) | null | undefined)?.metadata;
  return isRecord(metadata) ? metadata : {};
};

const getNoatinWorkMetadata = (metadata: SessionMetadataRecord): NoatinWorkMetadata => {
  const value = metadata.noatinwork;
  return isRecord(value) ? value as NoatinWorkMetadata : {};
};

export const getReviewSessionID = (session: Session | null | undefined): string | null => {
  const value = getNoatinWorkMetadata(getSessionMetadata(session)).reviewSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const getOriginalSessionID = (session: Session | null | undefined): string | null => {
  const value = getNoatinWorkMetadata(getSessionMetadata(session)).originalSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const isReviewSession = (session: Session | null | undefined): boolean =>
  getNoatinWorkMetadata(getSessionMetadata(session)).kind === 'review' && Boolean(getOriginalSessionID(session));

export const withReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getNoatinWorkMetadata(metadata);
  return {
    ...metadata,
    noatinwork: {
      ...current,
      reviewSessionID,
    },
  };
};

export const withReviewSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
): SessionMetadataRecord => {
  const current = getNoatinWorkMetadata(metadata);
  return {
    ...metadata,
    noatinwork: {
      ...current,
      kind: 'review' as const,
      originalSessionID,
    },
  };
};

export const withoutReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getNoatinWorkMetadata(metadata);
  if (current.reviewSessionID !== reviewSessionID) return metadata;

  const restNoatinWork = { ...current };
  delete restNoatinWork.reviewSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(restNoatinWork).length > 0) {
    next.noatinwork = restNoatinWork;
  } else {
    delete next.noatinwork;
  }
  return next;
};
