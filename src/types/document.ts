/** A page as held in memory: flat, addressed by id, with ordered child ids. */
export interface Page {
  id: string;
  title: string;
  /** Page body as markdown. */
  content: string;
  parentId: string | null;
  children: string[];
  createdAt: string;
  updatedAt: string;
}

/** A page as written to disk: nested so the JSON reads like the hierarchy. */
export interface PageFile {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  children: PageFile[];
}

export const FILE_FORMAT = "gddesigner";
export const FILE_VERSION = 1;
export const FILE_EXTENSION = "gdd.json";

/** The on-disk `.gdd.json` document. */
export interface DocumentFile {
  format: typeof FILE_FORMAT;
  version: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedPageId: string | null;
  pages: PageFile[];
}
