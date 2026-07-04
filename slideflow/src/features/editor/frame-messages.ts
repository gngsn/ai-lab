/** Typed postMessage protocol between the edit page (parent) and the edit-frame iframe. */

export interface RequestDataMessage {
  type: 'edit-frame:request-data';
  deckId: string;
  sectionId: string;
}

export interface DataMessage {
  type: 'edit-frame:data';
  frameHtml: string;
  content: string;
  edit: boolean;
}

export interface InsertMessage {
  type: 'edit-frame:insert';
  html: string;
}

export interface DirtyMessage {
  type: 'edit:dirty';
  sectionId: string;
}

export interface SaveMessage {
  type: 'edit:save';
  sectionId: string;
  content: string;
}

export interface FrameErrorMessage {
  type: 'edit-frame:error';
  message: string;
}

/** Parent → iframe. */
export type DownMessage = DataMessage | InsertMessage;
/** Iframe → parent. */
export type UpMessage = RequestDataMessage | DirtyMessage | SaveMessage | FrameErrorMessage;
